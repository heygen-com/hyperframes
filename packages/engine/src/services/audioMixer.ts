/**
 * Audio Mixer Service
 *
 * Processes and mixes audio tracks using FFmpeg.
 */

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { parseHTML } from "linkedom";
import { extractAudioMetadata } from "../utils/ffprobe.js";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { runFfmpeg, type RunFfmpegResult } from "../utils/runFfmpeg.js";
import { unwrapTemplate } from "../utils/htmlTemplate.js";
import { resolveProjectRelativeSrc } from "./videoFrameExtractor.js";
import { resolveReferencedStart, type RefResolverEl } from "./referenceResolver.js";
import type { AudioElement, AudioTrack, MixResult } from "./audioMixer.types.js";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";
import { applyVstChainToWav } from "./vstBounce.js";

export type { AudioElement, MixResult } from "./audioMixer.types.js";

/**
 * Thrown when applying a track's VST plugin chain fails — missing plugin,
 * missing chain file, or a sidecar crash. Distinct from every other
 * per-element failure handled by `processCompositionAudio`'s try/catch: those
 * degrade gracefully (the track is dropped, the mix proceeds without it). A
 * VST failure never does — the per-element catch below rethrows it
 * unhandled, so it propagates out of the `Promise.all` and rejects
 * `processCompositionAudio` itself, hard-failing the render and naming the
 * plugin, per "missing plugin at render time = hard render failure, never a
 * silent fallback."
 */
class VstChainProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VstChainProcessingError";
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

function formatFilterNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function escapeExpressionCommas(expression: string): string {
  return expression.replace(/\\/g, "\\\\").replace(/,/g, "\\,");
}

function legacyFilterScriptOptionIsUnsupported(stderr: string): boolean {
  return (
    /filter_complex_script/i.test(stderr) &&
    /(?:unrecognized option|option (?:was )?not found)/i.test(stderr)
  );
}

/**
 * Upper bound on volume-automation keyframes folded into the FFmpeg `volume`
 * expression. The expression nests one `if(lt(...))` per keyframe, and
 * FFmpeg's expression evaluator has a finite nesting depth: past ~95 levels
 * (build-dependent — lower on some Linux ffmpeg builds) `volume=...:eval=frame`
 * fails filter-graph init, which fails the whole mix and drops the audio track
 * entirely. The 60 Hz timeline probe routinely emits 100–300 keyframes for a
 * multi-second fade (GH #1066 follow-up: a 171-keyframe GSAP fade rendered with
 * no audio). 32 segments keeps a wide safety margin and is far more resolution
 * than a piecewise-linear volume envelope needs.
 */
const MAX_VOLUME_SEGMENTS = 32;

/**
 * Volume delta below which a keyframe is collinear enough to drop. Kept tight
 * (0.5% linear) so the rendered piecewise-linear envelope tracks the GSAP curve
 * the browser plays in preview to within ~0.2 dB across the audible range — well
 * under the ~1 dB loudness JND, so render stays WYSIWYG with preview. A full
 * ease-in/ease-out fade still reduces to ~25 segments, inside MAX_VOLUME_SEGMENTS.
 */
const VOLUME_SIMPLIFY_EPSILON = 0.005;

// `-ac 2` uses FFmpeg's default mono-to-stereo rematrix, which attenuates a
// mono source by 3 dB. Explicitly map front-center into both stereo channels;
// native stereo sources have FL/FR and pass through unchanged.
const STEREO_CHANNEL_FILTER = "pan=stereo|FL=FL+FC|FR=FR+FC";

async function stereoOutputArgs(srcPath: string): Promise<string[]> {
  try {
    const { channels } = await extractAudioMetadata(srcPath);
    if (channels === 1) return ["-af", STEREO_CHANNEL_FILTER];
  } catch {
    // Preserve the previous FFmpeg conversion path when metadata probing fails.
  }
  return ["-ac", "2"];
}

/**
 * Reduce a sorted keyframe list to a perceptually-equivalent piecewise-linear
 * envelope with a bounded segment count.
 *
 * Ramer–Douglas–Peucker drops control points lying within
 * `VOLUME_SIMPLIFY_EPSILON` of the line through their neighbours (a linear fade
 * collapses to its two endpoints; an eased fade to a handful). A uniform
 * downsample backstop then bounds pathological inputs (e.g. audio-rate volume
 * oscillation) to `MAX_VOLUME_SEGMENTS`. Endpoints are always preserved so the
 * envelope still spans the full clip.
 */
