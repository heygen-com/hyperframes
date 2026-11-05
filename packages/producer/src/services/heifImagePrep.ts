// fallow-ignore-file complexity
// fallow-ignore-file unused-class-member
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { renameWithRetry, runFfmpeg, runFfprobe } from "@hyperframes/engine";
import { readHeifPrimaryRotation } from "./heifRotation.js";
import { withMediaProbeSlot } from "../utils/mediaProbeConcurrency.js";
import {
  normalizeRelPath,
  resolveLocalImageSourcePath,
  splitUrlSuffix,
} from "./animatedGifPrep.js";

const PREPARED_HEIF_SUBDIR = "_heif_images";
const CACHE_SCHEMA = "hfheif-v1";
const DEFAULT_TIMEOUT_MS = 120_000;
export const HEIF_IMAGE_CONVERSION_FAILED = "HEIF_IMAGE_CONVERSION_FAILED" as const;
const HEIF_TOOL_UNAVAILABLE = "HEIF_TOOL_UNAVAILABLE" as const;

/** The `ftyp` brands of a HEIF still coded with the hevc codec. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const DATA_URL_RE = /^data:image\/(?:heic|heif)(?:-sequence)?;base64,(.*)$/is;

export class HeifImageConversionError extends Error {
  readonly code = HEIF_IMAGE_CONVERSION_FAILED;
  readonly owner = "user" as const;
  readonly retryable = false as const;

  constructor(label: string, reason: string) {
    super(
      `Could not convert HEIC/HEIF image ${label} to JPEG: ${reason}. ` +
        `Re-export the photo as JPEG or PNG and update its src.`,
    );
    this.name = "HeifImageConversionError";
  }
}

/** The host's ffmpeg or ffprobe cannot do the job; a different photo would not help. */
export class HeifToolUnavailableError extends Error {
  readonly code = HEIF_TOOL_UNAVAILABLE;
  readonly owner = "system" as const;
  readonly retryable = false as const;

  constructor(label: string, reason: string) {
    super(
      `Could not convert HEIC/HEIF image ${label}: ${reason}. ` +
        `Converting HEIC needs ffmpeg and ffprobe 7.0 or newer with the hevc decoder.`,
    );
    this.name = "HeifToolUnavailableError";
  }
}

const TOOL_FAILURE_RE =
  /(?:ffmpeg|ffprobe) not found|ENOENT|Option not found|Unrecognized option|Unknown decoder|Decoder \S+ not found/i;

export interface HeifTranscodeRequest {
  inputPath: string;
  outputPath: string;
  timeoutMs?: number;
}

export interface PrepareHeifImageInputsOptions {
  projectDir: string;
  downloadDir: string;
  outputDir?: string;
  outputSrcPrefix?: string;
  cacheDir?: string;
  sourceAssets?: Map<string, string>;
  timeoutMs?: number;
  transcode?: (input: HeifTranscodeRequest) => Promise<void>;
  /** Leaves an image whose conversion failed as authored and reports it, instead of throwing. */
  onFailure?: (error: HeifImageConversionError | HeifToolUnavailableError) => void;
}

export interface PreparedHeifImage {
  sourceSrc: string;
  outputSrc: string;
  outputPath: string;
}

export interface PrepareHeifImageInputsResult {
  html: string;
  preparedAssets: Map<string, string>;
  preparedImages: PreparedHeifImage[];
}

/** True when the leading bytes are a HEIF file by its `ftyp` brands, and not an AVIF one. */
export function isHeifBytes(head: Uint8Array): boolean {
  const bytes = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (bytes.length < 16 || bytes.toString("ascii", 4, 8) !== "ftyp") return false;
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length);
  if (boxEnd < 16) return false;
  const brands = [bytes.toString("ascii", 8, 12)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(bytes.toString("ascii", offset, offset + 4));
  }
  return !brands.some((b) => AVIF_BRANDS.has(b)) && brands.some((b) => HEIF_BRANDS.has(b));
}

