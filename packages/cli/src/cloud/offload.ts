/**
 * Moves a cloud render's heavy media out of the project zip into HeyGen assets and points the
 * staged copy's references at the asset URLs. The project on disk is never touched.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { parseHTML } from "linkedom";
import { parseAnimatedGifMetadata } from "@hyperframes/core";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  resolveLocalAssetCandidates,
} from "@hyperframes/parsers/asset-resolution";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { formatBytes } from "../ui/format.js";
import { type PlayedSegment, planTrim } from "./offloadTrim.js";
import {
  assertUnchanged,
  type HtmlAttributeResolver,
  readChecked,
  rewriteCssUrls,
  rewriteHtmlAttributes,
  rewriteStyleBlocks,
  type StagedFile,
  stagedSize,
  TEXT_FILE_EXTS,
} from "../utils/publishProject.js";

const execFileAsync = promisify(execFile);

/** Media at or above this size leaves the zip as a HeyGen asset. */
export const OFFLOAD_MIN_BYTES = 5 * 1024 * 1024;

const MiB = 1024 * 1024;
const AUDIO_MAX_BYTES = 1_500_000_000;

// What POST /v3/assets/direct-uploads takes as-is, and its per-type cap.
const ACCEPTED: Record<string, { contentType: string; maxBytes: number }> = {
  ".mp4": { contentType: "video/mp4", maxBytes: 200 * MiB },
  ".m4v": { contentType: "video/mp4", maxBytes: 200 * MiB },
  ".mov": { contentType: "video/quicktime", maxBytes: 200 * MiB },
  ".webm": { contentType: "video/webm", maxBytes: 200 * MiB },
  ".png": { contentType: "image/png", maxBytes: 200 * MiB },
  ".jpg": { contentType: "image/jpeg", maxBytes: 200 * MiB },
  ".jpeg": { contentType: "image/jpeg", maxBytes: 200 * MiB },
  ".webp": { contentType: "image/webp", maxBytes: 200 * MiB },
  ".wav": { contentType: "audio/wav", maxBytes: AUDIO_MAX_BYTES },
  ".mp3": { contentType: "audio/mpeg", maxBytes: AUDIO_MAX_BYTES },
};

const VIDEO_EXTS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
  ".mts",
  ".flv",
  ".wmv",
  ".ogv",
  ".3gp",
]);
const AUDIO_EXTS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".aif",
  ".aiff",
  ".wma",
]);
// Still images the API refuses; converted to PNG unless animated.
const CONVERTIBLE_IMAGE_EXTS = new Set([".gif", ".avif", ".bmp", ".tif", ".tiff"]);

