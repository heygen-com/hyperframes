/**
 * HDR passthrough composite: one ffmpeg run overlays the cached state PNGs
 * onto the source HDR video and writes the composited frames as raw
 * `rgb48le`, and the layered path's own encoder (`spawnStreamingEncoder`,
 * with the options the layered stage gives it) encodes them, one frame at a
 * time, each once the encoder has gone idle (`encoderPacing.ts`).
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fpsToFfmpegArg, fpsToNumber } from "@hyperframes/core";
import {
  ManagedChildProcess,
  ffmpegSeekSeconds,
  formatFfmpegError,
  getFfmpegBinary,
  spawnStreamingEncoder,
  trackChildProcess,
  type StreamingEncoder,
  type StreamingEncoderOptions,
} from "@hyperframes/engine";
import {
  ENCODER_IDLE,
  type IdleWaitOptions,
  procThreadStates,
  waitUntilIdle,
} from "./encoderPacing.js";
import type { CapturedOverlay, CompositeRequest, CompositeResult } from "./types.js";

/** File name of the concat list written into `CompositeRequest.workDir`. */
const CONCAT_LIST_NAME = "hdr-passthrough-overlays.ffconcat";

const MICROS_PER_SECOND = 1_000_000;

/** Bytes per pixel of the raw frames the layered encoder reads. */
const RGB48_BYTES_PER_PIXEL = 6;

/** The layered stage's inactivity limit for its HDR encoder (`runCaptureHdrStage`). */
const LAYERED_ENCODER_TIMEOUT_MS = 3_600_000;

/**
 * Slice threads for the swscale format conversions in the composite graph.
 * Each 1080p 16-bit conversion is otherwise single-threaded and caps the
 * graph below the encoder's speed. Slice threading does not change the
 * output pixels.
 */
const SWS_THREADS = 4;
const THREADED_SCALE = `scale=threads=${SWS_THREADS}`;
const convert = (pixFmt: string): string => `${THREADED_SCALE},format=${pixFmt}`;

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
 * partial-alpha samples. The result is repacked to `rgb48le`, the frames the
 * layered blend hands its encoder. ffmpeg's `overlay` filter blends RGB at 8
 * bits only, so it cannot be used here. Raw output carries no side data: the
 * source's mastering display, content light level and Dolby Vision metadata
 * stop here, as they do in the layered path's raw frames.
 */
function buildCompositeFilterGraph(request: CompositeRequest): string {
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
  return `${buildBlendFilters(videoChain.join(","), fpsFilter)}[vout]`;
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
 * The ffmpeg argv (without the binary) of the composite: the source video
 * and the overlays in, `rgb48le` frames of the plan's size out on stdout.
 * Pure; exported for argument-level unit tests.
 *
 *   - Input 0: the source video, seeked to `video.mediaStart` with the HDR
 *     extraction's seek normalization (`ffmpegSeekSeconds`, negative when the
 *     streams start after 0, as in the layered extraction), read for
 *     `video.duration` plus one output frame of slack.
 *   - Input 1: the overlay PNGs through the concat demuxer
 *     (`buildOverlayConcatList`).
 *   - Filter: `buildCompositeFilterGraph`; `-frames:v plan.totalFrames`.
 */
export function buildCompositeDecodeArgs(
  request: CompositeRequest,
  concatListPath: string,
): string[] {
  const { video, plan } = request;
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
    ...["-hide_banner", "-nostdin", "-v", "error"],
    ...["-ss", seek.toFixed(6), "-t", readSeconds.toFixed(6), "-i", video.srcPath],
    ...["-f", "concat", "-safe", "0", "-i", concatListPath],
    ...["-filter_complex", buildCompositeFilterGraph(request), "-map", "[vout]"],
    ...["-frames:v", String(plan.totalFrames), "-an"],
    ...["-f", "rawvideo", "-pix_fmt", "rgb48le", "pipe:1"],
  ];
}

/**
 * The options the layered stage gives `spawnStreamingEncoder` for the same
 * render (`runCaptureHdrStage`): codec, preset, CRF or bitrate, delivery
 * caps and GOP lock, GPU selection, pixel format, HDR transfer and raw
 * `rgb48le` input. The encoder builds its own argv from them, so the
 * passthrough's encode runs the layered path's exact command line.
 */
