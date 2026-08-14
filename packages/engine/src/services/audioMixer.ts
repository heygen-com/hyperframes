// fallow-ignore-file complexity code-duplication
/**
 * Audio Mixer Service
 *
 * Processes and mixes audio tracks using FFmpeg.
 */

import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { parseHTML } from "linkedom";
import { extractAudioMetadata } from "../utils/ffprobe.js";
import { isNotMediaPayload } from "../utils/notMediaPayload.js";
import {
  downloadToTemp,
  isHttpUrl,
  UrlDownloadError,
  writeUrlDownloadTelemetry,
} from "../utils/urlDownloader.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { formatFfmpegError, runFfmpeg, type RunFfmpegResult } from "../utils/runFfmpeg.js";
import { unwrapTemplate } from "../utils/htmlTemplate.js";
import { resolveProjectRelativeSrc } from "./videoFrameExtractor.js";
import { resolveReferencedStart, type RefResolverEl } from "./referenceResolver.js";
import type {
  AudioElement,
  AudioFailureStage,
  AudioProcessingFailure,
  AudioTrack,
  MixResult,
} from "./audioMixer.types.js";
import { applyVolumeEnvelopeToWav } from "./audioVolumeEnvelope.js";
import { HF_AUDIO_FX_ATTR, parseAudioFxChain } from "@hyperframes/core/audio-fx";
import {
  HF_AUDIO_AUTOMATION_ATTR,
  parseAutomation,
  resolveAutomation,
  sampleAutomationLane,
  VOLUME_TARGET,
  type HfAutomationLane,
} from "@hyperframes/core/audio-automation";
import { chainTailSeconds } from "@hyperframes/core/audio-fx-tail";
import { applyAudioFxChain, AudioFxRenderError } from "./audioFxRender.js";
import type { AudioVolumeKeyframe } from "./audioMixer.types.js";

export type { AudioElement, MixResult } from "./audioMixer.types.js";

/**
 * Filename every caller must use for the mixed-audio artifact.
 *
 * The extension is load-bearing, not cosmetic: FFmpeg picks the muxer from it,
 * and the mix is AAC-encoded. A raw ADTS `.aac` stream has nowhere to record
 * the encoder's priming delay, so those leading samples decode as real silence
 * and shift the whole track ~1024 samples (21.33 ms at 48 kHz) late against a
 * frame-accurate video track. An MP4-family container carries the delay as an
 * edit list, which every decoder then strips, so the mix lands on its authored
 * start. Keep the choice here rather than at each call site: the same file is
 * muxed into the video, shipped in a distributed plan, and handed to users as
 * the PNG-sequence sidecar, and all three have to agree.
 */
export const MIXED_AUDIO_FILENAME = "audio.m4a";

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
  failure?: AudioProcessingFailure;
}