/** Visually lossless re-encodes for media the asset API refuses or caps. Quality lives here. */
const REENCODE_PRESETS = {
  video: {
    ext: ".mp4",
    contentType: "video/mp4",
    args: ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p"],
    audio: ["-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"],
  },
  hdrVideo: {
    ext: ".mp4",
    contentType: "video/mp4",
    args: ["-c:v", "libx265", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p10le"],
    audio: ["-tag:v", "hvc1", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart"],
  },
  alphaVideo: {
    ext: ".webm",
    contentType: "video/webm",
    args: ["-c:v", "libvpx-vp9", "-crf", "18", "-b:v", "0", "-pix_fmt", "yuva420p"],
    audio: ["-c:a", "libopus", "-b:a", "256k"],
  },
  audio: {
    ext: ".wav",
    contentType: "audio/wav",
    args: ["-vn"],
    audio: ["-c:a", "pcm_s16le"],
  },
  image: {
    ext: ".png",
    contentType: "image/png",
    args: ["-frames:v", "1"],
    audio: [],
  },
} as const;

export type PresetName = keyof typeof REENCODE_PRESETS;

export interface OffloadedMedia {
  path: string;
  size_bytes: number;
  /** What happened (or, on a dry run, would happen) to the file. */
  action: "upload" | "reencode" | "cached";
  url?: string;
  /** Seconds of the source kept when only the parts the composition plays are uploaded. */
  trimmed_to_seconds?: number;
  /** Still referenced from a script or data file, so a copy also stays in the zip. */
  kept_in_archive?: boolean;
}

/** In memory, or a file on disk that the upload streams. */
export type UploadableFile = { filename: string; contentType: string } & (
  | { bytes: Uint8Array }
  | { path: string; size: number }
);

export interface OffloadOptions {
  /** Cache key namespace, so assets from one API host are never reused on another. */
  apiBaseUrl: string;
  /** Absent on a dry run: nothing is encoded, uploaded or fetched. */
  upload?: (file: UploadableFile) => Promise<{ asset_id: string; url: string }>;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  /** The composition the render starts from; its animated GIFs are prepared as video. */
  entryPath?: string;
  /** Overrides ffprobe/ffmpeg for tests. */
  reencoder?: Reencoder;
  /** Overrides the renderer's GIF preparation for tests. */
  gifPrep?: GifPrep;
  onFile?: (item: OffloadedMedia) => void;
}

type MediaKind = "video" | "audio" | "image";

export interface Reencoder {
  /** `null` keeps the file in the zip as authored. */
  choose: (sourcePath: string, kind: MediaKind) => Promise<PresetName | null>;
  /** Positions per second a cut may land on (the frame rate), or null when the file cannot be cut. */
  trimGrid?: (sourcePath: string, kind: MediaKind) => Promise<number | null>;
  run: (
    sourcePath: string,
    preset: PresetName,
    segments?: PlayedSegment[],
  ) => Promise<UploadableFile>;
}

export type GifPrep = (
  html: string,
  options: {
    projectDir: string;
    downloadDir: string;
    outputDir: string;
    outputSrcPrefix: string;
    cacheDir: string;
    sourceAssets: Map<string, string>;
  },
) => Promise<{ html: string; preparedGifs: Array<{ sourceSrc: string; outputPath: string }> }>;

interface CacheEntry {
  asset_id: string;
  url: string;
  size_bytes: number;
}

function defaultOffloadCachePath(): string {
  return join(homedir(), ".cache", "hyperframes", "cloud-assets.json");
}

function readCache(path: string): Record<string, CacheEntry> {
  try {
    return (JSON.parse(readFileSync(path, "utf-8")) as Record<string, CacheEntry> | null) ?? {};
  } catch {
    return {};
  }
}

function writeCache(path: string, cache: Record<string, CacheEntry>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, path);
}

// Asset URLs are public and unsigned, so HEAD needs no auth; a deleted or replaced asset fails it.
async function stillServed(entry: CacheEntry, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(entry.url, { method: "HEAD" });
    return res.ok && Number(res.headers.get("content-length")) === entry.size_bytes;
  } catch {
    return false;
  }
}

function mediaKind(path: string): MediaKind | null {
  const ext = extname(path).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ACCEPTED[ext] || CONVERTIBLE_IMAGE_EXTS.has(ext)) return "image";
  return null;
}

interface VideoProbe {
  alpha: boolean;
  hdr: boolean;
  codec?: string;
  color: { primaries?: string; transfer?: string; space?: string };
}

async function probeVideo(path: string): Promise<VideoProbe> {
  const ffprobe = findFFprobe();
  if (!ffprobe)
    throw new Error(`Re-encoding needs ffprobe. Install ffmpeg: ${getFFmpegInstallHint()}`);
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,pix_fmt,color_primaries,color_transfer,color_space:stream_tags",
    "-of",
    "json",
    "--",
    path,
  ]);
  const stream = (JSON.parse(stdout).streams?.[0] ?? {}) as Record<string, unknown>;
  const tags = (stream.tags ?? {}) as Record<string, string>;
  const alphaTag = Object.entries(tags).some(
    ([k, v]) => k.toLowerCase() === "alpha_mode" && v === "1",
  );
  const transfer = stream.color_transfer as string | undefined;
  return {
    // VP9 alpha keeps pix_fmt yuv420p and flags the plane only in the ALPHA_MODE tag.
    alpha: alphaTag || /^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(String(stream.pix_fmt ?? "")),
    hdr: transfer === "smpte2084" || transfer === "arib-std-b67",
    codec: stream.codec_name as string | undefined,
    color: {
      primaries: stream.color_primaries as string | undefined,
      transfer,
      space: stream.color_space as string | undefined,
    },
  };
}