function simplifyVolumeKeyframes(
  keyframes: { time: number; volume: number }[],
): { time: number; volume: number }[] {
  if (keyframes.length < 3) return keyframes;

  const keep = new Array<boolean>(keyframes.length).fill(false);
  keep[0] = true;
  keep[keyframes.length - 1] = true;
  const stack: [number, number][] = [[0, keyframes.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    const start = keyframes[startIndex]!;
    const end = keyframes[endIndex]!;
    const span = end.time - start.time;
    let maxDistance = VOLUME_SIMPLIFY_EPSILON;
    let splitIndex = -1;
    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const point = keyframes[i]!;
      const interpolated =
        span === 0
          ? start.volume
          : start.volume + ((end.volume - start.volume) * (point.time - start.time)) / span;
      const distance = Math.abs(point.volume - interpolated);
      if (distance > maxDistance) {
        maxDistance = distance;
        splitIndex = i;
      }
    }
    if (splitIndex !== -1) {
      keep[splitIndex] = true;
      stack.push([startIndex, splitIndex], [splitIndex, endIndex]);
    }
  }

  const simplified = keyframes.filter((_, i) => keep[i]);
  if (simplified.length <= MAX_VOLUME_SEGMENTS) return simplified;

  const step = (simplified.length - 1) / (MAX_VOLUME_SEGMENTS - 1);
  const sampled: { time: number; volume: number }[] = [];
  for (let i = 0; i < MAX_VOLUME_SEGMENTS; i += 1) {
    const point = simplified[Math.round(i * step)]!;
    if (sampled.length === 0 || point.time > sampled.at(-1)!.time) sampled.push(point);
  }
  return sampled;
}

function buildVolumeExpression(track: AudioTrack, ignoreKeyframes = false): string {
  const trimDuration = track.end - track.start;
  const staticVolume = clampVolume(track.volume);
  const keyframes = (ignoreKeyframes ? [] : (track.volumeKeyframes ?? []))
    .filter((keyframe) => Number.isFinite(keyframe.time) && Number.isFinite(keyframe.volume))
    .map((keyframe) => ({
      time: Math.max(0, Math.min(trimDuration, keyframe.time - track.start)),
      volume: clampVolume(keyframe.volume),
    }))
    .sort((a, b) => a.time - b.time);

  if (keyframes.length === 0) return `volume=${formatFilterNumber(staticVolume)}`;

  if (keyframes[0]!.time > 0) {
    keyframes.unshift({ time: 0, volume: staticVolume });
  }

  const deduped: typeof keyframes = [];
  for (const keyframe of keyframes) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.time - keyframe.time) < 0.000001) {
      previous.volume = keyframe.volume;
    } else {
      deduped.push(keyframe);
    }
  }

  // Collapse the densely-sampled probe output to a bounded piecewise-linear
  // envelope. Without this, the nested-if expression below grows one level per
  // keyframe and overflows FFmpeg's expression evaluator (see MAX_VOLUME_SEGMENTS).
  const simplified = simplifyVolumeKeyframes(deduped);

  if (simplified.length === 1) {
    return `volume=${formatFilterNumber(simplified[0]!.volume)}`;
  }

  let expression = formatFilterNumber(simplified.at(-1)!.volume);
  for (let i = simplified.length - 2; i >= 0; i -= 1) {
    const current = simplified[i]!;
    const next = simplified[i + 1]!;
    const currentTime = formatFilterNumber(current.time);
    const nextTime = formatFilterNumber(next.time);
    const currentVolume = formatFilterNumber(current.volume);
    const span = Math.max(0.000001, next.time - current.time);
    const slope = formatFilterNumber((next.volume - current.volume) / span);
    const segment = `${currentVolume}+(${slope})*(t-${currentTime})`;
    expression = `if(lt(t,${nextTime}),${segment},${expression})`;
  }

  return `volume=${escapeExpressionCommas(expression)}:eval=frame`;
}

interface ExtractResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
}

