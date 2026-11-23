/**
 * HDR passthrough composite: one ffmpeg run that overlays the cached state
 * PNGs onto the source HDR video and encodes the video-only output.
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fpsToFfmpegArg, fpsToNumber } from "@hyperframes/core";
import {
  buildStreamingArgs,
  ffmpegSeekSeconds,
  ffmpegStatsReader,
  formatFfmpegError,
  getCachedGpuEncoder,
  getCachedNvencPresets,
  runFfmpeg,
  type GpuEncoder,
  type StreamingEncoderOptions,
} from "@hyperframes/engine";
import type { CapturedOverlay, CompositeRequest, CompositeResult } from "./types.js";

/** File name of the concat list written into `CompositeRequest.workDir`. */
const CONCAT_LIST_NAME = "hdr-passthrough-overlays.ffconcat";

const MICROS_PER_SECOND = 1_000_000;

/**
 * Slice threads for the swscale format conversions in the composite graph.
 * Each 1080p 16-bit conversion is otherwise single-threaded and caps the
 * graph below the encoder's speed. Slice threading does not change the
 * output pixels.
 */
const SWS_THREADS = 4;
const THREADED_SCALE = `scale=threads=${SWS_THREADS}`;
const convert = (pixFmt: string): string => `${THREADED_SCALE},format=${pixFmt}`;

/** GPU encoder resolved by the caller (`getCachedGpuEncoder`), so the builder stays pure. */
export interface CompositeGpuSelection {
  encoder: GpuEncoder;
  nvencPresets?: ReadonlySet<string>;
}

/**
 * Concat-demuxer playlist for the overlay states. Adjacent states that share
 * a PNG collapse into one entry. Each duration is the difference of the
 * microsecond-rounded state boundaries, so entry starts never drift from
 * `startFrame / fps` by more than half a microsecond however many states
 * there are. Every entry sets the image demuxer's `framerate` to the output
 * rate: its time base is otherwise 1/25 s, which rounds each start (0.5 s
 * lands on 0.52 s) and shifts state boundaries by up to a frame. With the
 * output rate as time base each start rounds to exactly `startFrame`. The
 * last file is listed again without a duration: the concat demuxer
 * otherwise drops the final entry's duration.
 */
export function buildOverlayConcatList(
  overlays: readonly CapturedOverlay[],
  fps: CompositeRequest["plan"]["fps"],
): string {
  if (overlays.length === 0) throw new Error("hdrPassthrough: no overlay states to composite");
  const runs: Array<{ pngPath: string; startFrame: number; endFrame: number }> = [];
  for (const { pngPath, state } of overlays) {
    const last = runs.at(-1);
    if (last && last.pngPath === pngPath && last.endFrame === state.startFrame) {
      last.endFrame = state.endFrame;
    } else {
      runs.push({ pngPath, startFrame: state.startFrame, endFrame: state.endFrame });
    }
  }
  const frameMicros = (frame: number): number =>
    Math.round((frame * fps.den * MICROS_PER_SECOND) / fps.num);
  const framerate = `option framerate ${fpsToFfmpegArg(fps)}`;
  const lines = ["ffconcat version 1.0"];
  for (const run of runs) {
    lines.push(`file ${quoteConcatPath(run.pngPath)}`, framerate);
    lines.push(`duration ${frameMicros(run.endFrame) - frameMicros(run.startFrame)}us`);
  }
  const final = runs.at(-1);
  if (final) lines.push(`file ${quoteConcatPath(final.pngPath)}`, framerate);
  return `${lines.join("\n")}\n`;
}

/** Concat-demuxer quoting: single-quoted, with `'` written as `'\''`. */
function quoteConcatPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/**
 * Filter graph for the composite. Both inputs are resampled onto the output
 * frame grid. The video is converted YUV → packed `rgb48le` exactly as the
 * layered path's HDR frame extraction does (`-pix_fmt rgb48le`), then
 * repacked losslessly to planar `gbrp16le` for the blend, and the overlay's
 * straight 16-bit alpha drives a `maskedmerge`:
 * `out = round(video * (1 - a) + signal * a)` with `a = alpha8 * 257 / 65535`,
 * `blitRgba8OverRgb48le`'s blend. ffmpeg 7 and 8 round it exactly that way (every
 * alpha, 102400 random samples per plane); 4.2 is 1 LSB off on about a sixth of the
 * partial-alpha samples. The result is repacked to `rgb48le` before `tail`, so the
 * RGB → YUV conversion is the one the layered encoder runs on its rgb48le
 * stdin. Swscale's planar and packed RGB paths round chroma differently;
 * going through `rgb48le` on both sides keeps the video pixels bit-identical
 * to the layered path wherever the overlay is transparent. ffmpeg's
 * `overlay` filter blends RGB at 8 bits only, so it cannot be used here.
 * `tail` is the encoder-side frame filter `buildStreamingArgs` emits for the
 * HDR raw-input path (colour tags, even-dimension pad, vaapi upload).
 */