export function compositeEncoderOptions(request: CompositeRequest): StreamingEncoderOptions {
  const { plan, encoder, hdr } = request;
  return {
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
}

/** The processes `compositeAndEncode` runs; injectable for tests. */
export interface CompositeDeps {
  spawnEncoder: (
    outputPath: string,
    options: StreamingEncoderOptions,
    signal: AbortSignal,
  ) => Promise<StreamingEncoder>;
  /** Spawns the composite, frames on stdout; `wait` settles when it exits. */
  spawnComposite: (
    args: string[],
    signal: AbortSignal,
  ) => { frames: AsyncIterable<Buffer>; wait: () => Promise<{ ok: boolean; error: string }> };
  /** Resolves once the encoder (`pid`) has gone idle (`encoderPacing.ts`). */
  waitForEncoder: (pid: number | undefined, options: IdleWaitOptions) => Promise<void>;
}

function spawnComposite(args: string[], signal: AbortSignal) {
  const child = spawn(getFfmpegBinary(), args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  trackChildProcess(child);
  const managed = new ManagedChildProcess(child, { signal });
  const stdout = child.stdout;
  if (!stdout) throw new Error("hdrPassthrough: the composite has no stdout");
  return {
    frames: stdout as AsyncIterable<Buffer>,
    wait: async () => {
      const outcome = await managed.wait();
      const ok = outcome.reason === "exit" && outcome.exitCode === 0;
      return { ok, error: ok ? "" : formatFfmpegError(outcome.exitCode, outcome.stderr) };
    },
  };
}

const DEFAULT_COMPOSITE_DEPS: CompositeDeps = {
  spawnEncoder: (outputPath, options, signal) =>
    spawnStreamingEncoder(outputPath, options, signal, {
      ffmpegStreamingTimeout: LAYERED_ENCODER_TIMEOUT_MS,
    }),
  spawnComposite,
  waitForEncoder: (pid, options) =>
    pid === undefined
      ? Promise.reject(new Error("hdrPassthrough: the encoder has no process id"))
      : waitUntilIdle(() => procThreadStates(pid), options),
};

/**
 * Whole frames of `frameBytes` from a byte stream, each a fresh buffer;
 * throws on a trailing partial frame.
 */
async function* wholeFrames(chunks: AsyncIterable<Buffer>, frameBytes: number) {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  for await (const chunk of chunks) {
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes < frameBytes) continue;
    const joined = Buffer.concat(pending, pendingBytes);
    let start = 0;
    for (; start + frameBytes <= joined.length; start += frameBytes) {
      yield joined.subarray(start, start + frameBytes);
    }
    pending = start < joined.length ? [joined.subarray(start)] : [];
    pendingBytes = joined.length - start;
  }
  if (pendingBytes > 0) throw new Error("hdrPassthrough: the composite ended inside a frame");
}

/**
 * Writes the concat list into `request.workDir`, runs the composite
 * (`buildCompositeDecodeArgs`) and the layered encoder
 * (`compositeEncoderOptions`) under `request.abortSignal`, handing each
 * composited frame to the encoder once it has gone idle after the previous
 * one, and resolves with timing + size. `onFramesEncoded` hears each frame
 * the encoder has taken. Throws (caller falls back) when either process
 * fails, when the composite yields other than `plan.totalFrames` frames, or
 * when the encoder reports another count or an empty file; both processes
 * are stopped first. An abort rethrows the signal's reason.
 */
// fallow-ignore-next-line complexity
export async function compositeAndEncode(
  request: CompositeRequest,
  deps: CompositeDeps = DEFAULT_COMPOSITE_DEPS,
): Promise<CompositeResult> {
  const { plan, overlays, abortSignal, outputPath } = request;
  abortSignal?.throwIfAborted();

  mkdirSync(request.workDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  const concatListPath = join(request.workDir, CONCAT_LIST_NAME);
  writeFileSync(concatListPath, buildOverlayConcatList(overlays.overlays, plan.fps));

  const stop = new AbortController();
  const signal = abortSignal ? AbortSignal.any([abortSignal, stop.signal]) : stop.signal;
  const started = Date.now();
  const encoder = await deps.spawnEncoder(outputPath, compositeEncoderOptions(request), signal);
  const composite = deps.spawnComposite(buildCompositeDecodeArgs(request, concatListPath), signal);
  const frameBytes = plan.width * plan.height * RGB48_BYTES_PER_PIXEL;
  let framesWritten = 0;
  let idleWaitMs = 0;
  try {
    for await (const frame of wholeFrames(composite.frames, frameBytes)) {
      if (framesWritten >= plan.totalFrames) {
        throw new Error("hdrPassthrough: the composite wrote more frames than the plan");
      }
      if (!(await encoder.writeFrame(frame))) {
        throw new Error(
          `hdrPassthrough: the encoder stopped: ${encoder.getExitError() ?? "exited early"}`,
        );
      }
      framesWritten++;
      const waitStart = Date.now();
      await deps.waitForEncoder(encoder.pid, { ...ENCODER_IDLE, signal });
      idleWaitMs += Date.now() - waitStart;
      request.onFramesEncoded?.(framesWritten);
    }
    const decoded = await composite.wait();
    if (!decoded.ok) throw new Error(`hdrPassthrough: ffmpeg composite failed: ${decoded.error}`);
    if (framesWritten !== plan.totalFrames) {
      throw new Error(
        `hdrPassthrough: the composite wrote ${framesWritten} frames, expected ${plan.totalFrames}`,
      );
    }
  } catch (error) {
    stop.abort(error);
    await encoder.close().catch(() => undefined);
    await composite.wait().catch(() => undefined);
    if (abortSignal?.aborted) throw abortSignal.reason;
    throw error;
  }

  let framesEncoded = 0;
  const result = await encoder.close((frames) => {
    framesEncoded = Math.max(framesEncoded, frames);
  });
  if (abortSignal?.aborted) throw abortSignal.reason;
  if (!result.success) {
    throw new Error(`hdrPassthrough: encode failed: ${result.error ?? "unknown error"}`);
  }
  if (framesEncoded !== plan.totalFrames) {
    throw new Error(
      `hdrPassthrough: ffmpeg encoded ${framesEncoded} frames, expected ${plan.totalFrames}`,
    );
  }
  if (result.fileSize <= 0) {
    throw new Error(`hdrPassthrough: the encode wrote no output at ${outputPath}`);
  }
  return {
    encodeMs: Date.now() - started,
    idleWaitMs,
    framesEncoded,
    fileSize: result.fileSize,
  };
}