// ffmpeg's native VP8/VP9 decoders drop the alpha plane; libvpx keeps it.
function alphaDecoderArgs(probe: VideoProbe): string[] {
  if (!probe.alpha) return [];
  if (probe.codec === "vp9") return ["-c:v", "libvpx-vp9"];
  if (probe.codec === "vp8") return ["-c:v", "libvpx"];
  return [];
}

function hdrColorArgs({ color }: VideoProbe): string[] {
  return [
    ...(color.primaries ? ["-color_primaries", color.primaries] : []),
    ...(color.transfer ? ["-color_trc", color.transfer] : []),
    ...(color.space ? ["-colorspace", color.space] : []),
  ];
}

async function hasAudioStream(ffprobe: string, path: string): Promise<boolean> {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    "--",
    path,
  ]);
  return stdout.trim() !== "";
}

// Seconds floored to the microsecond, so a frame-aligned cut never rounds past its first frame.
const seconds = (t: number) => (Math.floor(t * 1e6) / 1e6).toFixed(6);

/** Inputs and mapping for a cut: one accurately seeked input per segment, joined in order. */
async function segmentArgs(
  sourcePath: string,
  decoder: string[],
  segments: PlayedSegment[] | undefined,
  audioOnly: boolean,
): Promise<string[]> {
  if (!segments?.length) return [...decoder, "-i", sourcePath];
  const inputs = segments.flatMap((s) => [
    ...decoder,
    "-ss",
    seconds(s.start),
    "-t",
    seconds(s.end - s.start),
    "-i",
    sourcePath,
  ]);
  if (segments.length === 1) return inputs;
  const audio = audioOnly || (await hasAudioStream(findFFprobe()!, sourcePath));
  return [...inputs, ...concatArgs(segments.length, !audioOnly, audio)];
}

function concatArgs(count: number, video: boolean, audio: boolean): string[] {
  const pad = (i: number) => (video ? `[${i}:v]` : "") + (audio ? `[${i}:a]` : "");
  const pads = Array.from({ length: count }, (_, i) => pad(i)).join("");
  const flags = `n=${count}:v=${video ? 1 : 0}:a=${audio ? 1 : 0}`;
  return [
    "-filter_complex",
    `${pads}concat=${flags}${video ? "[v]" : ""}${audio ? "[a]" : ""}`,
    ...(video ? ["-map", "[v]"] : []),
    ...(audio ? ["-map", "[a]"] : []),
  ];
}

async function ffmpegReencode(
  sourcePath: string,
  presetName: PresetName,
  segments?: PlayedSegment[],
): Promise<UploadableFile> {
  const ffmpeg = findFFmpeg();
  if (!ffmpeg) throw new Error(`Re-encoding needs ffmpeg. Install it: ${getFFmpegInstallHint()}`);
  const preset = REENCODE_PRESETS[presetName];
  const probe = preset.contentType.startsWith("video/") ? await probeVideo(sourcePath) : undefined;
  const decoder = probe ? alphaDecoderArgs(probe) : [];
  const color = presetName === "hdrVideo" && probe ? hdrColorArgs(probe) : [];
  const workDir = mkdtempSync(join(tmpdir(), "hf-offload-"));
  const outPath = join(workDir, `${basename(sourcePath, extname(sourcePath))}${preset.ext}`);
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-v",
        "error",
        "-y",
        ...(await segmentArgs(sourcePath, decoder, segments, presetName === "audio")),
        ...preset.args,
        ...color,
        ...preset.audio,
        outPath,
      ],
      { maxBuffer: 16 * MiB },
    );
    // Never read an output the asset API would refuse: it can exceed what one read can hold.
    return {
      bytes: readChecked(outPath, ({ size }) => assertFitsAsset(sourcePath, outPath, size)),
      filename: basename(outPath),
      contentType: preset.contentType,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function choosePreset(sourcePath: string, kind: MediaKind): Promise<PresetName | null> {
  if (kind === "audio") return "audio";
  // An animated image's first frame is not the image; such files stay in the zip.
  if (kind === "image") return (await isAnimatedImage(sourcePath)) ? null : "image";
  const probe = await probeVideo(sourcePath);
  return probe.alpha ? "alphaVideo" : probe.hdr ? "hdrVideo" : "video";
}

async function isAnimatedImage(path: string): Promise<boolean> {
  if (extname(path).toLowerCase() === ".gif") {
    return parseAnimatedGifMetadata(readFileSync(path))?.animated ?? true;
  }
  const ffprobe = findFFprobe();
  if (!ffprobe) return true;
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "stream=nb_frames",
      "-of",
      "csv=p=0",
      "--",
      path,
    ]);
    return stdout.split("\n").some((line) => Number(line) > 1);
  } catch {
    return true;
  }
}

