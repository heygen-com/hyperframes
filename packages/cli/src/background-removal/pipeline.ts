// fallow-ignore-file complexity
/**
 * Background-removal rendering pipeline.
 *
 * Decode source frames via ffmpeg → run inference per frame → encode the RGBA
 * stream via a second ffmpeg process. Output formats:
 *   .webm → VP9 with alpha (HTML5-native, ~1 MB / 4s @ 1080p)
 *   .mov  → ProRes 4444 with alpha (editing round-trip)
 *   .png  → single RGBA still (only when input is also a single image)
 *
 * The encode flags for VP9-with-alpha mirror the `chunkEncoder.ts` pattern in
 * @hyperframes/engine — `-pix_fmt yuva420p` plus the
 * `-metadata:s:v:0 alpha_mode=1` tag are what make Chrome's `<video>` element
 * decode the alpha plane.
 */
import { spawn } from "node:child_process";
import { extname } from "node:path";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { createSession, type Session } from "./inference.js";
import { type Device, type ModelId } from "./manager.js";

export type OutputFormat = "webm" | "mov" | "png";

const QUALITY_CRF = {
  fast: 30,
  balanced: 18,
  best: 12,
} as const;

export type Quality = keyof typeof QUALITY_CRF;

export const QUALITIES = Object.keys(QUALITY_CRF) as readonly Quality[];

export const DEFAULT_QUALITY: Quality = "balanced";

export const isQuality = (v: unknown): v is Quality =>
  typeof v === "string" && (QUALITIES as readonly string[]).includes(v);

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  /**
   * Optional second output: an inverse-alpha background plate (same source
   * RGB, transparent where the subject was). Only valid for video inputs and
   * .webm/.mov outputs — not allowed alongside a .png output. The plate's
   * format is inferred from this path independently of the foreground's.
   *
   * NOTE: this is a hole-cut plate, not an inpainted clean plate. Composite
   * something opaque (graphics, blur, scene) under it to fill the hole.
   */
  backgroundOutputPath?: string;
  device?: Device;
  model?: ModelId;
  /** Encoder CRF preset for `.webm`. See `QUALITY_CRF`. Ignored for `.mov`/`.png`. */
  quality?: Quality;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: "info"; message: string }
  | { kind: "metadata"; width: number; height: number; fps: number; frameCount: number }
  | { kind: "frame"; index: number; total: number; avgMsPerFrame: number };

export interface RenderResult {
  outputPath: string;
  /** Present only when `backgroundOutputPath` was set. */
  backgroundOutputPath?: string;
  framesProcessed: number;
  durationSeconds: number;
  avgMsPerFrame: number;
  provider: string;
  format: OutputFormat;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface MediaInfo {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
}

export function inferOutputFormat(outputPath: string): OutputFormat {
  const ext = extname(outputPath).toLowerCase();
  if (ext === ".webm") return "webm";
  if (ext === ".mov") return "mov";
  if (ext === ".png") return "png";
  throw new Error(
    `Unsupported output extension: ${ext}. Use .webm (VP9 alpha), .mov (ProRes 4444), or .png.`,
  );
}

export function inferInputKind(inputPath: string): "video" | "image" {
  const ext = extname(inputPath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  throw new Error(
    `Unsupported input: ${ext}. Use a video (mp4/mov/webm/mkv/avi) or image (jpg/png/webp).`,
  );
}

interface EngineMetadata {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}

async function probeMedia(inputPath: string): Promise<MediaInfo> {
  const isImage = inferInputKind(inputPath) === "image";
  const engine = (await import("@hyperframes/engine")) as {
    extractMediaMetadata: (path: string) => Promise<EngineMetadata>;
  };
  const meta = await engine.extractMediaMetadata(inputPath);

  if (isImage) {
    return { width: meta.width, height: meta.height, fps: 0, frameCount: 1 };
  }

  const fps = meta.fps || 30;
  const frameCount = meta.durationSeconds ? Math.round(meta.durationSeconds * fps) : 0;
  return { width: meta.width, height: meta.height, fps, frameCount };
}

export function buildEncoderArgs(
  format: OutputFormat,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
  quality: Quality = DEFAULT_QUALITY,
): string[] {
  const base = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps || 30),
    "-i",
    "-",
  ];

