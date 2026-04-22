/**
 * Audio Mixer Service
 *
 * Processes and mixes audio tracks using FFmpeg.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { parseHTML } from "linkedom";
import { extractAudioMetadata } from "../utils/ffprobe.js";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";
import type { AudioElement, AudioTrack, MixResult } from "./audioMixer.types.js";

export type { AudioElement, AudioTrack, MixResult } from "./audioMixer.types.js";

interface ExtractResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
}

export function parseAudioElements(html: string): AudioElement[] {
  const elements: AudioElement[] = [];
  const { document } = parseHTML(html);

  // Parse <audio> elements
  const audioEls = document.querySelectorAll("audio[id][src]");
  for (const el of audioEls) {
    const id = el.getAttribute("id");
    const src = el.getAttribute("src");
    if (!id || !src) continue;

    const startAttr = el.getAttribute("data-start");
    const endAttr = el.getAttribute("data-end");
    const mediaStartAttr = el.getAttribute("data-media-start");
    const layerAttr = el.getAttribute("data-layer");
    const volumeAttr = el.getAttribute("data-volume");

    elements.push({
      id,
      src,
      start: startAttr ? parseFloat(startAttr) : 0,
      end: endAttr ? parseFloat(endAttr) : 0,
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      layer: layerAttr ? parseInt(layerAttr) : 0,
      volume: volumeAttr ? parseFloat(volumeAttr) : 1.0,
      type: "audio",
    });
  }

  // Parse <video> elements with data-has-audio="true"
  const videoEls = document.querySelectorAll('video[id][src][data-has-audio="true"]');
  for (const el of videoEls) {
    const id = el.getAttribute("id");
    const src = el.getAttribute("src");
    if (!id || !src) continue;

    const startAttr = el.getAttribute("data-start");
    const endAttr = el.getAttribute("data-end");
    const mediaStartAttr = el.getAttribute("data-media-start");
    const layerAttr = el.getAttribute("data-layer");
    const volumeAttr = el.getAttribute("data-volume");

    elements.push({
      id: `${id}-audio`,
      src,
      start: startAttr ? parseFloat(startAttr) : 0,
      end: endAttr ? parseFloat(endAttr) : 0,
      mediaStart: mediaStartAttr ? parseFloat(mediaStartAttr) : 0,
      layer: layerAttr ? parseInt(layerAttr) : 0,
      volume: volumeAttr ? parseFloat(volumeAttr) : 1.0,
      type: "video",
    });
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
  args.push("-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", "-y", outputPath);

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  if (signal?.aborted) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: "Audio extract cancelled",
    };
  }
  if (!result.success) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error:
        result.exitCode !== null ? `FFmpeg exited with code ${result.exitCode}` : result.stderr,
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
    "-ac",
    "2",
    "-y",
    outputPath,
  ];

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

  if (signal?.aborted) {
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: "Audio prepare cancelled",
    };
  }
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: !result.success
      ? result.exitCode !== null
        ? `FFmpeg exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`
        : result.stderr
      : undefined,
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
    return {
      success: false,
      outputPath,
      durationMs: result.durationMs,
      error: "Silence generation cancelled",
    };
  }
  return {
    success: result.success,
    outputPath,
    durationMs: result.durationMs,
    error: !result.success
      ? result.exitCode !== null
        ? `FFmpeg exited with code ${result.exitCode}`
        : result.stderr
      : undefined,
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
    };
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const inputs: string[] = [];
  const filterParts: string[] = [];

  tracks.forEach((track, i) => {
    inputs.push("-i", track.srcPath);
    const delayMs = Math.round(track.start * 1000);
    const trimDuration = track.end - track.start;
    filterParts.push(
      `[${i}:a]atrim=0:${trimDuration},volume=${track.volume},adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDuration}[a${i}]`,
    );
  });

  const mixInputs = tracks.map((_, i) => `[a${i}]`).join("");
  const weights = tracks.map(() => "1").join(" ");
  const mixFilter = `${mixInputs}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0:weights='${weights}'[mixed]`;
  const postMixGainFilter = `[mixed]volume=${masterOutputGain}[out]`;
  const fullFilter = [...filterParts, mixFilter, postMixGainFilter].join(";");

  const args = [
    ...inputs,
    "-filter_complex",
    fullFilter,
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

  const result = await runFfmpeg(args, { signal, timeout: ffmpegProcessTimeout });

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

  await Promise.all(
    elements.map(async (element) => {
      if (signal?.aborted) {
        errors.push(`Cancelled: ${element.id}`);
        return;
      }
      try {
        let srcPath = element.src;
        if (!srcPath.startsWith("/") && !isHttpUrl(srcPath)) {
          const fromCompiled = compiledDir ? join(compiledDir, srcPath) : null;
          srcPath =
            fromCompiled && existsSync(fromCompiled) ? fromCompiled : join(baseDir, srcPath);
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
            signal,
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
            signal,
            config,
          );
          if (!prepResult.success) {
            errors.push(`Prepare failed: ${element.id}`);
            return;
          }
          audioSrcPath = trimmedPath;
        }

        tracks.push({
          id: element.id,
          srcPath: audioSrcPath,
          start: element.start,
          end: element.end,
          mediaStart: element.mediaStart,
          duration: element.end - element.start,
          volume: element.volume ?? 1.0,
        });
      } catch (err: unknown) {
        errors.push(`Error: ${element.id} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  const mixResult = await mixAudioTracks(tracks, outputPath, totalDuration, signal, config);

  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return {
    ...mixResult,
    durationMs: Date.now() - startMs,
    error: errors.length > 0 ? `Warnings: ${errors.join(", ")}` : mixResult.error,
  };
}