// Audio cuts land on the millisecond; video only on a constant frame rate's frames.
async function trimGrid(sourcePath: string, kind: MediaKind): Promise<number | null> {
  if (kind === "audio") return 1000;
  if (kind !== "video") return null;
  const ffprobe = findFFprobe();
  if (!ffprobe) return null;
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=r_frame_rate,avg_frame_rate",
    "-of",
    "csv=p=0",
    "--",
    sourcePath,
  ]);
  const rate = (fraction: string | undefined) => {
    const [num, den] = (fraction ?? "").split("/").map(Number);
    return num && den ? num / den : NaN;
  };
  const [real, average] = stdout.trim().split(",");
  const fps = rate(real);
  return Number.isFinite(fps) && Math.abs(fps - rate(average)) < 0.01 ? fps : null;
}

const ffmpegReencoder: Reencoder = { choose: choosePreset, trimGrid, run: ffmpegReencode };

async function stagedSha256(file: StagedFile): Promise<string> {
  if (Buffer.isBuffer(file)) return createHash("sha256").update(file).digest("hex");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file.absPath)) hash.update(chunk as Buffer);
  assertUnchanged(file);
  return hash.digest("hex");
}

/**
 * A path holding the staged bytes, so an encode reads what its cache key hashed: a file left on disk
 * is used in place (checked unchanged after use), one staged in memory gets a temp copy.
 */
function snapshotPath(path: string, file: StagedFile, tempFiles: string[]): string {
  return Buffer.isBuffer(file) ? stagedCopy(path, file, tempFiles) : file.absPath;
}

/** A private copy of the staged bytes, for readers that cache what they read before any check runs. */
function stagedCopy(path: string, file: StagedFile, tempFiles: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-offload-src-"));
  tempFiles.push(dir);
  const copy = join(dir, basename(path));
  if (Buffer.isBuffer(file)) writeFileSync(copy, file);
  else {
    copyFileSync(file.absPath, copy);
    assertUnchanged(file);
  }
  return copy;
}

/** A text file's contents; media is never decoded, since it can exceed the longest string V8 allows. */
function textOf(path: string, file: StagedFile | undefined): string | undefined {
  return TEXT_FILE_EXTS.test(path) && Buffer.isBuffer(file) ? file.toString("utf-8") : undefined;
}

/** What the page's scripts can read: inline scripts of HTML files, and script and data files. */
function scriptCode(fileMap: Map<string, StagedFile>): string {
  const parts: string[] = [];
  for (const [path, content] of fileMap) {
    const text = textOf(path, content);
    if (text === undefined) continue;
    if (/\.html?$/i.test(path)) {
      for (const script of parseHTML(text).document.querySelectorAll("script:not([src])")) {
        parts.push(script.textContent ?? "");
      }
    } else if (/\.(m?js|cjs|json)$/i.test(path)) parts.push(text);
  }
  return parts.join("\n");
}

function assertFitsAsset(path: string, filename: string, size: number): void {
  const maxBytes = ACCEPTED[extname(filename).toLowerCase()]?.maxBytes ?? 0;
  if (size > maxBytes) {
    throw new Error(
      `${path} is ${formatBytes(size)} after re-encoding at visually lossless quality, over the ${formatBytes(maxBytes)} a HeyGen asset can hold.`,
    );
  }
}

interface OffloadContext {
  absDir: string;
  opts: OffloadOptions;
  cachePath: string;
  cache: Record<string, CacheEntry>;
  fetchImpl: typeof fetch;
  reencoder: Reencoder;
  tempFiles: string[];
  /** Staged GIFs the entry composition no longer shows as images. */
  preparedGifSources: string[];
  fileMap: Map<string, StagedFile>;
}