function boundedDetail(message: string, maxLength = 2_000): string {
  const redacted = message
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "<redacted-url>")
    .replace(/\bfile:\/\/[^\s"'<>]+/gi, "<redacted-path>")
    .replace(
      /\b[A-Za-z]:[\\/].+?(?=:\s[A-Z]|\s(?:ENOENT|EACCES|EPERM)\b|\r?$)/gm,
      "<redacted-path>",
    )
    .replace(
      /(^|[\s"'(])\/.+?(?=:\s[A-Z]|\s(?:ENOENT|EACCES|EPERM)\b|\r?$)/gm,
      "$1<redacted-path>",
    );
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}…`;
}

function probeFailure(message: string, elementId: string): AudioProcessingFailure {
  const unavailable = /(?:not found|ENOENT|spawn)/i.test(message);
  const cancelled = /(?:aborted|AbortError|cancelled|canceled)/i.test(message);
  const timedOut = /(?:timed?\s*out|timeout|deadline|inactivity)/i.test(message);
  const invalidMedia =
    /(?:invalid data found|could not find codec parameters|moov atom not found|no audio stream)/i.test(
      message,
    );
  return {
    stage: "probe",
    reason: cancelled
      ? "cancelled"
      : invalidMedia
        ? "invalid_media"
        : unavailable
          ? "ffmpeg_unavailable"
          : timedOut
            ? "ffmpeg_timeout"
            : "probe_failed",
    owner: cancelled || invalidMedia ? "user" : "system",
    retryable: !cancelled && !invalidMedia && (unavailable || timedOut),
    elementId,
    detail: boundedDetail(`Audio probe failed for element ${elementId}: ${message}`),
  };
}

function downloadFailure(error: unknown, elementId: string): AudioProcessingFailure {
  const message = error instanceof Error ? error.message : String(error);
  const invalidSource =
    error instanceof UrlDownloadError
      ? error.kind === "http_not_found" ||
        error.kind === "http_rejected" ||
        error.kind === "invalid_payload" ||
        error.kind === "cancelled"
      : /(?:invalid URL|only HTTPS|private\/reserved|HTTP (?:400|401|403|404|405|410|422)\b)/i.test(
          message,
        );
  const retryable = error instanceof UrlDownloadError ? error.retryable : !invalidSource;
  return {
    stage: "download",
    reason: "download_failed",
    owner: invalidSource ? "user" : "system",
    retryable,
    elementId,
    detail: boundedDetail(`Download failed for audio element ${elementId}: ${message}`),
  };
}

function ffmpegFailure(
  stage: Extract<AudioFailureStage, "extract" | "prepare" | "mix" | "silence">,
  result: RunFfmpegResult,
  elementId?: string,
): AudioProcessingFailure {
  const stderr = result.stderr ?? "";
  let reason: AudioProcessingFailure["reason"] = "ffmpeg_failed";
  let owner: AudioProcessingFailure["owner"] = "system";
  let retryable = false;

  if (result.terminationReason === "abort") {
    reason = "cancelled";
    owner = "user";
  } else if (result.terminationReason === "deadline" || result.terminationReason === "inactivity") {
    reason = "ffmpeg_timeout";
    retryable = true;
  } else if (result.terminationReason === "spawn_error") {
    reason = "ffmpeg_unavailable";
    retryable = true;
  } else if (
    /(?:unrecognized option|option (?:was )?not found|no option name near)/i.test(stderr)
  ) {
    reason = "ffmpeg_unsupported";
  } else if (
    (stage === "extract" || stage === "prepare") &&
    /(?:invalid data found|could not find codec parameters|moov atom not found)/i.test(stderr)
  ) {
    reason = "invalid_media";
    owner = "user";
  }

  return {
    stage,
    reason,
    owner,
    retryable,
    elementId,
    detail: boundedDetail(
      result.error?.message
        ? `${formatFfmpegError(result.exitCode, stderr)}: ${result.error.message}`
        : formatFfmpegError(result.exitCode, stderr),
    ),
  };
}

/** Extra samples per second inside a segment the baker cannot draw straight. */
const CURVED_SEGMENT_SAMPLES_PER_SEC = 30;

/**
 * A volume lane as keyframes for the PCM baker.
 *
 * The baker interpolates linearly between keyframes, so a straight segment
 * needs only its two ends — a simple fade stays two keyframes. A bent one is
 * sampled, or the bake would quietly straighten it.
 *
 * Times come out in composition seconds, which is what the baker subtracts the
 * track start from. Returns null when the track has no volume lane.
 */
export function volumeLaneKeyframes(
  automation: { lanes: HfAutomationLane[] },
  trackStart: number,
  duration: number,
): AudioVolumeKeyframe[] | null {
  const lane = automation.lanes.find((l) => l.target === VOLUME_TARGET);
  if (!lane || lane.points.length === 0) return null;

  const out: AudioVolumeKeyframe[] = [];
  const push = (t: number, v: number): void => {
    out.push({ time: trackStart + t, volume: v });
  };

  // The envelope holds its first value before the first point, rather than
  // falling back to `data-volume`.
  const first = lane.points[0]!;
  if (first.t > 0) push(0, first.v);

  for (let i = 0; i < lane.points.length; i += 1) {
    const a = lane.points[i]!;
    push(a.t, a.v);
    const b = lane.points[i + 1];
    if (!b || !a.curve) continue;
    const steps = Math.max(2, Math.ceil((b.t - a.t) * CURVED_SEGMENT_SAMPLES_PER_SEC));
    for (let k = 1; k < steps; k += 1) {
      const t = a.t + ((b.t - a.t) * k) / steps;
      push(t, sampleAutomationLane(lane, t));
    }
  }

  // Hold the last value to the clip's end, so the baker does not ramp away
  // from it toward whatever it would otherwise assume.
  const last = lane.points[lane.points.length - 1]!;
  if (duration > last.t) push(duration, last.v);
  return out;
}

export function parseAudioElements(html: string): AudioElement[] {
  const elements: AudioElement[] = [];
  const { document } = parseHTML(unwrapTemplate(html));
  interface AudioMediaElement extends RefResolverEl {
    hasAttribute(name: string): boolean;
    parentElement: AudioMediaElement | null;
  }

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
  const isHidden = (el: AudioMediaElement): boolean => {
    for (let current: AudioMediaElement | null = el; current; current = current.parentElement) {
      if (current.hasAttribute("data-hidden")) return true;
    }
    return false;
  };

  // <audio> and <video data-has-audio> tracks differ only in the emitted id

  // and `type`; everything else (timing, layer, volume) is read identically.
  const build = (el: RefResolverEl, id: string, type: AudioElement["type"]): AudioElement => {
    const mediaStartAttr = el.getAttribute("data-media-start");
    const layerAttr = el.getAttribute("data-layer");
    const volumeAttr = el.getAttribute("data-volume");
    const fxChain = el.getAttribute(HF_AUDIO_FX_ATTR);
    const automation = el.getAttribute(HF_AUDIO_AUTOMATION_ATTR);
    return {
      id,
      src: el.getAttribute("src") as string,
      start: resolveStart(el),
      end: parseEnd(el.getAttribute("data-end")),
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      layer: layerAttr ? parseInt(layerAttr) : 0,
      volume: volumeAttr ? parseFloat(volumeAttr) : 1.0,
      ...(fxChain ? { fxChain } : {}),
      ...(automation ? { automation } : {}),
      type,
    };
  };

  for (const el of document.querySelectorAll("audio[id][src]")) {
    const id = el.getAttribute("id");
    if (!id || !el.getAttribute("src") || isHidden(el)) continue;
    elements.push(build(el, id, "audio"));
  }

  for (const el of document.querySelectorAll('video[id][src][data-has-audio="true"]')) {
    const id = el.getAttribute("id");
    if (!id || !el.getAttribute("src") || isHidden(el)) continue;
    elements.push(build(el, `${id}-audio`, "video"));
  }

  return elements;
}

async function extractAudioFromVideo(
  videoPath: string,
  outputPath: string,
  options?: { startTime?: number; duration?: number },
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const args: string[] = ["-i", videoPath];
  if (options?.startTime !== undefined) args.push("-ss", String(options.startTime));
  if (options?.duration !== undefined) args.push("-t", String(options.duration));
  const channelArgs = await stereoOutputArgs(videoPath);
  args.push("-vn", "-acodec", "pcm_s16le", "-ar", "48000", ...channelArgs, "-y", outputPath);

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  if (signal?.aborted) {
    const failure: AudioProcessingFailure = {
      stage: "cancelled",
      reason: "cancelled",
      owner: "user",
      retryable: false,
      detail: "Audio extract cancelled",
    };
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: failure.detail,
      failure,
    };
  }
  if (!result.success) {
    const failure = ffmpegFailure("extract", result);
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: failure.detail,
      failure,
    };
  }
  return { success: true, outputPath, durationMs: result.durationMs };
}

async function prepareAudioTrack(
  srcPath: string,
  outputPath: string,
  mediaStart: number,
  duration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
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

  if (signal?.aborted) {
    const failure: AudioProcessingFailure = {
      stage: "cancelled",
      reason: "cancelled",
      owner: "user",
      retryable: false,
      detail: "Audio prepare cancelled",
    };
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: failure.detail,
      failure,
    };
  }
  const failure = !result.success ? ffmpegFailure("prepare", result) : undefined;
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: failure?.detail,
    failure,
  };
}

async function generateSilence(
  outputPath: string,
  duration: number,
  signal?: AbortSignal,
  config?: Partial<Pick<EngineConfig, "ffmpegProcessTimeout">>,
): Promise<ExtractResult> {
  const ffmpegProcessTimeout = config?.ffmpegProcessTimeout ?? DEFAULT_CONFIG.ffmpegProcessTimeout;
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

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

  if (signal?.aborted) {
    const failure: AudioProcessingFailure = {
      stage: "cancelled",
      reason: "cancelled",
      owner: "user",
      retryable: false,
      detail: "Silence generation cancelled",
    };
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: failure.detail,
      failure,
    };
  }
  const failure = !result.success ? ffmpegFailure("silence", result) : undefined;
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: failure?.detail,
    failure,
  };
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
      failures: result.failure ? [result.failure] : undefined,
    };
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const buildFilterComplex = (ignoreAutomation: boolean): string => {
    const filterParts: string[] = [];
    tracks.forEach((track, i) => {
      const delayMs = Math.round(track.start * 1000);
      // A clip's own audio ends at `end`, but an FX tail is still decaying past
      // it. Trimming at the boundary is what cut every reverb short; the final
      // atrim below still holds the mix to the composition's length, so a tail
      // can run over what follows but never past the end of the video.
      const trimDuration = track.end - track.start + (track.tailSeconds ?? 0);
      const volumeFilter = buildVolumeExpression(track, ignoreAutomation);
      filterParts.push(
        `[${i}:a]atrim=0:${formatFilterNumber(trimDuration)},${volumeFilter},adelay=${delayMs}|${delayMs},apad,atrim=0:${formatFilterNumber(totalDuration)}[a${i}]`,
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
      failures: [
        {
          stage: "cancelled",
          reason: "cancelled",
          owner: "user",
          retryable: false,
          detail: "Audio mix cancelled",
        },
      ],
    };
  }
  if (!result.success) {
    const failure = ffmpegFailure("mix", result);
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      tracksProcessed: 0,
      error: failure.detail,
      failures: [failure],
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
  const failures: AudioProcessingFailure[] = [];

  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  // Every element's work races under Promise.all, which rejects on the first
  // failure without waiting for its siblings. A fatal FX error therefore has to
  // be able to abort the in-flight ffmpeg runs before the finally-block removes
  // workDir out from under them. Chained off the caller's signal so external
  // cancellation still behaves as before.
  //
  // Every child that can outlive a sibling's failure has to be given THIS
  // signal, not the caller's: the trim, the video extract and the download all
  // took `signal`, so `internalController.abort()` cancelled nothing and the
  // `rmSync(workDir)` on the next line ran while their ffmpeg children were
  // still writing into it.
  const internalController = new AbortController();
  const effectiveSignal = internalController.signal;
  if (signal) {
    if (signal.aborted) internalController.abort();
    else signal.addEventListener("abort", () => internalController.abort(), { once: true });
  }

  await Promise.all(
    elements.map(async (element) => {
      if (effectiveSignal.aborted) {
        failures.push({
          stage: "cancelled",
          reason: "cancelled",
          owner: "user",
          retryable: false,
          elementId: element.id,
          detail: boundedDetail(`Cancelled audio element ${element.id}`),
        });
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
            srcPath = await downloadToTemp(
              srcPath,
              workDir,
              undefined,
              effectiveSignal,
              undefined,
              {
                onTelemetry: writeUrlDownloadTelemetry,
              },
            );
          } catch (err: unknown) {
            failures.push(downloadFailure(err, element.id));
            return;
          }
        }

        if (!existsSync(srcPath)) {
          failures.push({
            stage: "source",
            reason: "source_not_found",
            owner: "user",
            retryable: false,
            elementId: element.id,
            detail: boundedDetail(`Source not found for audio element ${element.id}`),
          });
          return;
        }

        // STUDIO-5433: an audio src that resolved to a text document (an
        // unresolved nested-composition preview URL, or a 403/404 body served
        // with a 200) never reaches the probe below when the element carries an
        // authored duration or `loop`. It then fails inside ffmpeg as
        // `prepare/ffmpeg_failed` with owner "system" — an authoring bug paged
        // as a platform fault, after every frame has already been captured.
        if (await isNotMediaPayload(srcPath)) {
          failures.push({
            stage: "source",
            reason: "invalid_media",
            owner: "user",
            retryable: false,
            elementId: element.id,
            detail: boundedDetail(
              `Audio element ${element.id} source is a text document (HTML/XML/JSON), not media`,
            ),
          });
          return;
        }

        // Fallback: if no duration was specified, probe the actual file
        if (element.end - element.start <= 0) {
          let metadata;
          try {
            metadata = await extractAudioMetadata(srcPath);
          } catch (err: unknown) {
            failures.push(
              probeFailure(err instanceof Error ? err.message : String(err), element.id),
            );
            return;
          }
          const effectiveDuration = metadata.durationSeconds - element.mediaStart;
          element.end =
            element.start + (effectiveDuration > 0 ? effectiveDuration : metadata.durationSeconds);
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
            failures.push(
              extractResult.failure
                ? { ...extractResult.failure, elementId: element.id }
                : {
                    stage: "extract",
                    reason: "ffmpeg_failed",
                    owner: "system",
                    retryable: false,
                    elementId: element.id,
                    detail: boundedDetail(`Audio extract failed for element ${element.id}`),
                  },
            );
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
            failures.push(
              prepResult.failure
                ? { ...prepResult.failure, elementId: element.id }
                : {
                    stage: "prepare",
                    reason: "ffmpeg_failed",
                    owner: "system",
                    retryable: false,
                    elementId: element.id,
                    detail: boundedDetail(`Audio prepare failed for element ${element.id}`),
                  },
            );
            return;
          }
          audioSrcPath = trimmedPath;
        }

        // Apply the track's FX chain to the dry, trimmed audio, before volume
        // automation is baked in: effects should see the raw signal, and the
        // envelope belongs on their output. A missing or broken chain is fatal
        // for the whole mix rather than a per-track warning — quietly rendering
        // the dry signal ships a mix that sounds plausible and is wrong.
        const automation = element.automation
          ? resolveAutomation(
              parseAutomation(element.automation),
              element.fxChain ? parseAudioFxChain(element.fxChain) : undefined,
            )
          : null;

        // Computed before the chain runs, not after: the FX pass bakes the
        // envelope into its float output so the duck lands before the ±1 clamp
        // in writeWav, instead of after it.
        //
        // A volume lane supersedes keyframes probed from the timeline: the two
        // would fight, and the lane is the explicit one. `lint` warns when a
        // track carries both.
        const laneKeyframes = automation
          ? volumeLaneKeyframes(automation, element.start, element.end - element.start)
          : null;
        const envelopeKeyframes = laneKeyframes ?? element.volumeKeyframes;
        const envelope =
          envelopeKeyframes && envelopeKeyframes.length > 0
            ? {
                keyframes: envelopeKeyframes,
                trackStart: element.start,
                baseVolume: element.volume ?? 1.0,
              }
            : null;

        let bakedEnvelope = false;
        let tailSeconds = 0;
        if (element.fxChain) {
          // The chain is serialised into the attribute, the same way colour
          // grading carries its config, so there is no side-car file to find,
          // resolve or lose.
          const chain = parseAudioFxChain(element.fxChain);
          // The rendered WAV is longer than the input by exactly this much, so
          // the mix has to be told to let it through.
          tailSeconds = chainTailSeconds(chain, automation ?? undefined);
          const fxResult = await applyAudioFxChain(
            audioSrcPath,
            chain,
            join(workDir, `${element.id}-fx.wav`),
            {
              trackId: element.id,
              signal: effectiveSignal,
              ...(automation ? { automation } : {}),
              ...(envelope ? { envelope } : {}),
            },
          );
          audioSrcPath = fxResult.path;
          bakedEnvelope = fxResult.envelopeBaked;
        }

        // Primary volume-automation path for a track the FX pass did not bake:
        // multiply the envelope into the PCM samples (sample-accurate, no
        // keyframe ceiling). If the WAV isn't the expected 16-bit PCM, fall
        // back to the ffmpeg expression path by leaving the keyframes on the
        // track for buildVolumeExpression to handle.
        if (envelope && !bakedEnvelope) {
          bakedEnvelope = applyVolumeEnvelopeToWav(
            audioSrcPath,
            envelope.keyframes,
            envelope.trackStart,
            envelope.baseVolume,
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
          volumeKeyframes: bakedEnvelope ? undefined : (envelopeKeyframes ?? undefined),
          ...(tailSeconds > 0 ? { tailSeconds } : {}),
        });
      } catch (err: unknown) {
        // An FX failure is fatal for the whole mix. Every other failure mode
        // degrades gracefully — the track drops and siblings continue — but
        // substituting the dry signal for a processed one ships a render that
        // sounds plausible and is not what was authored.
        if (err instanceof AudioFxRenderError) throw err;
        failures.push({
          stage: "internal",
          reason: "internal",
          owner: "system",
          retryable: false,
          elementId: element.id,
          detail: boundedDetail(
            `Audio processing failed for element ${element.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        });
      }
    }),
  ).catch((err: unknown) => {
    // Promise.all rejected on the first fatal failure without waiting for its
    // siblings; abort them so their ffmpeg stops before workDir disappears.
    internalController.abort();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  });

  // Never turn a per-track preparation failure into a successful partial mix.
  // The producer only surfaces audio failures when `success` is false; mixing
  // the remaining tracks made the omitted cue indistinguishable from a valid
  // render unless someone manually audited that exact audio window.
  if (failures.length > 0) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return {
      success: false,
      outputPath,
      durationMs: Date.now() - startMs,
      tracksProcessed: tracks.length,
      error: boundedDetail(
        `Audio processing failed: ${failures.map((failure) => failure.detail).join(", ")}`,
      ),
      failures,
    };
  }

  const mixResult = await mixAudioTracks(tracks, outputPath, totalDuration, signal, config);

  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return {
    ...mixResult,
    durationMs: Date.now() - startMs,
    error: mixResult.error,
  };
}
