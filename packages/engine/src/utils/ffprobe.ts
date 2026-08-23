// fallow-ignore-file code-duplication complexity
import { spawn } from "child_process";
import { createReadStream, readFileSync, statSync } from "fs";
import * as zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import { basename } from "path";
import { redactTelemetryString } from "@hyperframes/core";
import { FFPROBE_PATH_ENV, getFfprobeBinary } from "./ffmpegBinaries.js";
import { ManagedChildProcess } from "./managedChildProcess.js";
import { trackChildProcess } from "./processTracker.js";

const FFPROBE_STDERR_MAX_BYTES = 8 * 1024;
/** Bound on collected stdout. Generous — real -show_streams JSON is well
 *  under this — but finite, unlike the previous unbounded accumulation. */
const FFPROBE_STDOUT_MAX_CHARS = 8_000_000;

const FFPROBE_ERROR_MAX_CHARS = 4 * 1024;

function redactFfprobeInput(stderr: string, filePath: string): string {
  if (!filePath) return stderr;

  let redacted = stderr.split(filePath).join("[input]");
  const inputBasename = basename(filePath);
  if (inputBasename) redacted = redacted.split(inputBasename).join("[input]");

  // ManagedChildProcess retains an 8 KiB byte tail. When that boundary lands
  // inside the input path, stderr starts with only a suffix of the path, so
  // neither exact-path nor generic absolute-path redaction can recognize it.
  if (!redacted.startsWith("[input]")) {
    for (let offset = 1; offset < filePath.length; offset += 1) {
      const suffix = filePath.slice(offset);
      if (suffix.length < 4 || !redacted.startsWith(suffix)) continue;
      const boundary = redacted[suffix.length];
      if (boundary !== undefined && !/[\s:'")\]}]/.test(boundary)) continue;
      redacted = `[input]${redacted.slice(suffix.length)}`;
      break;
    }
  }

  return redacted;
}

function sanitizeFfprobeDiagnostic(stderr: string, filePath: string): string {
  const stderrWithoutInput = redactFfprobeInput(stderr, filePath);
  const redacted = redactTelemetryString(stderrWithoutInput, FFPROBE_STDERR_MAX_BYTES);
  if (redacted.length <= FFPROBE_ERROR_MAX_CHARS) return redacted;
  return `…${redacted.slice(-(FFPROBE_ERROR_MAX_CHARS - 1))}`;
}

/** Spawn ffprobe with given args, return stdout. Throws on non-zero exit or missing binary. */
async function runFfprobe(
  filePath: string,
  argsWithoutInput: string[],
  signal?: AbortSignal,
  stdoutOptions?: { retainTail?: boolean; maxChars?: number },
): Promise<string> {
  // `--` stops option parsing so a path like "-intro.mp4" is a filename, but
  // it does NOT cover a path of exactly "-": ffprobe rewrites that to `fd:`
  // AFTER option parsing and then reads stdin. Since stdin here is a pipe the
  // parent never writes to and never ends, the probe hangs for the full 30s
  // deadline and fails with an empty diagnostic (ffprobe never errored, so
  // stderr is blank). Reject it up front with something a caller can read.
  if (filePath === "-") {
    throw new Error('[FFmpeg] Refusing to probe "-": stdin is not a supported input path.');
  }

  const command = getFfprobeBinary();
  const proc = spawn(command, ["-v", "error", ...argsWithoutInput, "--", filePath], {
    // Nothing is ever written to the child's stdin; leaving it as a pipe is
    // what lets a stdin-reading invocation block indefinitely.
    stdio: ["ignore", "pipe", "pipe"],
    // See runFfmpeg.ts: keeps a console window off the user's desktop on Windows.
    windowsHide: true,
  });
  trackChildProcess(proc);
  // Decoded through StringDecoder rather than per-chunk toString(): a
  // multi-byte character split across a 64 KiB pipe boundary decodes to U+FFFD
  // on both sides. -show_format output above ~64 KiB with non-ASCII tag text
  // (an MKV with many chapters, or title/artist tags) came back silently
  // mangled — JSON.parse still succeeds, so nothing surfaced it, and tag
  // lookups like alpha_mode could miss.
  const decoder = new StringDecoder("utf8");
  let stdout = "";
  let stdoutTruncated = false;
  const stdoutMaxChars = stdoutOptions?.maxChars ?? FFPROBE_STDOUT_MAX_CHARS;
  proc.stdout.on("data", (data: Buffer) => {
    // stderr is capped by ManagedChildProcess; stdout had no bound at all, and
    // analyzeKeyframeIntervals emits one line per frame — an all-intra ProRes
    // proxy can produce an unbounded string.
    if (stdoutTruncated) return;
    stdout += decoder.write(data);
    // Checked AFTER appending: a single chunk can already exceed the bound,
    // so a pre-append check only ever stops the second one.
    if (stdout.length > stdoutMaxChars) {
      if (stdoutOptions?.retainTail) {
        stdout = stdout.slice(-stdoutMaxChars);
      } else {
        stdoutTruncated = true;
        stdout = "";
      }
    }
  });
  const managed = new ManagedChildProcess(proc, {
    signal,
    deadlineAtMs: Date.now() + 30_000,
    stderrMaxBytes: FFPROBE_STDERR_MAX_BYTES,
  });
  const outcome = await managed.wait();
  stdout += decoder.end();
  if (stdoutTruncated) {
    throw new Error(
      `[FFmpeg] ffprobe output exceeded ${stdoutMaxChars} characters; refusing to parse a truncated result.`,
    );
  }
  if (outcome.reason === "spawn_error") {
    if ((outcome.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      const configured = process.env[FFPROBE_PATH_ENV]?.trim();
      throw new Error(
        configured
          ? `[FFmpeg] ffprobe not found at ${FFPROBE_PATH_ENV}="${configured}". Please install FFmpeg.`
          : "[FFmpeg] ffprobe not found. Please install FFmpeg.",
      );
    }
    throw outcome.error ?? new Error(outcome.stderr);
  }
  if (outcome.reason !== "exit" || outcome.exitCode !== 0) {
    const diagnostic = sanitizeFfprobeDiagnostic(outcome.stderr, filePath);
    throw new Error(
      `[FFmpeg] ffprobe ${outcome.reason} with code ${outcome.exitCode}: ${diagnostic}`,
    );
  }
  return stdout;
}

function parseProbeJson(stdout: string): FFProbeOutput {
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `[FFmpeg] Failed to parse ffprobe output: ${e instanceof Error ? e.message : e}`,
    );
  }
}

const videoMetadataCache = new Map<string, Promise<VideoMetadata>>();
const finalVideoFrameTimestampCache = new Map<string, Promise<number>>();
const finalVideoFrameTimestampSignalCaches = new WeakMap<
  AbortSignal,
  Map<string, Promise<number>>
>();
const audioMetadataCache = new Map<string, Promise<AudioMetadata>>();
interface MediaProbeCacheEntry {
  identity: string;
  promise: Promise<FFProbeOutput>;
}

const mediaProbeOutputCache = new Map<string, MediaProbeCacheEntry>();
const mediaProbeOutputSignalCaches = new WeakMap<AbortSignal, Map<string, MediaProbeCacheEntry>>();
const MEDIA_PROBE_OUTPUT_CACHE_MAX_ENTRIES = 128;
// FFmpeg's built-in AAC encoder emits AAC-LC, which has 1024 samples per packet.
const AAC_LC_SAMPLES_PER_PACKET = 1024;

export interface VideoColorSpace {
  /** Color transfer characteristics, e.g. "bt709", "smpte2084", "arib-std-b67" */
  colorTransfer: string;
  /** Color primaries, e.g. "bt709", "bt2020" */
  colorPrimaries: string;
  /** Color matrix/space, e.g. "bt709", "bt2020nc" */
  colorSpace: string;
}

export interface VideoMetadata {
  durationSeconds: number;
  videoStreamDurationSeconds: number;
  /** Absolute presentation timestamp at which the selected video stream
   * starts. FFmpeg input seeks are relative to this point, while ffprobe frame
   * timestamps are absolute, so callers crossing those APIs must normalize by
   * this value. Absent only in legacy/manually-constructed metadata. */
  videoStreamStartSeconds?: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
  /** True when r_frame_rate and avg_frame_rate differ significantly (>10%), indicating variable frame rate. */
  isVFR: boolean;
  /** True when the stream carries an alpha channel. */
  hasAlpha: boolean;
  /** Color space info from the video stream. Null if ffprobe didn't report it. */
  colorSpace: VideoColorSpace | null;
  /** Decoded frame count from the video stream's `nb_frames`. Omitted when the
   * container does not surface a reliable count (still images, malformed
   * streams, or muxes that require `-count_packets` to populate). Callers
   * that gate on a frame count must treat `undefined` as "no answer". */
  frames?: number;
}

export interface AudioMetadata {
  durationSeconds: number;
  /** Audio stream's own duration (from `stream.duration`), falling back to
   *  container duration when the stream field is absent. Prefer this over
   *  `durationSeconds` for stream-level parity checks. */
  streamDurationSeconds?: number;
  sampleRate: number;
  channels: number;
  audioCodec: string;
  bitrate?: number;
}

interface FFProbeStream {
  codec_type: string;
  codec_name?: string;
  /** e.g. "LC", "HE-AAC", "HE-AACv2" — where the SBR marker lives, since
   *  codec_name is plain "aac" for all of them. */
  profile?: string;
  width?: number;
  height?: number;
  duration?: string;
  start_time?: string;
  nb_frames?: string;
  nb_read_packets?: string;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  tags?: Record<string, string>;
  disposition?: { attached_pic?: number };
}

interface FFProbeFormat {
  duration?: string;
  bit_rate?: string;
  format_name?: string;
}

interface FFProbeOutput {
  streams: FFProbeStream[];
  format: FFProbeFormat;
}

interface StillImageMetadata {
  width: number;
  height: number;
  colorSpace: VideoColorSpace | null;
}

export interface MediaProbeProfile {
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  visualKind: "none" | "still" | "moving";
}

const STILL_IMAGE_DEMUXERS = new Set([
  "apng",
  "bmp_pipe",
  "dds_pipe",
  "dpx_pipe",
  "exr_pipe",
  "gif",
  "ico",
  "image2",
  "image2pipe",
  "jpeg_pipe",
  "jxl_pipe",
  "png_pipe",
  "qdraw_pipe",
  "sgi_pipe",
  "svg_pipe",
  "tiff_pipe",
  "webp_pipe",
]);

async function hasAvifFileBrand(filePath: string): Promise<boolean> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream(filePath, { start: 0, end: 4095 })) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize < 16 || boxSize > bytes.length) return false;
    const avifBrands = new Set(["avif", "avis"]);
    if (avifBrands.has(bytes.toString("ascii", 8, 12))) return true;
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
      if (avifBrands.has(bytes.toString("ascii", offset, offset + 4))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function isStillImageVisual(output: FFProbeOutput, filePath: string): Promise<boolean> {
  const formatNames = (output.format.format_name ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return (
    formatNames.some((name) => STILL_IMAGE_DEMUXERS.has(name)) || (await hasAvifFileBrand(filePath))
  );
}

function isPngImageProbe(output: FFProbeOutput): boolean {
  const formatNames = (output.format.format_name ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase());
  return (
    formatNames.includes("png_pipe") ||
    output.streams.some(
      (stream) => stream.codec_type === "video" && stream.codec_name?.toLowerCase() === "png",
    )
  );
}

function mediaFileIdentity(filePath: string): string | null {
  try {
    const stat = statSync(filePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  } catch {
    return null;
  }
}

async function probeMediaOutput(filePath: string, signal?: AbortSignal): Promise<FFProbeOutput> {
  let cache = mediaProbeOutputCache;
  if (signal) {
    cache = mediaProbeOutputSignalCaches.get(signal) ?? new Map<string, MediaProbeCacheEntry>();
    mediaProbeOutputSignalCaches.set(signal, cache);
  }

  const identity = mediaFileIdentity(filePath);
  const cached = cache.get(filePath);
  if (identity !== null && cached?.identity === identity) {
    // The no-signal fallback is process-scoped, so touch its entries to make
    // the fixed-size map an LRU. Signal-owned maps are released with their
    // render and do not need process-lifetime eviction.
    if (!signal) {
      cache.delete(filePath);
      cache.set(filePath, cached);
    }
    return cached.promise;
  }
  const promise = runFfprobe(
    filePath,
    ["-print_format", "json", "-show_format", "-show_streams"],
    signal,
  ).then(parseProbeJson);
  if (identity !== null) {
    cache.set(filePath, { identity, promise });
    if (!signal && cache.size > MEDIA_PROBE_OUTPUT_CACHE_MAX_ENTRIES) {
      const oldestPath = cache.keys().next().value;
      if (oldestPath !== undefined) cache.delete(oldestPath);
    }
  }
  promise.catch(() => {
    if (cache.get(filePath)?.promise === promise) {
      cache.delete(filePath);
    }
  });
  return promise;
}

class StructurallyIncompletePngError extends Error {}

async function readFileRange(
  filePath: string,
  start: number,
  length: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(filePath, {
    start,
    end: start + length - 1,
    highWaterMark: length,
    signal,
  })) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function hasCompletePngStructure(filePath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    const fileSize = statSync(filePath).size;
    // Range streams are read-only and skip large IDAT payloads without loading
    // the entire image into memory.
    const signature = await readFileRange(filePath, 0, 8, signal);
    signal?.throwIfAborted();
    if (
      signature.length !== 8 ||
      !signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      return false;
    }

    let seenHeader = false;
    let seenImageData = false;
    let offset = 8;
    while (offset + 12 <= fileSize) {
      signal?.throwIfAborted();
      const chunkHeader = await readFileRange(filePath, offset, 8, signal);
      signal?.throwIfAborted();
      if (chunkHeader.length !== 8) return false;
      const chunkLength = chunkHeader.readUInt32BE(0);
      const chunkEnd = offset + 12 + chunkLength;
      if (chunkEnd > fileSize) return false;
      const chunkType = chunkHeader.toString("ascii", 4, 8);
      if (chunkType === "IHDR") seenHeader = chunkLength === 13 && offset === 8;
      if (chunkType === "IDAT") seenImageData = true;
      if (chunkType === "IEND") return seenHeader && seenImageData && chunkLength === 0;
      offset = chunkEnd;
    }
    return false;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return false;
  }
}

/**
 * Probe stream capabilities without assuming the caller's element type.
 * File extensions and HTTP MIME are deliberately ignored: extensionless
 * assets and valid media served through generic CDN content types must work.
 */
export async function probeMediaProfile(
  filePath: string,
  options?: { signal?: AbortSignal },
): Promise<MediaProbeProfile> {
  try {
    const output = await probeMediaOutput(filePath, options?.signal);
    options?.signal?.throwIfAborted();
    const videoStreams = output.streams.filter((stream) => stream.codec_type === "video");
    const hasMovingVideoStream = videoStreams.some(
      (stream) => stream.disposition?.attached_pic !== 1,
    );
    const isStillImage = videoStreams.length > 0 && (await isStillImageVisual(output, filePath));
    options?.signal?.throwIfAborted();
    if (
      isStillImage &&
      isPngImageProbe(output) &&
      !(await hasCompletePngStructure(filePath, options?.signal))
    ) {
      throw new StructurallyIncompletePngError("[FFmpeg] PNG input is structurally incomplete");
    }
    return {
      hasVideoStream: videoStreams.length > 0,
      hasAudioStream: output.streams.some((stream) => stream.codec_type === "audio"),
      visualKind: isStillImage ? "still" : hasMovingVideoStream ? "moving" : "none",
    };
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason ?? error;
    if (error instanceof StructurallyIncompletePngError) throw error;
    // Preserve the PNG parser fallback used by extractMediaMetadata when the
    // packaged ffprobe binary is unavailable. Signature parsing (not the file
    // extension) keeps extensionless PNGs eligible for preflight.
    const stillImage = extractStillImageMetadata(filePath);
    if (stillImage && (await hasCompletePngStructure(filePath, options?.signal))) {
      return { hasVideoStream: true, hasAudioStream: false, visualKind: "still" };
    }
    throw error;
  }
}

// node:zlib's crc32 is native and takes a running seed, so the chunk type and
// the chunk data can be CRC'd in sequence without concatenating them into a
// throwaway buffer: ~210 ms -> ~1.3 ms on a 12 MiB PNG.
//
// It landed in Node 22.2.0, and this repo declares `"node": ">=22"` with a
// major-only runtime gate, so 22.0 and 22.1 are still supported. A NAMED
// import of a missing export throws at module evaluation — i.e. `ffprobe.ts`
// would fail to load at all on those, long before any PNG is parsed — so the
// namespace import plus this capability check is deliberate. Raising the
// floor to 22.2.0 instead would be a user-facing support change, which does
// not belong in a PNG bug fix.
const nativeCrc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : undefined;

/** Bit-at-a-time fallback for Node 22.0/22.1. Correct, just slower. */
function crc32Fallback(data: Buffer, seed: number): number {
  let crc = seed ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkCrc32(chunkType: string, chunkData: Buffer): number {
  const typeBytes = Buffer.from(chunkType, "ascii");
  if (nativeCrc32) return nativeCrc32(chunkData, nativeCrc32(typeBytes));
  return crc32Fallback(chunkData, crc32Fallback(typeBytes, 0));
}

export function extractPngMetadataFromBuffer(buf: Buffer): StillImageMetadata | null {
  if (
    buf.length < 8 ||
    buf[0] !== 137 ||
    buf[1] !== 80 ||
    buf[2] !== 78 ||
    buf[3] !== 71 ||
    buf[4] !== 13 ||
    buf[5] !== 10 ||
    buf[6] !== 26 ||
    buf[7] !== 10
  ) {
    return null;
  }

  let width = 0;
  let height = 0;
  let seenIdat = false;
  let colorSpaceFromCicp: VideoColorSpace | null = null;
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(pos);
    const chunkType = buf.toString("ascii", pos + 4, pos + 8);
    if (pos + 12 + chunkLen > buf.length) return null;
    const chunkData = buf.subarray(pos + 8, pos + 8 + chunkLen);
    const chunkCrc = buf.readUInt32BE(pos + 8 + chunkLen);
    if (chunkCrc32(chunkType, chunkData) !== chunkCrc) return null;

    // First IHDR only. PNG permits exactly one and it must come first, but a
    // malformed file can carry more — without this anchor a trailing
    // [IHDR 1x1] silently replaced the real 4K dimensions, and the producer
    // laid out a one-pixel image. `>= 13` is the spec length; the old `>= 8`
    // accepted a truncated header and read height out of the CRC bytes.
    if (chunkType === "IHDR" && chunkLen >= 13 && width === 0 && height === 0) {
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }

    if (chunkType === "IDAT") {
      seenIdat = true;
    }

    if (chunkType === "cICP" && chunkLen === 4 && !seenIdat) {
      const primariesCode = chunkData[0] ?? 0;
      const transferCode = chunkData[1] ?? 0;
      const matrixCode = chunkData[2] ?? 0;

      colorSpaceFromCicp = {
        colorPrimaries:
          primariesCode === 9
            ? "bt2020"
            : primariesCode === 1
              ? "bt709"
              : `unknown-${primariesCode}`,
        colorTransfer:
          transferCode === 16
            ? "smpte2084"
            : transferCode === 18
              ? "arib-std-b67"
              : transferCode === 1
                ? "bt709"
                : `unknown-${transferCode}`,
        colorSpace:
          matrixCode === 9 ? "bt2020nc" : matrixCode === 0 ? "gbr" : `unknown-${matrixCode}`,
      };
    }

    // Everything this parser extracts has been found, so stop walking.
    //
    // Not just an optimisation: cICP must precede IDAT (enforced above), so
    // continuing only ever visits chunks we ignore — while making whole-file
    // integrity a precondition for returning anything. A truncated or
    // bad-CRC trailing chunk in an otherwise-good HDR PNG used to null the
    // entire result, and the caller then re-throws the swallowed ffprobe
    // error instead of using the fallback it just computed.
    if (width > 0 && height > 0 && colorSpaceFromCicp !== null) break;

    if (chunkType === "IEND") break;
    pos += 12 + chunkLen;
  }

  return width > 0 && height > 0 ? { width, height, colorSpace: colorSpaceFromCicp } : null;
}

/**
 * Does this pix_fmt carry an alpha channel?
 *
 * Exported so the test asserts the shipped predicate rather than a copy of
 * the pattern. Anchored at the start, matching studio-server's
 * mediaMetadata.ts: the previous inline pattern bound its `(^|[^a-z])` anchor
 * to the first alternative only — `|` is looser than concatenation — so the
 * guard was decorative for every other name. It also missed abgr, ya8/ya16
 * and ayuv64, and its `gray[a-z0-9]*a` branch matched only gray8a/gray16a,
 * names FFmpeg renamed to ya8/ya16 in 2013. A `ya8` grayscale-plus-alpha PNG
 * reported hasAlpha:false, resolveFrameFormat picked jpg, and the overlay
 * flattened to an opaque rectangle.
 */
export function pixelFormatHasAlpha(pixelFormat: string): boolean {
  return /^(?:yuva|rgba|argb|bgra|abgr|gbrap|ya|ayuv)/i.test(pixelFormat);
}

function extractStillImageMetadata(filePath: string): StillImageMetadata | null {
  try {
    return extractPngMetadataFromBuffer(readFileSync(filePath));
  } catch {
    return null;
  }
}

/**
 * Read an ffprobe tag case-insensitively. ffmpeg/libavformat versions disagree
 * on tag casing — VP9 alpha is `alpha_mode` in older builds and `ALPHA_MODE`
 * in newer ones; HDR tags vary similarly. Use this for any sidecar tag where
 * you want to be resilient across muxer versions.
 */
export function readTagCI(
  tags: Record<string, string | undefined> | undefined,
  name: string,
): string {
  if (!tags) return "";
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(tags)) {
    if (key.toLowerCase() === target && typeof value === "string") return value;
  }
  return "";
}

/**
 * Parse an ffprobe rational frame rate ("30000/1001") or plain number.
 *
 * Returns 0 for anything not a usable positive rate. Exported so tests
 * exercise the shipped function directly instead of re-importing the module
 * behind a spawn mock.
 *
 * Every guard here is load-bearing, because a bad value is NOT caught
 * downstream: callers use `meta.fps || 30`, which only rescues 0 and NaN.
 * Infinity and negatives are truthy and flow into buildEncoderArgs as
 * `-r Infinity` / `-r -30`, which ffmpeg rejects mid-render, and into
 * frameCount arithmetic that then goes negative or non-finite.
 *
 *  - the QUOTIENT is checked, not just the operands: "1e308/1e-10" and
 *    "2/1e-320" have finite parts and an infinite result;
 *  - the sign is checked: "-30/1", "30/-1" and "-60" all parsed clean;
 *  - more than two parts is rejected: "30/1/2" used to fall through to the
 *    bare parseFloat below and return 30, as did "60fps", because parseFloat
 *    stops at trailing garbage;
 *  - sub-0.005 rates round to 0 at 2dp and would be replaced by the caller's
 *    30fps default, re-encoding a 300-second 1/300-fps timelapse as a
 *    ~1/30-second clip. Kept as 0 is wrong too, so they are floored to the
 *    smallest representable 2dp rate instead.
 */
export function parseFrameRate(frameRateStr: string | undefined): number {
  if (!frameRateStr) return 0;

  const parts = frameRateStr.split("/");
  if (parts.length > 2) return 0;

  // Number(), never parseFloat — on BOTH the rational operands and the plain
  // form. parseFloat stops at trailing garbage, so "60fps" parsed as 60 and,
  // once the plain path was fixed but the operands were not, "60fps/1" and
  // "30garbage/1garbage" still slipped through the rational branch.
  const strict = (part: string | undefined): number =>
    part === undefined || part.trim() === "" ? NaN : Number(part.trim());

  const raw =
    parts.length === 2
      ? (() => {
          const num = strict(parts[0]);
          const den = strict(parts[1]);
          if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return NaN;
          return num / den;
        })()
      : strict(frameRateStr);

  if (!Number.isFinite(raw) || raw <= 0) return 0;

  // Checked AFTER rounding as well as before. `raw * 100` overflows for a
  // finite-but-huge rate ("1e307", "1e307/1"), so `rounded` became Infinity
  // and sailed past the positivity check — reaching exactly the `-r Infinity`
  // failure the finite guard above exists to prevent.
  const rounded = Math.round(raw * 100) / 100;
  if (!Number.isFinite(rounded)) return 0;

  // A real but very slow rate must not collapse to 0 and inherit the
  // caller's 30fps default.
  return rounded > 0 ? rounded : 0.01;
}

/**
 * Probe a media file (video, image, or container) and return normalized metadata.
 *
 * Despite the legacy name `extractVideoMetadata` (still exported as a
 * deprecated alias below), this also handles still images such as PNG so it
 * can be used uniformly for any visual asset the HDR pipeline encounters.
 */
export async function extractMediaMetadata(filePath: string): Promise<VideoMetadata> {
  const cached = videoMetadataCache.get(filePath);
  if (cached) return cached;

  const probePromise = (async (): Promise<VideoMetadata> => {
    // Lazily memoized. This is a pure fallback, but it used to run eagerly
    // and synchronously BEFORE the first await: readFileSync plus a CRC walk
    // per file, so a caller fanning out over composition.images with
    // Promise.all executed every parse back-to-back before a single ffprobe
    // was spawned (12 4K PNGs: 2649 ms vs 170 ms probe-only) — event-loop
    // stall that also blocks Puppeteer IPC and progress reporting. On the
    // happy path the result was then discarded.
    let stillImageMetaMemo: StillImageMetadata | null | undefined;
    const stillImage = (): StillImageMetadata | null => {
      stillImageMetaMemo ??= extractStillImageMetadata(filePath);
      return stillImageMetaMemo;
    };

    let output: FFProbeOutput | null = null;
    try {
      output = await probeMediaOutput(filePath);
    } catch (error) {
      if (!stillImage()) throw error;
    }

    const videoStream = output?.streams.find((s) => s.codec_type === "video");
    if (!videoStream) {
      const stillImageMeta = stillImage();
      if (stillImageMeta) {
        return {
          durationSeconds: 0,
          videoStreamDurationSeconds: 0,
          videoStreamStartSeconds: 0,
          width: stillImageMeta.width,
          height: stillImageMeta.height,
          fps: 0,
          videoCodec: "png",
          hasAudio: false,
          isVFR: false,
          hasAlpha: false,
          colorSpace: stillImageMeta.colorSpace,
          frames: 1,
        };
      }
      throw new Error("[FFmpeg] No video stream found");
    }

    const rFps = parseFrameRate(videoStream.r_frame_rate);
    const avgFps = parseFrameRate(videoStream.avg_frame_rate);
    const fps = avgFps || rFps;
    // VFR: r_frame_rate (max/nominal) differs from avg_frame_rate (actual average) by >10%
    const isVFR = rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) / Math.max(rFps, avgFps) > 0.1;

    const colorTransfer = videoStream.color_transfer || "";
    const colorPrimaries = videoStream.color_primaries || "";
    const colorSpaceVal = videoStream.color_space || "";
    // Merged per field, not whole-object. ffprobe emits color_space "gbr" for
    // every PNG — even a plain rgb24 with no colour metadata — so a
    // whole-object `??` meant the cICP fallback was discarded whenever
    // ffprobe ran at all, which is exactly the build it exists to cover: one
    // that reports gbr but does not decode cICP. An HDR PQ PNG then resolved
    // colorTransfer "" and graded SDR.
    const cicp = colorTransfer && colorPrimaries && colorSpaceVal ? null : stillImage()?.colorSpace;
    const merged = {
      colorTransfer: colorTransfer || cicp?.colorTransfer || "",
      colorPrimaries: colorPrimaries || cicp?.colorPrimaries || "",
      colorSpace: colorSpaceVal || cicp?.colorSpace || "",
    };
    const colorSpace =
      merged.colorTransfer || merged.colorPrimaries || merged.colorSpace ? merged : null;
    const pixelFormat = videoStream.pix_fmt || "";
    const alphaMode = readTagCI(videoStream.tags, "alpha_mode");
    const hasAlpha = pixelFormatHasAlpha(pixelFormat) || alphaMode === "1";
    // Anchored at the start, matching studio-server's mediaMetadata.ts. The
    // previous pattern bound its `(^|[^a-z])` anchor to the FIRST alternative
    // only — `|` is looser than concatenation — so the guard was decorative
    // for every other name. It also missed abgr, ya8/ya16 and ayuv64, and its
    // `gray[a-z0-9]*a` branch matched only gray8a/gray16a, names FFmpeg
    // renamed to ya8/ya16 in 2013. A `ya8` grayscale-plus-alpha PNG reported
    // hasAlpha:false, resolveFrameFormat picked jpg, and the overlay
    // flattened to an opaque rectangle.

    const containerDuration = output?.format.duration ? parseFloat(output.format.duration) : 0;
    const streamDuration = videoStream.duration ? parseFloat(videoStream.duration) : 0;
    const parsedStreamStart = videoStream.start_time ? parseFloat(videoStream.start_time) : 0;
    const streamStart = Number.isFinite(parsedStreamStart) ? parsedStreamStart : 0;
    // `nb_frames` is populated by the container demuxer; a muxer that requires
    // `-count_packets` to enumerate frames will leave it undefined, in which
    // case the caller must treat the frame-count check as "no answer". This
    // path is hit by, for example, fragmented MP4 where the moov box lacks a
    // frame count — the captured duration is still correct.
    const parsedNbFrames = videoStream.nb_frames ? parseInt(videoStream.nb_frames, 10) : NaN;
    const frames =
      Number.isFinite(parsedNbFrames) && parsedNbFrames > 0 ? parsedNbFrames : undefined;

    return {
      durationSeconds: containerDuration,
      videoStreamDurationSeconds: streamDuration > 0 ? streamDuration : containerDuration,
      videoStreamStartSeconds: streamStart,
      width: videoStream.width || stillImage()?.width || 0,
      height: videoStream.height || stillImage()?.height || 0,
      fps,
      videoCodec: videoStream.codec_name || "unknown",
      hasAudio: output?.streams.some((s) => s.codec_type === "audio") ?? false,
      isVFR,
      hasAlpha,
      colorSpace,
      frames,
    };
  })();

  videoMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (videoMetadataCache.get(filePath) === probePromise) {
      videoMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}

/**
 * Return the FFmpeg input-seek position of the final decoded video frame.
 *
 * A fixed seek window near EOF is not sufficient: sub-1fps and sparse VFR
 * sources can have no frame timestamp inside that window even though the last
 * decoded frame remains displayed through the stream duration. ffprobe seeks
 * to the preceding keyframe and walks forward; retaining only its stdout tail
 * keeps memory bounded even for a pathological long GOP. ffprobe reports
 * absolute presentation timestamps, but FFmpeg input `-ss` is relative to the
 * stream start; the result is normalized into that relative seek domain. Some
 * unindexed transports cannot decode after an interval seek, so an empty tail
 * probe falls back to a bounded-output full scan rather than rejecting valid
 * media. The scan may cost decode time, but retains only 64 KiB of timestamps.
 */
export async function extractFinalVideoFrameTimestamp(
  filePath: string,
  metadata: Pick<VideoMetadata, "videoStreamDurationSeconds" | "videoStreamStartSeconds">,
  signal?: AbortSignal,
): Promise<number> {
  const videoDurationSeconds = metadata.videoStreamDurationSeconds;
  const candidateStreamStart = metadata.videoStreamStartSeconds ?? 0;
  const videoStreamStartSeconds = Number.isFinite(candidateStreamStart) ? candidateStreamStart : 0;
  const cacheKey = `${filePath}\0${String(videoStreamStartSeconds)}\0${String(videoDurationSeconds)}`;
  // A caller-owned abort signal cannot safely own a globally shared process
  // promise: aborting one render would fail unrelated consumers. Calls in the
  // SAME cancellation scope should still share the expensive interval +
  // fallback chain, though — duplicate held-tail elements in one render carry
  // the same signal and otherwise fan out N full-file scans before extraction
  // dedupe. Weakly key the cache by cancellation owner to preserve both
  // aggregate work bounds and cross-render isolation.
  let probeCache = finalVideoFrameTimestampCache;
  if (signal) {
    probeCache = finalVideoFrameTimestampSignalCaches.get(signal) ?? new Map();
    finalVideoFrameTimestampSignalCaches.set(signal, probeCache);
  }
  const cached = probeCache.get(cacheKey);
  if (cached) return cached;

  const probePromise = (async () => {
    if (!(videoDurationSeconds > 0) || !Number.isFinite(videoDurationSeconds)) {
      throw new Error(
        `[FFmpeg] Cannot locate final video frame for invalid duration ${String(videoDurationSeconds)}`,
      );
    }
    const streamEnd = videoStreamStartSeconds + videoDurationSeconds;
    const intervalStart = Math.max(videoStreamStartSeconds, streamEnd - 1);
    const parseFinalTimestamp = (stdout: string): number | undefined =>
      stdout
        .split("\n")
        .map((line) => line.trim().split(",")[0]?.trim() ?? "")
        .filter((value) => value.length > 0)
        .map((value) => Number(value))
        .filter((timestamp) => Number.isFinite(timestamp))
        .at(-1);
    const probe = async (readInterval?: string): Promise<number | undefined> => {
      const args = [
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "csv=p=0",
      ];
      if (readInterval) args.splice(2, 0, "-read_intervals", readInterval);
      const stdout = await runFfprobe(filePath, args, signal, {
        retainTail: true,
        maxChars: 64 * 1024,
      });
      return parseFinalTimestamp(stdout);
    };
    const timestamp =
      (await probe(`${intervalStart}%${streamEnd}`)) ?? (await probe(/* full scan */));
    if (timestamp === undefined) {
      throw new Error("[FFmpeg] ffprobe found no decodable final video frame");
    }
    return Math.min(Math.max(timestamp - videoStreamStartSeconds, 0), videoDurationSeconds);
  })();

  probeCache.set(cacheKey, probePromise);
  probePromise.catch(() => {
    if (probeCache.get(cacheKey) === probePromise) {
      probeCache.delete(cacheKey);
    }
  });
  return probePromise;
}

/**
 * @deprecated Use `extractMediaMetadata` — this name is kept for backward
 * compatibility with consumers that imported the original video-only name
 * before still-image (PNG) support was added. New callers should prefer
 * `extractMediaMetadata`.
 */
export const extractVideoMetadata = extractMediaMetadata;

export async function extractAudioMetadata(
  filePath: string,
  options?: { signal?: AbortSignal },
): Promise<AudioMetadata> {
  // A caller-owned abort signal cannot safely share a cached in-flight probe:
  // cancelling one consumer would also cancel unrelated consumers. Signal-bound
  // probes therefore bypass the process-promise cache.
  const cached = options?.signal ? undefined : audioMetadataCache.get(filePath);
  if (cached) return cached;

  const probePromise = (async (): Promise<AudioMetadata> => {
    const output = await probeMediaOutput(filePath, options?.signal);
    const audioStream = output.streams.find((s) => s.codec_type === "audio");
    if (!audioStream) throw new Error("[FFmpeg] No audio stream found");

    let durationSeconds = output.format.duration ? parseFloat(output.format.duration) : 0;
    const streamDuration = audioStream.duration ? parseFloat(audioStream.duration) : undefined;
    const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate) : 44100;
    const audioCodec = audioStream.codec_name || "unknown";
    // AAC-LC container durations are often slightly wrong, so the packet
    // count gives a better one. Three constraints on that refinement:
    //
    // 1. It must never fail the call. durationSeconds is ALREADY correct from
    //    format.duration at this point. `-count_packets` demuxes the whole
    //    container against runFfprobe's fixed 30s deadline, so a long file on
    //    slow or network storage times out — and the caller in htmlCompiler
    //    catches that under "Source file has no audio stream", returns
    //    duration 0, drops the audio element and ships a silent render.
    // 2. It must honour the caller's AbortSignal. Only the first probe
    //    received it, so aborting during this one was ignored and the call
    //    resolved with full metadata long after cancellation.
    // 3. It must apply ONLY to profiles whose 1024-sample framing is
    //    established. ffprobe reports codec_name "aac" for every AAC
    //    variant — the framing lives in the profile:
    //
    //      LC            1024 samples/frame   <- the only one this maths fits
    //      HE-AAC v1/v2  2048 output samples against a doubled sample_rate
    //      LD            512
    //      ELD           480
    //      Main/SSR/LTP  1024 nominally, but not verified here
    //      xHE-AAC (USAC) variable
    //
    //    An ALLOWLIST, not a HE-AAC denylist. The denylist form let LD/ELD
    //    through (halving to a third of the true duration), and let an
    //    unknown or missing profile through too — so an unrecognised HE
    //    spelling preserved the exact truncation this is meant to close.
    //    A skipped refinement is harmless: format.duration is already correct.
    const isAacLc = /^\s*LC\s*$/i.test(audioStream.profile ?? "");
    if (audioCodec === "aac" && isAacLc && sampleRate > 0) {
      try {
        const packetStdout = await runFfprobe(
          filePath,
          [
            "-select_streams",
            "a:0",
            "-count_packets",
            "-show_entries",
            "stream=nb_read_packets",
            "-print_format",
            "json",
          ],
          options?.signal,
        );
        const packetOutput = parseProbeJson(packetStdout);
        const packetCount = Number(packetOutput.streams[0]?.nb_read_packets);
        if (Number.isFinite(packetCount) && packetCount > 0) {
          durationSeconds = (packetCount * AAC_LC_SAMPLES_PER_PACKET) / sampleRate;
        }
      } catch (error) {
        // An abort is the caller's intent, not a refinement failure — let it
        // through. Anything else keeps the container duration we already have.
        if (options?.signal?.aborted) throw error;
      }
    }

    return {
      durationSeconds,
      streamDurationSeconds: streamDuration && streamDuration > 0 ? streamDuration : undefined,
      sampleRate,
      channels: audioStream.channels || 2,
      audioCodec,
      bitrate: output.format.bit_rate ? parseInt(output.format.bit_rate) : undefined,
    };
  })();

  if (options?.signal) return probePromise;
  audioMetadataCache.set(filePath, probePromise);
  probePromise.catch(() => {
    if (audioMetadataCache.get(filePath) === probePromise) {
      audioMetadataCache.delete(filePath);
    }
  });
  return probePromise;
}