export function parseAudioElements(html: string): AudioElement[] {
  const elements: AudioElement[] = [];
  const { document } = parseHTML(unwrapTemplate(html));

  // Shared resolver state so a relative `data-start` ("start when clip X ends")
  // resolves against every clip in the composition — exactly as
  // parseVideoElements does. Without this, `parseFloat("clipId")` yields NaN and
  // the mixer silently drops the track (the segment renders as pure digital
  // silence), even though the same reference places the *video* correctly.
  const startCache = new Map<RefResolverEl, number>();
  const visiting = new Set<RefResolverEl>();
  const resolveStart = (el: RefResolverEl): number =>
    el.getAttribute("data-start") ? resolveReferencedStart(document, el, startCache, visiting) : 0;
  // `end` stays a plain numeric read (the mixer derives the real segment length
  // from data-duration / natural media downstream); guard NaN so a malformed
  // value never poisons the mix instead of falling back to 0.
  const parseEnd = (raw: string | null): number => {
    const end = raw ? parseFloat(raw) : 0;
    return Number.isFinite(end) ? end : 0;
  };

  // <audio> and <video data-has-audio> tracks differ only in the emitted id
  // and `type`; everything else (timing, layer, volume) is read identically.
  const build = (el: RefResolverEl, id: string, type: AudioElement["type"]): AudioElement => {
    const mediaStartAttr = el.getAttribute("data-media-start");
    const layerAttr = el.getAttribute("data-layer");
    const volumeAttr = el.getAttribute("data-volume");
    const vstChain = el.getAttribute("data-vst-chain");
    return {
      id,
      src: el.getAttribute("src") as string,
      start: resolveStart(el),
      end: parseEnd(el.getAttribute("data-end")),
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      layer: layerAttr ? parseInt(layerAttr) : 0,
      volume: volumeAttr ? parseFloat(volumeAttr) : 1.0,
      ...(vstChain ? { vstChain } : {}),
      type,
    };
  };

  for (const el of document.querySelectorAll("audio[id][src]")) {
    const id = el.getAttribute("id");
    if (!id || !el.getAttribute("src")) continue;
    elements.push(build(el, id, "audio"));
  }

  for (const el of document.querySelectorAll('video[id][src][data-has-audio="true"]')) {
    const id = el.getAttribute("id");
    if (!id || !el.getAttribute("src")) continue;
    elements.push(build(el, `${id}-audio`, "video"));
  }

  return elements;
}

/**
 * Resolve the ffmpeg process timeout from an optional partial config,
 * falling back to `DEFAULT_CONFIG.ffmpegProcessTimeout`. Shared by every
 * ffmpeg-invoking helper below.
 */
function resolveFfmpegTimeout(
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): number {
  return config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
}

/** Create `outputPath`'s parent directory if it doesn't already exist. */
function ensureOutputDir(outputPath: string): void {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
}

/**
 * Build the common `ExtractResult` shape shared by
 * `extractAudioFromVideo` / `prepareAudioTrack` / `generateSilence`: an
 * aborted-signal case (function-specific cancelled message), an ffmpeg
 * failure case (function-specific error formatting via `formatError`), and
 * the success case.
 */
function buildExtractResult(
  outputPath: string,
  result: RunFfmpegResult,
  signal: AbortSignal | undefined,
  cancelledMessage: string,
  formatError: (result: RunFfmpegResult) => string,
): ExtractResult {
  if (signal?.aborted) {
    return { success: false, outputPath, durationMs: result.durationMs, error: cancelledMessage };
  }
  if (!result.success) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: formatError(result),
    };
  }
  return { success: true, outputPath, durationMs: result.durationMs };
}

async function extractAudioFromVideo(
  videoPath: string,
  outputPath: string,
  options?: { startTime?: number; duration?: number },
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = resolveFfmpegTimeout(config);
  ensureOutputDir(outputPath);

  const args: string[] = ["-i", videoPath];
  if (options?.startTime !== undefined) args.push("-ss", String(options.startTime));
  if (options?.duration !== undefined) args.push("-t", String(options.duration));
  const channelArgs = await stereoOutputArgs(videoPath);
  args.push("-vn", "-acodec", "pcm_s16le", "-ar", "48000", ...channelArgs, "-y", outputPath);

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  return buildExtractResult(outputPath, result, signal, "Audio extract cancelled", (r) =>
    r.exitCode !== null ? `FFmpeg exited with code ${r.exitCode}` : r.stderr,
  );
}