  if (format === "webm") {
    return [
      ...base,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      String(QUALITY_CRF[quality]),
      "-deadline",
      "good",
      "-row-mt",
      "1",
      "-auto-alt-ref",
      "0",
      "-pix_fmt",
      "yuva420p",
      // Tag the output as BT.709 limited range so browsers use the same
      // YUV→RGB matrix the source video was encoded with. Without these tags
      // ffmpeg's default RGB→YUV conversion is BT.601, which causes a visible
      // color shift (red/skin tones in particular) when the matted overlay is
      // composited over the original mp4.
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv",
      "-metadata:s:v:0",
      "alpha_mode=1",
      "-an",
      outputPath,
    ];
  }
  if (format === "mov") {
    return [
      ...base,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4444",
      "-vendor",
      "apl0",
      "-pix_fmt",
      "yuva444p10le",
      "-an",
      outputPath,
    ];
  }
  return [...base, "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", outputPath];
}

async function* readFrames(
  stream: NodeJS.ReadableStream,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  let buffered: Buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffered =
      buffered.length === 0 ? (chunk as Buffer) : Buffer.concat([buffered, chunk as Buffer]);
    while (buffered.length >= frameBytes) {
      // Copy because the next concat would clobber the underlying memory.
      yield Buffer.from(buffered.subarray(0, frameBytes));
      buffered = buffered.subarray(frameBytes);
    }
  }
}

export interface RenderTargets {
  format: OutputFormat;
  inputKind: "video" | "image";
  bgFormat: OutputFormat | undefined;
}

/**
 * Resolve and validate the input/output combination before any I/O. Pure;
 * exported so unit tests can pin the error messages without spawning ffmpeg.
 */
export function resolveRenderTargets(
  inputPath: string,
  outputPath: string,
  backgroundOutputPath?: string,
): RenderTargets {
  const format = inferOutputFormat(outputPath);
  const inputKind = inferInputKind(inputPath);

  if (inputKind === "image" && format !== "png") {
    throw new Error(
      `Image input requires a .png output (got ${extname(outputPath)}). Use a video input for .webm/.mov.`,
    );
  }
  if (inputKind === "video" && format === "png") {
    throw new Error(
      `Video input requires a .webm or .mov output (got .png). Use an image input for .png.`,
    );
  }

  let bgFormat: OutputFormat | undefined;
  if (backgroundOutputPath) {
    if (inputKind === "image") {
      throw new Error(
        "--background-output is not supported for image inputs. Use a video input (mp4/mov/webm) to produce both a cutout and a background plate.",
      );
    }
    bgFormat = inferOutputFormat(backgroundOutputPath);
    if (bgFormat === "png") {
      throw new Error(
        "--background-output must be .webm or .mov; .png is only valid for single-image inputs.",
      );
    }
  }

  return { format, inputKind, bgFormat };
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath || !findFFprobe()) {
    throw new Error(`ffmpeg and ffprobe are required. Install: ${getFFmpegInstallHint()}`);
  }

  const { format, bgFormat } = resolveRenderTargets(
    options.inputPath,
    options.outputPath,
    options.backgroundOutputPath,
  );

  const media = await probeMedia(options.inputPath);

  options.onProgress?.({
    kind: "metadata",
    width: media.width,
    height: media.height,
    fps: media.fps,
    frameCount: media.frameCount,
  });

  const session = await createSession({
    model: options.model,
    device: options.device,
    onProgress: (msg) => options.onProgress?.({ kind: "info", message: msg }),
  });

  try {
    const start = Date.now();
    const framesProcessed = await runPipeline(
      options,
      session,
      media,
      format,
      bgFormat,
      ffmpegPath,
    );
    const durationSeconds = (Date.now() - start) / 1000;
    const avgMsPerFrame = framesProcessed ? (durationSeconds * 1000) / framesProcessed : 0;

    return {
      outputPath: options.outputPath,
      backgroundOutputPath: options.backgroundOutputPath,
      framesProcessed,
      durationSeconds,
      avgMsPerFrame,
      provider: session.provider,
      format,
    };
  } finally {
    await session.close();
  }
}

const RECENT_WINDOW = 30;

interface FfmpegProc {
  proc: ReturnType<typeof spawn>;
  exit: Promise<void>;
  /** Tail of stderr, captured for inclusion in error messages. */
  getStderr: () => string;
}

type StdioFd = "ignore" | "pipe";
type StdioTuple = [StdioFd, StdioFd, StdioFd];

function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  label: string,
  stdio: StdioTuple,
): FfmpegProc {
  const proc = spawn(ffmpegPath, args, { stdio });
  let stderrBuf = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderrBuf += d.toString();
  });
  // If the encoder dies mid-render, the next .write() to its stdin emits an
  // 'error' event on the writable. Without a listener, Node treats it as
  // unhandled and crashes the CLI before waitForExit's reject path can
  // surface the real cause (encoder stderr tail). Swallowing here is safe —
  // the process exit is the source of truth.
  proc.stdin?.on("error", () => {});
  const exit = waitForExit(proc, label, () => stderrBuf);
  return { proc, exit, getStderr: () => stderrBuf };
}