export interface KeyframeAnalysis {
  avgIntervalSeconds: number;
  maxIntervalSeconds: number;
  keyframeCount: number;
  isProblematic: boolean;
}

const keyframeCache = new Map<string, Promise<KeyframeAnalysis>>();

/**
 * Check keyframe intervals in a video file. Intervals > 2s cause seeking
 * issues in the headless renderer and audio/video desync. Videos from
 * yt-dlp --download-sections or screen recordings often have sparse keyframes.
 */
export async function analyzeKeyframeIntervals(filePath: string): Promise<KeyframeAnalysis> {
  const cached = keyframeCache.get(filePath);
  if (cached) return cached;

  const promise = analyzeKeyframeIntervalsUncached(filePath);
  keyframeCache.set(filePath, promise);
  promise.catch(() => {
    if (keyframeCache.get(filePath) === promise) {
      keyframeCache.delete(filePath);
    }
  });
  return promise;
}

async function analyzeKeyframeIntervalsUncached(filePath: string): Promise<KeyframeAnalysis> {
  const stdout = await runFfprobe(filePath, [
    "-select_streams",
    "v:0",
    "-skip_frame",
    "nokey",
    "-show_entries",
    "frame=pts_time",
    "-of",
    "csv=p=0",
  ]);

  const timestamps = stdout
    .split("\n")
    .map((line) => parseFloat(line.trim()))
    .filter((t) => Number.isFinite(t));

  if (timestamps.length < 2) {
    return {
      avgIntervalSeconds: 0,
      maxIntervalSeconds: 0,
      keyframeCount: timestamps.length,
      isProblematic: false,
    };
  }

  let maxInterval = 0;
  let totalInterval = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const interval = (timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0);
    totalInterval += interval;
    if (interval > maxInterval) maxInterval = interval;
  }

  const avgInterval = totalInterval / (timestamps.length - 1);
  return {
    avgIntervalSeconds: Math.round(avgInterval * 100) / 100,
    maxIntervalSeconds: Math.round(maxInterval * 100) / 100,
    keyframeCount: timestamps.length,
    isProblematic: maxInterval > 2,
  };
}