async function prepareAudioTrack(
  srcPath: string,
  outputPath: string,
  mediaStart: number,
  duration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = resolveFfmpegTimeout(config);
  ensureOutputDir(outputPath);
  const channelArgs = await stereoOutputArgs(srcPath);

  const args = [
    "-ss",
    String(mediaStart),
    "-t",
    String(duration),
    "-i",
    srcPath,
    "-acodec",
    "pcm_s16le",
    "-ar",
    "48000",
    ...channelArgs,
    "-y",
    outputPath,
  ];

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  return buildExtractResult(outputPath, result, signal, "Audio prepare cancelled", (r) =>
    r.exitCode !== null
      ? `FFmpeg exited with code ${r.exitCode}: ${r.stderr.slice(-200)}`
      : r.stderr,
  );
}

async function generateSilence(
  outputPath: string,
  duration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = resolveFfmpegTimeout(config);
  ensureOutputDir(outputPath);

  const args = [
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(duration),
    "-acodec",
    "pcm_s16le",
    "-y",
    outputPath,
  ];

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  return buildExtractResult(outputPath, result, signal, "Silence generation cancelled", (r) =>
    r.exitCode !== null ? `FFmpeg exited with code ${r.exitCode}` : r.stderr,
  );
}

async function mixAudioTracks(
  tracks: AudioTrack[],
  outputPath: string,
  totalDuration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout" | "audioGain">>,
): Promise<MixResult> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const masterOutputGain = config?.audioGain ?? DEFAULT_CONFIG.audioGain;

  if (tracks.length === 0) {
    const result = await generateSilence(outputPath, totalDuration, signal, config);
    return {
      success: result.success,
      outputPath,
      durationMs: result.durationMs,
      tracksProcessed: 0,
      error: result.error,
    };
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const buildFilterComplex = (ignoreAutomation: boolean): string => {
    const filterParts: string[] = [];
    tracks.forEach((track, i) => {
      const delayMs = Math.round(track.start * 1000);
      const trimDuration = track.end - track.start;
      const volumeFilter = buildVolumeExpression(track, ignoreAutomation);
      filterParts.push(
        `[${i}:a]atrim=0:${trimDuration},${volumeFilter},adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`,
      );
    });

    const mixInputs = tracks.map((_, i) => `[a${i}]`).join("");
    const mixFilter = `${mixInputs}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0[mixed]`;
    // amix divides output by inputs count (default normalize=true). Multiply master
    // gain by track count so per-track volumes authored in data-volume are preserved.
    const compensatedGain = masterOutputGain * tracks.length;
    const postMixGainFilter = `[mixed]volume=${formatFilterNumber(compensatedGain)}[out]`;
    return [...filterParts, mixFilter, postMixGainFilter].join(";");
  };

  // A large track count (100+) makes the inline `-filter_complex <string>`
  // argument scale linearly with track count until it exceeds the OS
  // command-line length limit — spawn ENAMETOOLONG, seen in practice at 146
  // tracks — even though every individual filter segment is short. FFmpeg's
  // file-valued filter options read the same graph from disk instead,
  // sidestepping the argv limit for the one component of this command line
  // that actually grows with the composition. FFmpeg deprecated
  // `-filter_complex_script` in favour of `-/filter_complex`, then removed the
  // alias from nightly builds; older stable builds do not understand the new
  // spelling. Prefer the legacy spelling for broad compatibility and retry
  // only when FFmpeg explicitly says that option is unavailable.
  const runMix = async (ignoreAutomation: boolean) => {
    const inputs: string[] = [];
    tracks.forEach((track) => inputs.push("-i", track.srcPath));
    const scriptDir = mkdtempSync(join(outputDir, ".filter-complex-"));
    const scriptPath = join(scriptDir, "graph.txt");
    const fd = openSync(scriptPath, "wx", 0o600);
    try {
      writeFileSync(fd, buildFilterComplex(ignoreAutomation));
    } finally {
      closeSync(fd);
    }
    const args = [
      ...inputs,
      "-filter_complex_script",
      scriptPath,
      "-map",
      "[out]",
      "-acodec",
      "aac",
      "-b:a",
      "192k",
      "-t",
      String(totalDuration),
      "-y",
      outputPath,
    ];
    try {
      const legacyResult = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });
      if (legacyResult.success || !legacyFilterScriptOptionIsUnsupported(legacyResult.stderr)) {
        return legacyResult;
      }
      const currentArgs = [...args];
      currentArgs[currentArgs.indexOf("-filter_complex_script")] = "-/filter_complex";
      return await runFfmpeg(currentArgs, { signal, timeout: ffmpegProcessTimeout });
    } finally {
      rmSync(scriptDir, { recursive: true, force: true });
    }
  };

  let result = await runMix(false);

  // Defense in depth: volume automation is folded into an FFmpeg `volume`
  // expression whose evaluator limits are build-dependent (see
  // MAX_VOLUME_SEGMENTS). If that ever fails the mix, retry once without the
  // automation so the track renders at its base volume rather than being
  // dropped from the output entirely — a missing fade beats missing audio.
  let degradedAutomation = false;
  const hasAutomation = tracks.some((track) => (track.volumeKeyframes?.length ?? 0) > 0);
  if (!result.success && !signal?.aborted && hasAutomation) {
    const retry = await runMix(true);
    if (retry.success) {
      result = retry;
      degradedAutomation = true;
    }
  }

  if (signal?.aborted) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      tracksProcessed: 0,
      error: "Audio mix cancelled",
    };
  }
  if (!result.success) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      tracksProcessed: 0,
      error:
        result.exitCode !== null ? `FFmpeg exited with code ${result.exitCode}` : result.stderr,
    };
  }
  return {
    success: true,
    outputPath,
    durationMs: result.durationMs,
    tracksProcessed: tracks.length,
    error: degradedAutomation
      ? "Volume automation exceeded this ffmpeg build's expression limits; rendered at base volume"
      : undefined,
  };
}