interface FilePlan {
  key: string;
  preset?: PresetName;
  sourcePath: string;
  contentType?: string;
  segments?: PlayedSegment[];
}

async function planFile(
  ctx: OffloadContext,
  path: string,
  file: StagedFile,
): Promise<FilePlan | null> {
  const kind = mediaKind(path);
  const size = stagedSize(file);
  if (!kind || size < OFFLOAD_MIN_BYTES) return null;
  const sha256 = await stagedSha256(file);
  const keyFor = (variant: string) => `${ctx.opts.apiBaseUrl} ${sha256} ${variant}`;
  const accepted = ACCEPTED[extname(path).toLowerCase()];
  if (accepted && size <= accepted.maxBytes) {
    return { key: keyFor("as-is"), sourcePath: "", contentType: accepted.contentType };
  }
  const sourcePath = snapshotPath(path, file, ctx.tempFiles);
  const preset = await ctx.reencoder.choose(sourcePath, kind);
  // Files left as authored stay in the zip; the archive size check names them.
  if (!preset) return null;
  const segments = kind === "image" ? null : await planFileTrim(ctx, path, sourcePath, kind);
  // Keyed by encode settings and cut too, so either changing re-encodes instead of reusing old output.
  const variant = JSON.stringify([REENCODE_PRESETS[preset], segments]);
  return { key: keyFor(variant), preset, sourcePath, segments: segments ?? undefined };
}

/** Cuts a re-encoded file to what the entry composition plays, shifting its clips to match. */
async function planFileTrim(
  ctx: OffloadContext,
  path: string,
  sourcePath: string,
  kind: MediaKind,
): Promise<PlayedSegment[] | null> {
  const entryPath = ctx.opts.entryPath ?? "index.html";
  const entryHtml = textOf(entryPath, ctx.fileMap.get(entryPath));
  const gridPerSecond = entryHtml ? await ctx.reencoder.trimGrid?.(sourcePath, kind) : null;
  if (!entryHtml || !gridPerSecond) return null;
  const name = basename(path);
  const plan = planTrim({
    entryHtml,
    path,
    gridPerSecond,
    resolveKey: (raw) => htmlSrcKey(ctx.absDir, entryPath, raw, ctx.fileMap),
    mentionedElsewhere: [...ctx.fileMap].some(
      ([other, content]) =>
        other !== entryPath && other !== path && !!textOf(other, content)?.includes(name),
    ),
    scriptCode: scriptCode(ctx.fileMap),
  });
  if (!plan) return null;
  ctx.fileMap.set(entryPath, Buffer.from(plan.html, "utf-8"));
  return plan.segments;
}

async function offloadFile(
  ctx: OffloadContext,
  path: string,
  file: StagedFile,
): Promise<OffloadedMedia | null> {
  const plan = await planFile(ctx, path, file);
  if (!plan) return null;
  const item: OffloadedMedia = {
    path,
    size_bytes: stagedSize(file),
    action: plan.preset ? "reencode" : "upload",
    ...(plan.segments && {
      trimmed_to_seconds: plan.segments.reduce((sum, s) => sum + s.end - s.start, 0),
    }),
  };
  const hit = ctx.cache[plan.key];
  if (hit && (!ctx.opts.upload || (await stillServed(hit, ctx.fetchImpl)))) {
    return { ...item, action: "cached", url: hit.url };
  }
  if (!ctx.opts.upload) return item;
  return { ...item, url: await uploadPlanned(ctx, ctx.opts.upload, path, file, plan) };
}

async function uploadPlanned(
  ctx: OffloadContext,
  upload: NonNullable<OffloadOptions["upload"]>,
  path: string,
  staged: StagedFile,
  plan: FilePlan,
): Promise<string> {
  const filename = basename(path);
  const file: UploadableFile = plan.preset
    ? await ctx.reencoder.run(plan.sourcePath, plan.preset, plan.segments)
    : Buffer.isBuffer(staged)
      ? { bytes: staged, filename, contentType: plan.contentType! }
      : { path: staged.absPath, size: staged.size, filename, contentType: plan.contentType! };
  if (plan.preset && !Buffer.isBuffer(staged)) assertUnchanged(staged);
  const size = "bytes" in file ? file.bytes.byteLength : file.size;
  assertFitsAsset(path, file.filename, size);
  const asset = await upload(file);
  if (!Buffer.isBuffer(staged)) assertUnchanged(staged);
  ctx.cache[plan.key] = {
    asset_id: asset.asset_id,
    url: asset.url,
    size_bytes: size,
  };
  writeCache(ctx.cachePath, ctx.cache);
  return asset.url;
}