function readHead(path: string): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(4096);
    return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface ProbedStream {
  width?: number;
  height?: number;
  coded_width?: number;
  coded_height?: number;
  horizontal_offset?: number;
  vertical_offset?: number;
  subcomponents?: {
    stream_index: number;
    tile_horizontal_offset: number;
    tile_vertical_offset: number;
  }[];
}

export interface ProbeJson {
  streams?: ProbedStream[];
  stream_groups?: { components?: ProbedStream[]; disposition?: { default?: number } }[];
}

async function probeJson(path: string, withGroups: boolean): Promise<ProbeJson> {
  const stdout = await runFfprobe(
    path,
    withGroups
      ? ["-show_stream_groups", "-show_streams", "-of", "json"]
      : ["-show_streams", "-of", "json"],
  );
  return JSON.parse(stdout) as ProbeJson;
}

const ROTATION_FILTER = {
  0: "",
  90: "transpose=2",
  180: "hflip,vflip",
  270: "transpose=1",
} as const;

/** The primary item's grid: the group ffmpeg marks default, so an auxiliary grid listed first is skipped. */
export function primaryGrid(probed: ProbeJson): ProbedStream | undefined {
  const groups = probed.stream_groups ?? [];
  return (groups.find((g) => g.disposition?.default === 1) ?? groups[0])?.components?.[0];
}

// ffmpeg through 8.0 decodes a tiled HEIC as separate tiles and ignores its rotation, so stack, crop and rotate.
// The JPEG must equal the declared size (swapped for a quarter turn); a lone tile never passes.
export async function convertHeifToJpeg(request: HeifTranscodeRequest): Promise<void> {
  const probed = await probeJson(request.inputPath, true);
  const grid = primaryGrid(probed);
  const rotation = readHeifPrimaryRotation(readFileSync(request.inputPath));
  const filters: string[] = [];
  let inputs: string[] = [];
  let size = probed.streams?.[0];
  if (grid?.subcomponents?.length) {
    size = grid;
    const layout = grid.subcomponents.map(
      (t) => `${t.tile_horizontal_offset}_${t.tile_vertical_offset}`,
    );
    inputs = grid.subcomponents.map((t) => `[0:${t.stream_index}]`);
    filters.push(
      `${inputs.join("")}xstack=inputs=${inputs.length}:layout=${layout.join("|")}`,
      `crop=${grid.width}:${grid.height}:${grid.horizontal_offset ?? 0}:${grid.vertical_offset ?? 0}`,
    );
  }
  if (!size?.width || !size.height) throw new Error("no declared image size");
  if (rotation && grid) filters.push(ROTATION_FILTER[rotation]);

  const mapArgs =
    filters.length > 0 ? ["-filter_complex", `${filters.join(",")}[v]`, "-map", "[v]"] : [];
  const result = await runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      request.inputPath,
      ...mapArgs,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-f",
      "mjpeg",
      "-y",
      request.outputPath,
    ],
    { timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
  );
  if (!result.success) {
    throw (
      result.error ?? new Error(`ffmpeg exited ${result.exitCode}: ${result.stderr.slice(-300)}`)
    );
  }

  const out = (await probeJson(request.outputPath, false)).streams?.[0];
  const same = out?.width === size.width && out.height === size.height;
  const swapped = out?.width === size.height && out.height === size.width;
  if (!same && !swapped) {
    throw new Error(
      `wrong size: decoded ${out?.width}x${out?.height}, file declares ${size.width}x${size.height}`,
    );
  }
}

interface ImageSource {
  /** Local file holding the HEIF bytes; null for an inline data URL. */
  path: string | null;
  bytes: Buffer;
  label: string;
}