export async function processCompositionAudio(
  elements: AudioElement[],
  baseDir: string,
  workDir: string,
  outputPath: string,
  totalDuration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout" | "audioGain">>,
  compiledDir?: string,
): Promise<MixResult> {
  const startMs = Date.now();
  const tracks: AudioTrack[] = [];
  const errors: string[] = [];

  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  // Every element's async work (extract/prepare/VST-bounce) races concurrently
  // below via Promise.all. Promise.all rejects as soon as the FIRST element's
  // chain rejects (a VstChainProcessingError, see above) — it does NOT wait
  // for sibling elements still in flight. Without this controller, a sibling's
  // VST sidecar subprocess (up to BOUNCE_TIMEOUT_MS) keeps running unmanaged
  // after the `finally` block below deletes `workDir` out from under it. This
  // internal signal is threaded into every element's chain (including
  // applyVstChainToWav) and aborted the moment Promise.all rejects, so
  // in-flight siblings get a chance to kill their subprocess before workDir
  // disappears. It also aborts if the caller's own `signal` fires, preserving
  // external-cancellation behavior.
  const internalController = new AbortController();
  const effectiveSignal = internalController.signal;
  if (signal) {
    if (signal.aborted) internalController.abort();
    else signal.addEventListener("abort", () => internalController.abort(), { once: true });
  }

  try {
    try {
      await Promise.all(
        elements.map(async (element) => {
          if (effectiveSignal.aborted) {
            errors.push(`Cancelled: ${element.id}`);
            return;
          }
          try {
            let srcPath = element.src;
            if (!isHttpUrl(srcPath)) {
              // Same browser-vs-filesystem path semantics as videos — see
              // resolveProjectRelativeSrc in videoFrameExtractor for the full why.
              srcPath = resolveProjectRelativeSrc(element.src, baseDir, compiledDir);
            }

            if (isHttpUrl(srcPath)) {
              try {
                srcPath = await downloadToTemp(srcPath, workDir);
              } catch (err: unknown) {
                errors.push(
                  `Download failed: ${element.id} — ${err instanceof Error ? err.message : String(err)}`,
                );
                return;
              }
            }

            if (!existsSync(srcPath)) {
              errors.push(`Source not found: ${element.id} (${element.src})`);
              return;
            }

            // Fallback: if no duration was specified, probe the actual file
            if (element.end - element.start <= 0) {
              const metadata = await extractAudioMetadata(srcPath);
              const effectiveDuration = metadata.durationSeconds - element.mediaStart;
              element.end =
                element.start +
                (effectiveDuration > 0 ? effectiveDuration : metadata.durationSeconds);
            }

            let audioSrcPath = srcPath;
            if (element.type === "video") {
              const extractedPath = join(workDir, `${element.id}-extracted.wav`);
              const extractResult = await extractAudioFromVideo(
                srcPath,
                extractedPath,
                {
                  startTime: element.mediaStart,
                  duration: element.end - element.start,
                },
                effectiveSignal,
                config,
              );
              if (!extractResult.success) {
                errors.push(`Extract failed: ${element.id}`);
                return;
              }
              audioSrcPath = extractedPath;
            } else {
              const trimmedPath = join(workDir, `${element.id}-trimmed.wav`);
              const prepResult = await prepareAudioTrack(
                srcPath,
                trimmedPath,
                element.mediaStart,
                element.end - element.start,
                effectiveSignal,
                config,
              );
              if (!prepResult.success) {
                errors.push(`Prepare failed: ${element.id}`);
                return;
              }
              audioSrcPath = trimmedPath;
            }

            // Apply the track's VST plugin chain (if any) to the dry, trimmed WAV
            // before volume automation is baked in — plugins should see the raw
            // signal, and the envelope should be applied to their output.
            // A missing plugin or sidecar failure is a hard failure for this
            // track: never silently fall back to unprocessed audio.
            if (element.vstChain) {
              const chainAbsPath = resolveProjectRelativeSrc(
                element.vstChain,
                baseDir,
                compiledDir,
              );
              if (!existsSync(chainAbsPath)) {
                throw new VstChainProcessingError(
                  `VST chain file not found for track "${element.id}": ${element.vstChain}`,
                );
              }
              try {
                audioSrcPath = await applyVstChainToWav(
                  audioSrcPath,
                  chainAbsPath,
                  workDir,
                  element.id,
                  { signal: effectiveSignal },
                );
              } catch (err: unknown) {
                throw new VstChainProcessingError(err instanceof Error ? err.message : String(err));
              }
            }

            // Primary volume-automation path: bake the envelope into the PCM samples
            // (sample-accurate, no keyframe ceiling). If the WAV isn't the expected
            // 16-bit PCM, fall back to the ffmpeg expression path by leaving the
            // keyframes on the track for buildVolumeExpression to handle.
            let bakedEnvelope = false;
            if (element.volumeKeyframes && element.volumeKeyframes.length > 0) {
              bakedEnvelope = applyVolumeEnvelopeToWav(
                audioSrcPath,
                element.volumeKeyframes,
                element.start,
                element.volume ?? 1.0,
              );
            }
            tracks.push({
              id: element.id,
              srcPath: audioSrcPath,
              start: element.start,
              end: element.end,
              mediaStart: element.mediaStart,
              duration: element.end - element.start,
              // Gain is already in the samples when baked, so mix at unity.
              volume: bakedEnvelope ? 1.0 : (element.volume ?? 1.0),
              volumeKeyframes: bakedEnvelope ? undefined : element.volumeKeyframes,
            });
          } catch (err: unknown) {
            // A VST failure is fatal for the whole call — rethrow so it escapes
            // this element's Promise, rejects the `Promise.all` below, and
            // propagates out of `processCompositionAudio`. Every other failure
            // mode (missing source asset, download failure, extract/prepare
            // failure) keeps degrading gracefully: recorded as a warning, track
            // dropped, loop continues.
            if (err instanceof VstChainProcessingError) throw err;
            errors.push(
              `Error: ${element.id} — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }),
      );
    } catch (err) {
      // Reject early (a sibling's VstChainProcessingError) without waiting for
      // other in-flight elements — abort them now so their subprocess (e.g. a
      // VST sidecar) has a chance to see the signal and stop before the
      // `finally` block below deletes `workDir` out from under it.
      internalController.abort();
      throw err;
    }

    // Never turn a per-track preparation failure into a successful partial mix.
    // The producer only surfaces audio failures when `success` is false; mixing
    // the remaining tracks made the omitted cue indistinguishable from a valid
    // render unless someone manually audited that exact audio window.
    if (errors.length > 0) {
      return {
        success: false,
        outputPath,
        durationMs: Date.now() - startMs,
        tracksProcessed: tracks.length,
        error: `Audio processing failed: ${errors.join(", ")}`,
      };
    }

    const mixResult = await mixAudioTracks(tracks, outputPath, totalDuration, signal, config);

    return {
      ...mixResult,
      durationMs: Date.now() - startMs,
      error: errors.length > 0 ? `Warnings: ${errors.join(", ")}` : mixResult.error,
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