const GIF_PREFIX = "_animated_gif";

// The renderer's own GIF prep turns each animated <img> into a seek-synced WebM <video>, which then
// offloads like any video. Sub-compositions are prepared by the renderer after inlining, so not here.
async function prepareEntryGifs(
  ctx: OffloadContext,
  fileMap: Map<string, StagedFile>,
): Promise<void> {
  const entryPath = ctx.opts.entryPath ?? "index.html";
  const html = textOf(entryPath, fileMap.get(entryPath));
  if (!html || !/\.gif\b/i.test(html)) return;
  const sourceAssets = entryGifSources(ctx, entryPath, html);
  if (!sourceAssets) return;
  const prep = ctx.opts.gifPrep ?? (await import("@hyperframes/producer")).prepareAnimatedGifInputs;
  const outputDir = mkdtempSync(join(tmpdir(), "hf-offload-gif-"));
  ctx.tempFiles.push(outputDir);
  const result = await prep(html, {
    projectDir: ctx.absDir,
    downloadDir: outputDir,
    outputDir,
    outputSrcPrefix: posix.relative(posix.dirname(entryPath), GIF_PREFIX),
    cacheDir: join(homedir(), ".cache", "hyperframes", "animated-gif"),
    sourceAssets,
  });
  if (result.preparedGifs.length === 0) return;
  fileMap.set(entryPath, Buffer.from(result.html, "utf-8"));
  for (const gif of result.preparedGifs) {
    fileMap.set(`${GIF_PREFIX}/${basename(gif.outputPath)}`, readFileSync(gif.outputPath));
    const source = htmlSrcKey(ctx.absDir, entryPath, gif.sourceSrc.trim(), fileMap);
    if (source) ctx.preparedGifSources.push(source);
  }
}

/**
 * Each entry GIF's staged bytes, resolved the way the renderer rebases a nested entry; `null` when none
 * is heavy, since the renderer's own GIF prep then suffices and needs no local ffmpeg.
 */
function entryGifSources(
  ctx: OffloadContext,
  entryPath: string,
  html: string,
): Map<string, string> | null {
  const sourceAssets = new Map<string, string>();
  let heavy = false;
  for (const img of parseHTML(html).document.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src")!.trim();
    const key = htmlSrcKey(ctx.absDir, entryPath, src, ctx.fileMap);
    if (!key?.toLowerCase().endsWith(".gif")) continue;
    const file = ctx.fileMap.get(key)!;
    sourceAssets.set(src, stagedCopy(key, file, ctx.tempFiles));
    heavy ||= stagedSize(file) >= OFFLOAD_MIN_BYTES;
  }
  return heavy ? sourceAssets : null;
}

/**
 * Upload each heavy media file as an asset (or reuse a cached one still served), point its references at the
 * asset URL and drop it from `fileMap`. Without `upload`, nothing uploads and only animated GIFs are encoded.
 */
export async function offloadHeavyMedia(
  projectDir: string,
  fileMap: Map<string, StagedFile>,
  opts: OffloadOptions,
): Promise<OffloadedMedia[]> {
  const cachePath = opts.cachePath ?? defaultOffloadCachePath();
  const ctx: OffloadContext = {
    absDir: resolve(projectDir),
    opts,
    cachePath,
    cache: readCache(cachePath),
    fetchImpl: opts.fetchImpl ?? fetch,
    reencoder: opts.reencoder ?? ffmpegReencoder,
    tempFiles: [],
    preparedGifSources: [],
    fileMap,
  };
  const urls = new Map<string, string>();
  const report: OffloadedMedia[] = [];
  try {
    await prepareEntryGifs(ctx, fileMap);
    // Only files a reference points at: one used through render-time --variables must stay in the zip.
    const referenced = referencedFiles(ctx.absDir, fileMap);
    for (const [path, file] of [...fileMap].sort(([a], [b]) => a.localeCompare(b))) {
      if (!referenced.has(path)) continue;
      const item = await offloadFile(ctx, path, file);
      if (!item) continue;
      // A dry run rewrites to a stand-in URL so the reported archive size matches the real one.
      urls.set(path, item.url ?? `https://assets.invalid/${report.length}`);
      report.push(item);
      opts.onFile?.(item);
    }
  } finally {
    for (const dir of ctx.tempFiles) rmSync(dir, { recursive: true, force: true });
  }

  if (urls.size > 0) rewriteReferences(ctx.absDir, fileMap, (key) => urls.get(key) ?? null);
  dropReplacedFiles(fileMap, report, ctx.preparedGifSources, [...urls.values()]);
  return report;
}