async function runPipeline(
  options: RenderOptions,
  session: Session,
  media: MediaInfo,
  format: OutputFormat,
  bgFormat: OutputFormat | undefined,
  ffmpegPath: string,
): Promise<number> {
  const { inputPath, outputPath, backgroundOutputPath } = options;
  const { width, height, fps, frameCount } = media;
  const frameBytes = width * height * 3;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const decoder = spawnFfmpeg(
    ffmpegPath,
    ["-loglevel", "error", "-i", inputPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-an", "-"],
    "ffmpeg decoder",
    ["ignore", "pipe", "pipe"],
  );

  const fg = spawnFfmpeg(
    ffmpegPath,
    buildEncoderArgs(format, width, height, fps || 30, outputPath, quality),
    "ffmpeg encoder",
    ["pipe", "ignore", "pipe"],
  );

  const bg =
    backgroundOutputPath && bgFormat
      ? spawnFfmpeg(
          ffmpegPath,
          buildEncoderArgs(bgFormat, width, height, fps || 30, backgroundOutputPath, quality),
          "ffmpeg background encoder",
          ["pipe", "ignore", "pipe"],
        )
      : null;

  let processed = 0;
  const total = frameCount;

  const recentMs = new Array<number>(RECENT_WINDOW).fill(0);
  let recentSum = 0;
  let recentSlot = 0;
  let recentCount = 0;

  try {
    for await (const rgb of readFrames(decoder.proc.stdout!, frameBytes)) {
      const t0 = Date.now();
      const result = await session.process(rgb, width, height, bg !== null);
      const elapsed = Date.now() - t0;

      recentSum += elapsed - recentMs[recentSlot]!;
      recentMs[recentSlot] = elapsed;
      recentSlot = (recentSlot + 1) % RECENT_WINDOW;
      if (recentCount < RECENT_WINDOW) recentCount++;

      // Issue both writes before any await so a slow encoder doesn't block
      // the other. Drain anything that returned false before the next
      // session.process() — its output buffers are reused per frame.
      //
      // Subtlety: write() returning true means "highWaterMark not exceeded,"
      // NOT "libuv has flushed the chunk." The buffer reference is held by
      // libuv until the underlying syscall completes. Reusing the session's
      // output buffer is safe because the next session.process() call takes
      // ~10–50ms (ORT inference) — plenty of event-loop turns for libuv to
      // drain. If that ever stops being true, we'd need to copy here.
      const fgWroteFully = fg.proc.stdin!.write(result.fg);
      const bgWroteFully = bg && result.bg ? bg.proc.stdin!.write(result.bg) : true;
      if (!fgWroteFully || !bgWroteFully) {
        const drains: Promise<void>[] = [];
        if (!fgWroteFully) {
          drains.push(
            new Promise<void>((resolve) => fg.proc.stdin!.once("drain", () => resolve())),
          );
        }
        if (!bgWroteFully && bg) {
          drains.push(
            new Promise<void>((resolve) => bg.proc.stdin!.once("drain", () => resolve())),
          );
        }
        await Promise.all(drains);
      }

      processed++;
      options.onProgress?.({
        kind: "frame",
        index: processed,
        total,
        avgMsPerFrame: recentSum / recentCount,
      });
    }
  } catch (err) {
    decoder.proc.kill("SIGKILL");
    fg.proc.kill("SIGKILL");
    bg?.proc.kill("SIGKILL");
    throw err;
  }

  fg.proc.stdin!.end();
  bg?.proc.stdin!.end();
  const exits: Promise<void>[] = [decoder.exit, fg.exit];
  if (bg) exits.push(bg.exit);
  await Promise.all(exits);

  if (processed === 0) {
    throw new Error(
      `No frames produced from ${inputPath}. Decoder stderr:\n${decoder.getStderr().slice(-400)}`,
    );
  }

  return processed;
}

export function waitForExit(
  proc: ReturnType<typeof spawn>,
  label: string,
  getStderr: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    // Per Node docs the exit callback is (code, signal): on a normal exit
    // `code` is the numeric exit status and `signal` is null; on a
    // signal-killed exit `code` is null and `signal` is the signal name.
    // Treating null-code as success would silently report SIGTERM/SIGKILL
    // as a successful render.
    proc.on("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
        return;
      }
      const cause = signal ? `killed by ${signal}` : `exited with code ${code}`;
      reject(new Error(`${label} ${cause}: ${getStderr().slice(-400)}`));
    });
  });
}