function buildCompositeFilterGraph(request: CompositeRequest, tail: string): string {
  const { video, plan } = request;
  const fpsFilter = `fps=${fpsToFfmpegArg(plan.fps)}:start_time=0`;
  const videoChain = [fpsFilter];
  if (video.width !== plan.width || video.height !== plan.height) {
    // Same scale/crop as the layered path's HDR frame extraction, which also
    // converts to rgb48le in that one swscale pass.
    videoChain.push(
      `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase:threads=${SWS_THREADS}`,
      `crop=${plan.width}:${plan.height}`,
      "format=rgb48le",
    );
  } else {
    videoChain.push(convert("rgb48le"));
  }
  videoChain.push(convert("gbrp16le"));
  // Overlay frames are converted once per concat entry, before `fps` repeats
  // them onto the output grid.
  const blend = buildBlendFilters(videoChain.join(","), fpsFilter);
  return `${blend},${withThreadedOutputConversion(tail)}[vout]`;
}

/**
 * The blend half of the composite graph, shared with the blend self-test
 * (`ffmpegBlendCheck.ts`) so the two cannot drift apart: `[0:v]` through
 * `videoChain` (ending in `gbrp16le`), the `rgba64le` overlay on `[1:v]` split
 * into its colour planes and its alpha widened to a `gbrp16le` mask (each
 * followed by `overlayFilter` when set), the `maskedmerge`, and the repack to
 * `rgb48le`. The last chain is left open for the caller's tail and label.
 */
export function buildBlendFilters(videoChain: string, overlayFilter?: string): string {
  const after = overlayFilter ? `,${overlayFilter}` : "";
  return [
    `[0:v]${videoChain}[v]`,
    `[1:v]format=rgba64le,split[oc][oa]`,
    `[oc]format=gbrp16le${after}[o]`,
    `[oa]extractplanes=a,mergeplanes=0x000000:gbrp16le${after}[m]`,
    `[v][o][m]maskedmerge,${convert("rgb48le")}`,
  ].join(";");
}

/**
 * The encoder tail is a single `setparams` (colour tags) on the software and
 * nvenc paths; the RGB → YUV conversion ffmpeg inserts after it runs on one
 * thread. Ending the graph on a threaded `scale` moves that conversion into
 * it (same swscale path, so the same pixels). Tails that pad or upload are
 * left as they are, so their format negotiation is the layered encoder's.
 */
function withThreadedOutputConversion(tail: string): string {
  if (tail === "" || tail.includes(",")) return tail;
  return `${tail},${THREADED_SCALE}`;
}

/**
 * Builds the full ffmpeg argv (without the binary) for `compositeAndEncode`.
 * Pure; exported for argument-level unit tests.
 *
 *   - Input 0: the source video, seeked to `video.mediaStart` with the HDR
 *     extraction's seek normalization (`ffmpegSeekSeconds`, negative when the
 *     streams start after 0, as in the layered extraction), read for
 *     `video.duration` plus one output frame of slack.
 *   - Input 1: the overlay PNGs through the concat demuxer
 *     (`buildOverlayConcatList`).
 *   - Filter: `buildCompositeFilterGraph`.
 *   - Encoder: the encoder half of engine `buildStreamingArgs` for the
 *     layered stage's exact `spawnStreamingEncoder` options (codec, preset,
 *     crf/bitrate, delivery caps, GOP lock, GPU selection, `-x265-params`,
 *     bt2020 colour tags, `-tag:v hvc1`, provenance), with its `-vf` swapped
 *     for the composite graph. `-frames:v plan.totalFrames`, `-an`.
 */