function dropReplacedFiles(
  fileMap: Map<string, StagedFile>,
  report: OffloadedMedia[],
  preparedGifSources: string[],
  assetUrls: string[],
): void {
  // Asset URLs end in names like original.mp4 that can collide with a project file's name.
  const withoutUrls = (text: string) =>
    assetUrls.reduce((acc, url) => acc.replaceAll(url, ""), text);
  const code = withoutUrls(scriptCode(fileMap));
  for (const item of report) {
    if (isStillMentioned(fileMap, item.path, code, withoutUrls)) item.kept_in_archive = true;
    else fileMap.delete(item.path);
  }
  for (const gif of preparedGifSources) {
    if (!isStillMentioned(fileMap, gif, code, withoutUrls)) fileMap.delete(gif);
  }
}

/**
 * Whether a reference rewriting could not replace may still load the file: its name anywhere, or its
 * stem and extension both in script code, which can join them at runtime ("clip" + ".mp4").
 */
function isStillMentioned(
  fileMap: Map<string, StagedFile>,
  path: string,
  code: string,
  withoutUrls: (text: string) => string,
): boolean {
  const ext = extname(path);
  if (code.includes(basename(path, ext)) && code.includes(ext.slice(1))) return true;
  const name = basename(path);
  for (const [entryPath, content] of fileMap) {
    const contentText = textOf(entryPath, content);
    if (entryPath === path || !contentText?.includes(name)) continue;
    if (withoutUrls(contentText).includes(name)) return true;
  }
  return false;
}

/** The staged file an HTML src loads, resolved the way the renderer inlines sub-compositions. */
function htmlSrcKey(
  absDir: string,
  entryPath: string,
  raw: string,
  fileMap: Map<string, StagedFile>,
): string | null {
  const clean = cleanAssetUrl(raw);
  if (!clean || isRemoteOrInlineUrl(clean)) return null;
  const rootRelative = clean.startsWith("/")
    ? clean
    : rewriteAssetPath(entryPath, clean, (p) => fileMap.has(p));
  for (const candidate of resolveLocalAssetCandidates(absDir, rootRelative)) {
    const key = relative(absDir, candidate).replaceAll("\\", "/");
    if (fileMap.has(key)) return key;
  }
  return null;
}

type UrlFor = (rootRelative: string) => string | null;

/** The staged files that references rewriteReferences would replace point at. */
function referencedFiles(absDir: string, fileMap: Map<string, StagedFile>): Set<string> {
  const keys = new Set<string>();
  rewriteReferences(absDir, fileMap, (key) => {
    if (fileMap.has(key)) keys.add(key);
    return null;
  });
  return keys;
}

function rewriteReferences(
  absDir: string,
  fileMap: Map<string, StagedFile>,
  urlForKey: (key: string) => string | null,
): void {
  const urlFor: UrlFor = (rootRelative) => {
    for (const candidate of resolveLocalAssetCandidates(absDir, rootRelative)) {
      const url = urlForKey(relative(absDir, candidate).replaceAll("\\", "/"));
      if (url) return url;
    }
    return null;
  };

  for (const [entryPath, content] of [...fileMap]) {
    const rewrite = rewriterFor(absDir, entryPath, urlFor, fileMap);
    const text = rewrite ? textOf(entryPath, content) : undefined;
    const next = rewrite && text !== undefined ? rewrite(text) : null;
    if (next !== null) fileMap.set(entryPath, Buffer.from(next, "utf-8"));
  }
}

