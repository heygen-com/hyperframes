/**
 * HDR passthrough composite: one ffmpeg run overlays the cached state PNGs
 * onto the source HDR video and writes the composited frames as raw
 * `rgb48le`, and the layered path's own encoder (`spawnStreamingEncoder`,
 * with the options the layered stage gives it) encodes them, one frame at a
 * time, each once the encoder has gone idle (`encoderPacing.ts`).
 *
 * The overlays reach the composite one PNG per frame on its stdin, as
 * overlay capture settles each frame (`CompositeRequest.overlayFrames`), so
 * the composite and the encode run while capture is still walking the
 * frames.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Writable } from "node:stream";
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
import { ENCODER_IDLE, type EncoderPacer, watchEncoder } from "./encoderPacing.js";
import type { CompositeRequest, CompositeResult } from "./types.js";

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
 *   - Input 1: one overlay PNG per output frame on stdin (`image2pipe`, PNG,
 *     at the output rate, so frame `i` has pts `i`), probed from its first
 *     PNG so the composite keeps up with capture.
 *   - Filter: `buildCompositeFilterGraph`; `-frames:v plan.totalFrames`.
 */
export function buildCompositeDecodeArgs(request: CompositeRequest): string[] {
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
    // Decode each PNG as it arrives: the default probe waits for megabytes of overlays first,
    // and a frame-threaded PNG decoder holds a frame per thread.
    ...["-probesize", "32", "-analyzeduration", "0", "-threads", "1"],
    ...["-f", "image2pipe", "-c:v", "png", "-framerate", fpsToFfmpegArg(plan.fps), "-i", "pipe:0"],
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
  /**
   * Spawns the composite, overlay PNGs to `overlays`, frames on stdout;
   * `wait` settles when it exits and its pipes close, `drop` closes our ends
   * of both pipes (so a process the binary left behind, a wrapper's child,
   * stops too).
   */
  spawnComposite: (
    args: string[],
    signal: AbortSignal,
  ) => {
    overlays: Writable;
    frames: AsyncIterable<Buffer>;
    wait: () => Promise<{ ok: boolean; error: string }>;
    drop: () => void;
  };
  /**
   * Proves `pid` is the process running libx265 for this encode and returns
   * its pacer; rejects with `EncoderPacingError` when it cannot
   * (`encoderPacing.watchEncoder`).
   */
  watchEncoder: (pid: number | undefined) => Promise<EncoderPacer>;
}

function spawnComposite(args: string[], signal: AbortSignal) {
  const child = spawn(getFfmpegBinary(), args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  trackChildProcess(child);
  const managed = new ManagedChildProcess(child, { signal });
  const { stdin, stdout } = child;
  if (!stdin || !stdout) throw new Error("hdrPassthrough: the composite has no stdin or stdout");
  // A composite that exits early closes its stdin; the feed sees that as a failed write.
  stdin.on("error", () => undefined);
  return {
    overlays: stdin,
    frames: stdout as AsyncIterable<Buffer>,
    drop: () => {
      stdin.destroy();
      stdout.destroy();
    },
    wait: async () => {
      const outcome = await managed.wait();
      const ok = outcome.reason === "exit" && outcome.exitCode === 0;
      if (ok) return { ok, error: "" };
      const killed = outcome.signal ? ` (killed by ${outcome.signal})` : "";
      return { ok, error: `${formatFfmpegError(outcome.exitCode, outcome.stderr)}${killed}` };
    },
  };
}

export const DEFAULT_COMPOSITE_DEPS: CompositeDeps = {
  spawnEncoder: (outputPath, options, signal) =>
    spawnStreamingEncoder(outputPath, options, signal, {
      ffmpegStreamingTimeout: LAYERED_ENCODER_TIMEOUT_MS,
    }),
  spawnComposite,
  watchEncoder: (pid) => watchEncoder(pid),
};

/** Bytes of composited frames held ahead of the encoder, at least `MIN_READ_AHEAD` frames. */
const READ_AHEAD_BYTES = 64 << 20;
const MIN_READ_AHEAD = 2;
const MAX_READ_AHEAD = 4;

/** Frames the composite may run ahead of the encoder for `frameBytes`-sized frames. */
export function readAheadDepth(frameBytes: number): number {
  const fits = Math.floor(READ_AHEAD_BYTES / Math.max(1, frameBytes));
  return Math.min(MAX_READ_AHEAD, Math.max(MIN_READ_AHEAD, fits));
}

/**
 * `source`'s items in order, with up to `depth` requested ahead of the
 * consumer, so the composite keeps producing frames while the encoder
 * works on one instead of waiting on the pipe. A failure surfaces when its
 * item is reached.
 */
export async function* readAhead<T>(source: AsyncIterable<T>, depth: number): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const pending: Array<Promise<IteratorResult<T>>> = [];
  const request = () => {
    const next = iterator.next();
    // Handled where it is awaited; this only keeps an early failure from going unhandled.
    next.catch(() => undefined);
    pending.push(next);
  };
  for (let i = 0; i < depth; i++) request();
  for (;;) {
    const next = pending.shift();
    if (!next) return;
    const { done, value } = await next;
    if (done) return;
    request();
    yield value;
  }
}