export function buildCompositeArgs(
  request: CompositeRequest,
  concatListPath: string,
  gpu: CompositeGpuSelection = { encoder: null },
): string[] {
  const { video, plan, encoder, hdr, outputPath } = request;
  const options: StreamingEncoderOptions = {
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    codec: encoder.preset.codec,
    useGpu: encoder.useGpu,
    preset: encoder.preset.preset,
    quality: encoder.effectiveQuality,
    bitrate: encoder.effectiveBitrate,
    ...encoder.deliveryEncoder,
    pixelFormat: encoder.preset.pixelFormat,
    hdr,
    rawInputFormat: "rgb48le",
  };
  const streaming = buildStreamingArgs(options, outputPath, gpu.encoder, gpu.nvencPresets);

  // Split the stdin raw-frame input off the streaming argv: global options
  // before it (vaapi device), encoder + output options after it.
  const inputStart = streaming.findIndex(
    (arg, i) => arg === "-f" && streaming[i + 1] === "rawvideo",
  );
  const inputEnd = streaming.findIndex((arg, i) => arg === "-i" && streaming[i + 1] === "-");
  const vfIndex = streaming.indexOf("-vf", inputEnd);
  const outIndex = streaming.lastIndexOf("-y");
  if (inputStart < 0 || inputEnd < inputStart || vfIndex < 0 || outIndex < vfIndex) {
    throw new Error(
      `hdrPassthrough: unsupported encoder layout for codec ${encoder.preset.codec ?? "default"}`,
    );
  }
  const tail = streaming[vfIndex + 1] ?? "";
  const encoderArgs = [
    ...streaming.slice(inputEnd + 2, vfIndex),
    "-filter_complex",
    buildCompositeFilterGraph(request, tail),
    "-map",
    "[vout]",
    ...streaming.slice(vfIndex + 2, outIndex),
    "-frames:v",
    String(plan.totalFrames),
    "-an",
    ...streaming.slice(outIndex),
  ];

  // Not clamped at 0: when every stream starts after 0 (an mp4 without an edit
  // list, a remuxed transport stream) and `mediaStart` sits inside that offset,
  // the seek is negative. ffmpeg then reads from the start and keeps the
  // stream's own lead, which `fps=...:start_time=0` fills by holding the first
  // frame, exactly as the layered extraction keeps the negative seek and holds
  // its first frame until the stream starts. Clamping would play the video
  // early by the offset.
  const seek = ffmpegSeekSeconds(video.metadata, video.mediaStart);
  const readSeconds = video.duration + 1 / fpsToNumber(plan.fps);
  return [
    ...streaming.slice(0, inputStart),
    "-ss",
    seek.toFixed(6),
    "-t",
    readSeconds.toFixed(6),
    "-i",
    video.srcPath,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    ...encoderArgs,
  ];
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Writes the concat list into `request.workDir`, runs ffmpeg with
 * `buildCompositeArgs` under `request.abortSignal`, forwards ffmpeg's
 * encoded-frame count to `onFramesEncoded`, and resolves with timing + size.
 * Throws (caller falls back) on non-zero exit, on
 * `framesEncoded !== plan.totalFrames`, or when `outputPath` is missing or
 * empty. An abort rethrows the signal's reason.
 */
export async function compositeAndEncode(request: CompositeRequest): Promise<CompositeResult> {
  const { plan, overlays, abortSignal, outputPath } = request;
  abortSignal?.throwIfAborted();

  mkdirSync(request.workDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  const concatListPath = join(request.workDir, CONCAT_LIST_NAME);
  writeFileSync(concatListPath, buildOverlayConcatList(overlays.overlays, plan.fps));

  const gpuEncoder = request.encoder.useGpu ? await getCachedGpuEncoder() : null;
  const nvencPresets = gpuEncoder === "nvenc" ? await getCachedNvencPresets() : undefined;
  const args = buildCompositeArgs(request, concatListPath, {
    encoder: gpuEncoder,
    nvencPresets,
  });

  let framesEncoded = 0;
  const readStats = ffmpegStatsReader(({ frames }) => {
    if (frames === undefined || frames <= framesEncoded) return;
    framesEncoded = frames;
    request.onFramesEncoded?.(frames);
  });
  const result = await runFfmpeg(args, { signal: abortSignal, onStderr: readStats });
  if (abortSignal?.aborted) throw abortError(abortSignal);
  if (!result.success) {
    throw new Error(
      `hdrPassthrough: ffmpeg composite failed: ${formatFfmpegError(result.exitCode, result.stderr)}`,
    );
  }
  if (framesEncoded !== plan.totalFrames) {
    throw new Error(
      `hdrPassthrough: ffmpeg encoded ${framesEncoded} frames, expected ${plan.totalFrames}`,
    );
  }
  let fileSize = 0;
  try {
    fileSize = statSync(outputPath).size;
  } catch {
    fileSize = 0;
  }
  if (fileSize <= 0) {
    throw new Error(`hdrPassthrough: ffmpeg composite wrote no output at ${outputPath}`);
  }
  return { encodeMs: result.durationMs, framesEncoded, fileSize };
}