function rewriterFor(
  absDir: string,
  entryPath: string,
  urlFor: UrlFor,
  fileMap: Map<string, StagedFile>,
): ((text: string) => string | null) | null {
  if (/\.html?$/i.test(entryPath)) {
    return (text) => rewriteHtmlEntry(absDir, entryPath, text, urlFor, fileMap);
  }
  if (/\.css$/i.test(entryPath)) return (text) => rewriteCssEntry(absDir, entryPath, text, urlFor);
  if (/\.(m?js|cjs|json)$/i.test(entryPath)) return (text) => rewriteStringLiterals(text, urlFor);
  return null;
}

function localTarget(raw: string, toRootRelative: (clean: string) => string, urlFor: UrlFor) {
  const clean = cleanAssetUrl(raw);
  if (!clean || isRemoteOrInlineUrl(clean)) return null;
  const url = urlFor(clean.startsWith("/") ? clean : toRootRelative(clean));
  // Keep a query or media fragment such as #t=5,8.
  return url && url + raw.trim().slice(clean.length);
}

function rewriteCssEntry(absDir: string, entryPath: string, css: string, urlFor: UrlFor) {
  // A stylesheet's url() resolves against the stylesheet itself.
  const result = rewriteCssUrls(css, resolve(absDir, dirname(entryPath)), entryPath, (raw) =>
    localTarget(raw, (clean) => posix.join(posix.dirname(entryPath), clean), urlFor),
  );
  return result.modified ? result.css : null;
}

function rewriteHtmlEntry(
  absDir: string,
  entryPath: string,
  html: string,
  urlFor: UrlFor,
  fileMap: Map<string, StagedFile>,
): string | null {
  const referrerAbsDir = resolve(absDir, dirname(entryPath));
  // Sub-composition srcs resolve the way the renderer inlines them.
  const resolveTarget: HtmlAttributeResolver = (raw) =>
    localTarget(raw, (clean) => rewriteAssetPath(entryPath, clean, (p) => fileMap.has(p)), urlFor);
  const { document } = parseHTML(html);
  const attrs = rewriteHtmlAttributes(document, referrerAbsDir, entryPath, resolveTarget, {
    attrs: ["src", "poster", "href"],
  });
  const srcsets = rewriteSrcsets(document, resolveTarget);
  const styles = rewriteStyleBlocks(document, referrerAbsDir, entryPath, resolveTarget);
  let scripts = false;
  for (const script of document.querySelectorAll("script")) {
    if (script.hasAttribute("src")) continue;
    const next = rewriteStringLiterals(script.textContent ?? "", urlFor);
    if (next === null) continue;
    script.textContent = next;
    scripts = true;
  }
  return attrs || srcsets || styles || scripts ? document.toString() : null;
}

// A plain string literal: no escapes, interpolation or line breaks.
const STRING_LITERAL_RE = /(["'`])([^"'`\\\n$]+)\1/g;

/** Script URLs resolve against the page, which the renderer roots at the project. */
function rewriteStringLiterals(code: string, urlFor: UrlFor): string | null {
  let modified = false;
  const next = code.replace(STRING_LITERAL_RE, (full, quote: string, value: string) => {
    const url = localTarget(value, (clean) => clean, urlFor);
    if (!url) return full;
    modified = true;
    return `${quote}${url}${quote}`;
  });
  return modified ? next : null;
}

function rewriteSrcsets(document: Document, resolveTarget: HtmlAttributeResolver): boolean {
  let modified = false;
  for (const el of document.querySelectorAll("[srcset]")) {
    const srcset = el.getAttribute("srcset") ?? "";
    // A data: candidate carries its own commas; leave such a srcset as authored.
    if (srcset.includes("data:")) continue;
    let changed = false;
    const next = srcset
      .split(",")
      .map((part) => {
        const [url, ...descriptors] = part.trim().split(/\s+/);
        const target = url ? resolveTarget(url, "") : null;
        if (!target) return part.trim();
        changed = true;
        return [target, ...descriptors].join(" ");
      })
      .join(", ");
    if (changed) {
      el.setAttribute("srcset", next);
      modified = true;
    }
  }
  return modified;
}