/** Overlay PNG paths handed from capture to the composite as frames settle. */
export interface OverlayFrameQueue extends AsyncIterable<string> {
  /** The next frame's PNG. */
  push(pngPath: string): void;
  /** No more frames. */
  end(): void;
  /** No more frames: capture failed with `error`, which the reader throws. */
  fail(error: unknown): void;
}

/** A single-reader `OverlayFrameQueue`. */
export function createOverlayFrameQueue(): OverlayFrameQueue {
  const items: string[] = [];
  let closed: { error?: unknown; failed: boolean } | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(pngPath) {
      if (closed) throw new Error("hdrPassthrough: overlay frame after the last");
      items.push(pngPath);
      notify();
    },
    end() {
      closed ??= { failed: false };
      notify();
    },
    fail(error) {
      closed ??= { error, failed: true };
      notify();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed?.failed) throw closed.error;
        if (closed) return;
        await new Promise<void>((done) => {
          wake = done;
        });
      }
    },
  };
}

/** Writes `bytes` to `sink`, waiting out back-pressure; rejects once the sink fails or closes. */
async function writeAll(sink: Writable, bytes: Buffer): Promise<void> {
  const stopped = () => new Error("hdrPassthrough: the composite stopped reading overlays");
  if (sink.destroyed || sink.writableEnded) throw stopped();
  if (sink.write(bytes)) return;
  await new Promise<void>((done, fail) => {
    const settle = (error?: unknown) => {
      sink.off("drain", onDrain);
      sink.off("close", onClose);
      sink.off("error", settle);
      if (error === undefined) done();
      else fail(error);
    };
    const onDrain = () => settle();
    const onClose = () => settle(stopped());
    sink.on("drain", onDrain);
    sink.on("close", onClose);
    sink.on("error", settle);
  });
}

/**
 * Writes each frame's overlay PNG to the composite, in order, rereading a
 * file only when the PNG changes, then ends its input. Throws when the
 * frames fail (capture declined) or are not `totalFrames`.
 */
export async function feedOverlays(
  frames: AsyncIterable<string>,
  sink: Writable,
  totalFrames: number,
): Promise<void> {
  let last: { path: string; bytes: Buffer } | undefined;
  let fed = 0;
  try {
    for await (const path of frames) {
      if (fed >= totalFrames) throw new Error("hdrPassthrough: more overlay frames than the plan");
      if (last?.path !== path) last = { path, bytes: await readFile(path) };
      await writeAll(sink, last.bytes);
      fed++;
    }
    if (fed !== totalFrames) {
      throw new Error(`hdrPassthrough: ${fed} overlay frames, expected ${totalFrames}`);
    }
  } catch (error) {
    sink.destroy();
    throw error;
  }
  sink.end();
}

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
 * What the composite's and the encoder's own exits said, when either had
 * exited before the passthrough stopped them, or "": exit code, signal and
 * stderr tail. A failure that surfaces only as a write to a closed pipe
 * (`write EPIPE`) says nothing of why the other end went away.
 */
function processExits(
  composite: { ok: boolean; error: string } | undefined,
  encoder: Pick<StreamingEncoder, "getExitStatus" | "getExitError" | "getExitSignal">,
): string {
  const exits: string[] = [];
  if (composite && !composite.ok) exits.push(`ffmpeg composite failed: ${composite.error}`);
  if (encoder.getExitStatus() !== "running") {
    const signal = encoder.getExitSignal?.();
    const error = encoder.getExitError() ?? "exited";
    exits.push(`encoder: ${error}${signal ? ` (killed by ${signal})` : ""}`);
  }
  return exits.join("; ");
}

/**
 * `error` with `exits` appended to its message, when it is a plain error (a
 * failed write or read); an error of its own kind (a decline) is left as it
 * is, its detail unchanged.
 */
function withExits(error: unknown, exits: string): unknown {
  if (exits && error instanceof Error && error.constructor === Error) {
    error.message = `${error.message}; ${exits}`;
  }
  return error;
}

/** How long a failed encode loop waits to learn whether the composite itself exited. */
const COMPOSITE_EXIT_GRACE_MS = 1_000;