function resolveImageSource(
  src: string,
  options: PrepareHeifImageInputsOptions,
): ImageSource | null {
  const data = DATA_URL_RE.exec(src);
  if (data) {
    const bytes = Buffer.from(data[1]!, "base64");
    return isHeifBytes(bytes.subarray(0, 4096))
      ? { path: null, bytes, label: '"inline image"' }
      : null;
  }
  const path = resolveLocalImageSourcePath(src, options);
  const head = path ? readHead(path) : null;
  if (!path || !head || !isHeifBytes(head)) return null;
  return { path, bytes: readFileSync(path), label: `"${splitUrlSuffix(src).basePath}"` };
}

function isUsableFile(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

async function ensurePreparedJpeg(
  source: ImageSource,
  cachePath: string,
  outputPath: string,
  options: PrepareHeifImageInputsOptions,
): Promise<void> {
  mkdirSync(dirname(cachePath), { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });

  if (!isUsableFile(cachePath)) {
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
    const inlinePath = `${tmpPath}.heic`;
    const inputPath = source.path ?? inlinePath;
    try {
      if (!source.path) writeFileSync(inlinePath, source.bytes);
      await (options.transcode ?? convertHeifToJpeg)({
        inputPath,
        outputPath: tmpPath,
        timeoutMs: options.timeoutMs,
      });
      if (!isUsableFile(tmpPath)) throw new Error("conversion produced an empty file");
      renameWithRetry(tmpPath, cachePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw TOOL_FAILURE_RE.test(reason)
        ? new HeifToolUnavailableError(source.label, reason)
        : new HeifImageConversionError(source.label, reason);
    } finally {
      rmSync(tmpPath, { force: true });
      rmSync(inlinePath, { force: true });
    }
  }
  if (resolve(outputPath) !== resolve(cachePath) && !isUsableFile(outputPath)) {
    copyFileSync(cachePath, outputPath);
  }
}

export async function prepareHeifImageInputs(
  html: string,
  options: PrepareHeifImageInputsOptions,
): Promise<PrepareHeifImageInputsResult> {
  const outputDir = options.outputDir ?? join(options.downloadDir, PREPARED_HEIF_SUBDIR);
  const outputSrcPrefix = normalizeRelPath(options.outputSrcPrefix ?? PREPARED_HEIF_SUBDIR);
  const cacheDir = options.cacheDir ?? outputDir;
  const preparedAssets = new Map<string, string>();
  const preparedImages: PreparedHeifImage[] = [];

  // Compositions without images never reach the HTML parse or any file read.
  if (!/<img\b/i.test(html)) return { html, preparedAssets, preparedImages };
  const { document } = parseHTML(html);

  const found: { img: Element; src: string; source: ImageSource; filename: string }[] = [];
  for (const img of Array.from(document.querySelectorAll("img[src]"))) {
    const src = (img.getAttribute("src") || "").trim();
    const source = src ? resolveImageSource(src, options) : null;
    if (!source) continue;
    const hash = createHash("sha256")
      .update(CACHE_SCHEMA)
      .update("\0")
      .update(source.bytes)
      .digest("hex");
    found.push({ img, src, source, filename: `${CACHE_SCHEMA}-${hash.slice(0, 24)}.jpg` });
  }
  if (found.length === 0) return { html, preparedAssets, preparedImages };

  const unique = new Map(found.map((item) => [item.filename, item.source]));
  const failed = new Set<string>();
  await Promise.all(
    [...unique].map(([filename, source]) =>
      withMediaProbeSlot(() =>
        ensurePreparedJpeg(source, join(cacheDir, filename), join(outputDir, filename), options),
      ).catch((error: HeifImageConversionError | HeifToolUnavailableError) => {
        if (!options.onFailure) throw error;
        failed.add(filename);
        options.onFailure(error);
      }),
    ),
  );

  for (const { img, src, filename } of found) {
    if (failed.has(filename)) continue;
    const outputSrc = `${outputSrcPrefix}/${filename}`;
    img.setAttribute("src", outputSrc);
    preparedAssets.set(outputSrc, join(outputDir, filename));
    preparedImages.push({ sourceSrc: src, outputSrc, outputPath: join(outputDir, filename) });
  }
  return { html: document.toString(), preparedAssets, preparedImages };
}