/** The composite's exit if it comes within `ms`, else undefined. */
async function exitedWithin(
  composite: { wait: () => Promise<{ ok: boolean; error: string }> },
  ms: number,
): Promise<{ ok: boolean; error: string } | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ms);
  });
  try {
    return await Promise.race([composite.wait().catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the composite (`buildCompositeDecodeArgs`), fed each frame's overlay
 * as `request.overlayFrames` yields it (`feedOverlays`), and the layered
 * encoder (`compositeEncoderOptions`) under `request.abortSignal`, handing
 * each composited frame to the encoder once it has gone idle after the
 * previous one (the composite runs a few frames ahead, `readAhead`, and the
 * encoder process, proven to be the libx265 encode first, is checked
 * before each frame, `watchEncoder`), and
 * resolves with timing + size. `onFramesEncoded` hears each frame the
 * encoder has taken. Throws (caller falls back) when the overlay frames
 * fail (with their error), when either process fails, when the composite
 * yields other than `plan.totalFrames` frames, or when the encoder reports
 * another count or an empty file, and with `EncoderPacingError` when the
 * encoder cannot be paced; both processes are stopped first. An abort
 * rethrows the signal's reason.
 */
// fallow-ignore-next-line complexity
export async function compositeAndEncode(
  request: CompositeRequest,
  deps: CompositeDeps = DEFAULT_COMPOSITE_DEPS,
): Promise<CompositeResult> {
  const { plan, abortSignal, outputPath } = request;
  abortSignal?.throwIfAborted();

  mkdirSync(dirname(outputPath), { recursive: true });

  const stop = new AbortController();
  const signal = abortSignal ? AbortSignal.any([abortSignal, stop.signal]) : stop.signal;
  const started = Date.now();
  const encoder = await deps.spawnEncoder(outputPath, compositeEncoderOptions(request), signal);
  let pacer: EncoderPacer;
  try {
    // Before anything else starts: an encoder not proven to be the libx265 encode declines here.
    pacer = await deps.watchEncoder(encoder.pid);
  } catch (error) {
    stop.abort(error);
    await encoder.close().catch(() => undefined);
    throw error;
  }
  const composite = deps.spawnComposite(buildCompositeDecodeArgs(request), signal);
  let feedError: unknown;
  const feeding = feedOverlays(request.overlayFrames, composite.overlays, plan.totalFrames).catch(
    (error: unknown) => {
      feedError = error;
      stop.abort(error);
    },
  );
  const frameBytes = plan.width * plan.height * RGB48_BYTES_PER_PIXEL;
  let framesWritten = 0;
  let idleWaitMs = 0;
  let frameWaitMs = 0;
  const ahead = readAheadDepth(frameBytes);
  try {
    let asked = Date.now();
    for await (const frame of readAhead(wholeFrames(composite.frames, frameBytes), ahead)) {
      frameWaitMs += Date.now() - asked;
      if (framesWritten >= plan.totalFrames) {
        throw new Error("hdrPassthrough: the composite wrote more frames than the plan");
      }
      pacer.check();
      if (!(await encoder.writeFrame(frame))) {
        throw new Error(
          `hdrPassthrough: the encoder stopped: ${encoder.getExitError() ?? "exited early"}`,
        );
      }
      framesWritten++;
      const waitStart = Date.now();
      await pacer.waitUntilIdle({ ...ENCODER_IDLE, signal });
      idleWaitMs += Date.now() - waitStart;
      request.onFramesEncoded?.(framesWritten);
      asked = Date.now();
    }
    await feeding;
    if (feedError !== undefined) throw feedError;
    const decoded = await composite.wait();
    if (!decoded.ok) throw new Error(`hdrPassthrough: ffmpeg composite failed: ${decoded.error}`);
    if (framesWritten !== plan.totalFrames) {
      throw new Error(
        `hdrPassthrough: the composite wrote ${framesWritten} frames, expected ${plan.totalFrames}`,
      );
    }
  } catch (error) {
    // A composite or encoder that died (out of memory, a signal) ends the encode early: name why,
    // read before either is stopped from here.
    const died = await exitedWithin(composite, COMPOSITE_EXIT_GRACE_MS);
    const exits = processExits(died, encoder);
    stop.abort(error);
    composite.drop();
    await encoder.close().catch(() => undefined);
    await composite.wait().catch(() => undefined);
    // Not awaited: the feed may still be waiting on capture's next frame, and fails at its next write.
    if (abortSignal?.aborted) throw abortSignal.reason;
    throw withExits(feedError ?? error, exits);
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
    frameWaitMs,
    framesEncoded,
    fileSize: result.fileSize,
  };
}
