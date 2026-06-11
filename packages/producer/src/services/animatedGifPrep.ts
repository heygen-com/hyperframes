import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { parseAnimatedGifMetadata, type AnimatedGifMetadata } from "@hyperframes/core";
import { isHttpUrl } from "../utils/urlDownloader.js";

const PREPARED_GIF_SUBDIR = "_animated_gif";
const CACHE_SCHEMA = "hfgif-v1";

export interface PreparedAnimatedGif {
  id: string;
  sourceSrc: string;
  outputSrc: string;
  outputPath: string;
  metadata: AnimatedGifMetadata;
  loop: boolean;
  loopIterations: number;
  padSeconds: number;
}

export interface PrepareAnimatedGifInputsOptions {
  projectDir: string;
  downloadDir: string;
  outputDir?: string;
  outputSrcPrefix?: string;
  cacheDir?: string;
  sourceAssets?: Map<string, string>;
  timeoutMs?: number;
  transcode?: (input: AnimatedGifTranscodeRequest) => Promise<void>;
}

export interface AnimatedGifTranscodeRequest {
  inputPath: string;
  outputPath: string;
  args: string[];
  timeoutMs?: number;
}

export interface PrepareAnimatedGifInputsResult {
  html: string;
  preparedAssets: Map<string, string>;
  preparedGifs: PreparedAnimatedGif[];
}

function splitUrlSuffix(src: string): { basePath: string; suffix: string } {
  const queryIdx = src.indexOf("?");
  const hashIdx = src.indexOf("#");
  if (queryIdx < 0 && hashIdx < 0) return { basePath: src, suffix: "" };
  const cutIdx = queryIdx < 0 ? hashIdx : hashIdx < 0 ? queryIdx : Math.min(queryIdx, hashIdx);
  return { basePath: src.slice(0, cutIdx), suffix: src.slice(cutIdx) };
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function hasGifExtension(src: string): boolean {
  const { basePath } = splitUrlSuffix(src.trim().toLowerCase());
  return basePath.endsWith(".gif");
}

function readLoopOverride(el: Element): boolean | null {
  const raw = el.getAttribute("data-loop");
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "" || normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function resolveGifSourcePath(
  src: string,
  options: Pick<PrepareAnimatedGifInputsOptions, "projectDir" | "downloadDir" | "sourceAssets">,
): string | null {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  const { basePath } = splitUrlSuffix(trimmed);
  const normalizedBase = normalizeRelPath(basePath);

  const mapped =
    options.sourceAssets?.get(trimmed) ??
    options.sourceAssets?.get(basePath) ??
    options.sourceAssets?.get(normalizedBase);
  if (mapped && existsSync(mapped)) return mapped;
  if (isHttpUrl(trimmed)) return null;

  const projectRelative = basePath.startsWith("/") ? basePath.slice(1) : basePath;
  const candidates = [
    isAbsolute(basePath) ? basePath : resolve(options.projectDir, projectRelative),
    resolve(options.downloadDir, normalizedBase),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isUsableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function computePreparedGifHash(
  bytes: Uint8Array,
  loopIterations: number,
  padSeconds: number,
): string {
  return createHash("sha256")
    .update(CACHE_SCHEMA)
    .update("\0")
    .update(String(loopIterations))
    .update("\0")
    .update(String(padSeconds))
    .update("\0")
    .update(bytes)
    .digest("hex");
}

function resolveLoop(metadata: AnimatedGifMetadata, override: boolean | null): boolean {
  if (override != null) return override;
  return metadata.loopCount === 0;
}

/**
 * The render pipeline seek-syncs <video> elements and does not honor the
 * native `loop` attribute, so a 2s WebM inside a 10s clip would vanish after
 * 2s. Prep-time knows the clip window, so looping is baked into the encoded
 * file: enough `-stream_loop` iterations to cover the window, plus a
 * clone-frame pad for finite-loop GIFs that hold their last frame.
 */
const MAX_LOOP_ITERATIONS = 1_000;
const MAX_PAD_SECONDS = 3_600;

function resolveCompositionDurationSeconds(document: Document): number | null {
  let max: number | null = null;
  for (const el of Array.from(document.querySelectorAll("[data-composition-id][data-duration]"))) {
    const value = Number.parseFloat(el.getAttribute("data-duration") || "");
    if (Number.isFinite(value) && value > 0) {
      max = max == null ? value : Math.max(max, value);
    }
  }
  return max;
}

function resolveClipWindowSeconds(img: Element, compositionDuration: number | null): number | null {
  const durationRaw = img.getAttribute("data-duration");
  if (durationRaw != null) {
    const duration = Number.parseFloat(durationRaw);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  if (compositionDuration != null) {
    const startRaw = Number.parseFloat(img.getAttribute("data-start") || "0");
    const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 0;
    const window = compositionDuration - start;
    return window > 0 ? window : null;
  }
  return null;
}

function resolvePreparedPlayback(
  metadata: AnimatedGifMetadata,
  loop: boolean,
  windowSeconds: number | null,
): { loopIterations: number; padSeconds: number } {
  const gifDuration = metadata.durationSeconds > 0 ? metadata.durationSeconds : null;

  let loopIterations = 1;
  if (loop) {
    loopIterations =
      windowSeconds != null && gifDuration != null
        ? Math.min(MAX_LOOP_ITERATIONS, Math.max(1, Math.ceil(windowSeconds / gifDuration)))
        : 1;
  } else if (metadata.loopCount != null && metadata.loopCount > 1) {
    loopIterations = Math.min(MAX_LOOP_ITERATIONS, metadata.loopCount);
  }

  let padSeconds = 0;
  if (windowSeconds != null && gifDuration != null) {
    const covered = gifDuration * loopIterations;
    if (windowSeconds > covered) {
      padSeconds = Math.min(windowSeconds - covered, MAX_PAD_SECONDS);
    }
  }

  return { loopIterations, padSeconds: Math.round(padSeconds * 1000) / 1000 };
}

export function buildAnimatedGifTranscodeArgs(input: {
  inputPath: string;
  outputPath: string;
  loopIterations: number;
  padSeconds?: number;
}): string[] {
  const args = ["-hide_banner", "-loglevel", "error"];
  if (input.loopIterations > 1) {
    args.push("-stream_loop", String(input.loopIterations - 1));
  }
  args.push(
    "-ignore_loop",
    "1",
    "-i",
    input.inputPath,
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-deadline",
    "good",
    "-crf",
    "18",
    "-b:v",
    "0",
    ...(input.padSeconds && input.padSeconds > 0
      ? ["-vf", `tpad=stop_mode=clone:stop_duration=${input.padSeconds}`]
      : []),
    // Explicit muxer: the transcode writes to a `.tmp-<pid>-<ts>` path whose
    // extension ffmpeg cannot infer the container from.
    "-f",
    "webm",
    "-y",
    input.outputPath,
  );
  return args;
}

async function runAnimatedGifTranscode(request: AnimatedGifTranscodeRequest): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn("ffmpeg", request.args);
    let stderr = "";
    const timeout = request.timeoutMs ?? 300_000;
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Animated GIF transcode timed out after ${timeout}ms`));
    }, timeout);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`Animated GIF transcode failed (${code}): ${stderr.slice(-500)}`));
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function ensurePreparedWebm(input: {
  sourcePath: string;
  cachePath: string;
  outputPath: string;
  loopIterations: number;
  padSeconds: number;
  timeoutMs?: number;
  transcode?: (request: AnimatedGifTranscodeRequest) => Promise<void>;
}): Promise<void> {
  if (!existsSync(dirname(input.cachePath))) {
    mkdirSync(dirname(input.cachePath), { recursive: true });
  }
  if (!existsSync(dirname(input.outputPath))) {
    mkdirSync(dirname(input.outputPath), { recursive: true });
  }

  if (!isUsableFile(input.cachePath)) {
    const tmpPath = `${input.cachePath}.tmp-${process.pid}-${Date.now()}`;
    const args = buildAnimatedGifTranscodeArgs({
      inputPath: input.sourcePath,
      outputPath: tmpPath,
      loopIterations: input.loopIterations,
      padSeconds: input.padSeconds,
    });
    const transcode = input.transcode ?? runAnimatedGifTranscode;
    try {
      await transcode({
        inputPath: input.sourcePath,
        outputPath: tmpPath,
        args,
        timeoutMs: input.timeoutMs,
      });
      if (!isUsableFile(tmpPath)) {
        throw new Error("Animated GIF transcode produced an empty output");
      }
      if (!isUsableFile(input.cachePath)) {
        renameSync(tmpPath, input.cachePath);
      } else {
        rmSync(tmpPath, { force: true });
      }
    } catch (error) {
      rmSync(tmpPath, { force: true });
      throw error;
    }
  }

  if (resolve(input.outputPath) !== resolve(input.cachePath) && !isUsableFile(input.outputPath)) {
    copyFileSync(input.cachePath, input.outputPath);
  }
}

function ensureElementId(el: Element, document: Document, fallbackIndex: number): string {
  const existing = (el.getAttribute("id") || "").trim();
  if (existing) return existing;
  let next = fallbackIndex;
  while (document.getElementById(`hf-gif-${next}`)) next += 1;
  const id = `hf-gif-${next}`;
  el.setAttribute("id", id);
  return id;
}

function ensureTimingAttributes(video: Element): void {
  if (!video.hasAttribute("data-start")) {
    video.setAttribute("data-start", "0");
  }
  if (!video.hasAttribute("data-end")) {
    const durationRaw = video.getAttribute("data-duration");
    if (durationRaw != null) {
      const start = Number.parseFloat(video.getAttribute("data-start") || "0");
      const duration = Number.parseFloat(durationRaw);
      if (Number.isFinite(start) && Number.isFinite(duration) && duration > 0) {
        video.setAttribute("data-end", String(start + duration));
      }
    }
  }
}

function replaceImageWithVideo(input: {
  img: Element;
  id: string;
  outputSrc: string;
  loop: boolean;
}): Element {
  const document = input.img.ownerDocument;
  const video = document.createElement("video");
  for (const attr of Array.from(input.img.attributes)) {
    if (attr.name === "src") continue;
    video.setAttribute(attr.name, attr.value);
  }
  video.setAttribute("id", input.id);
  video.setAttribute("src", input.outputSrc);
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("preload", "auto");
  video.setAttribute("data-has-audio", "false");
  video.setAttribute("data-hf-prepared-gif", "true");
  if (input.loop) {
    video.setAttribute("loop", "");
  } else {
    video.removeAttribute("loop");
  }
  ensureTimingAttributes(video);
  input.img.replaceWith(video);
  return video;
}

export async function prepareAnimatedGifInputs(
  html: string,
  options: PrepareAnimatedGifInputsOptions,
): Promise<PrepareAnimatedGifInputsResult> {
  const outputDir = options.outputDir ?? join(options.downloadDir, PREPARED_GIF_SUBDIR);
  const outputSrcPrefix = normalizeRelPath(options.outputSrcPrefix ?? PREPARED_GIF_SUBDIR);
  const cacheDir = options.cacheDir ?? outputDir;
  const { document } = parseHTML(html);
  const preparedAssets = new Map<string, string>();
  const preparedGifs: PreparedAnimatedGif[] = [];
  const images = Array.from(document.querySelectorAll("img[src]"));
  const compositionDuration = resolveCompositionDurationSeconds(document);

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const src = (img.getAttribute("src") || "").trim();
    if (!hasGifExtension(src)) continue;
    const sourcePath = resolveGifSourcePath(src, options);
    if (!sourcePath) continue;

    const bytes = readFileSync(sourcePath);
    const metadata = parseAnimatedGifMetadata(bytes);
    if (!metadata?.animated) continue;

    const loop = resolveLoop(metadata, readLoopOverride(img));
    const windowSeconds = resolveClipWindowSeconds(img, compositionDuration);
    const { loopIterations, padSeconds } = resolvePreparedPlayback(metadata, loop, windowSeconds);
    const hash = computePreparedGifHash(bytes, loopIterations, padSeconds);
    const filename = `${CACHE_SCHEMA}-${hash.slice(0, 24)}.webm`;
    const cachePath = join(cacheDir, filename);
    const outputPath = join(outputDir, filename);
    const outputSrc = `${outputSrcPrefix}/${filename}`;

    await ensurePreparedWebm({
      sourcePath,
      cachePath,
      outputPath,
      loopIterations,
      padSeconds,
      timeoutMs: options.timeoutMs,
      transcode: options.transcode,
    });

    const id = ensureElementId(img, document, i);
    replaceImageWithVideo({ img, id, outputSrc, loop });
    preparedAssets.set(outputSrc, outputPath);
    preparedGifs.push({
      id,
      sourceSrc: src,
      outputSrc,
      outputPath,
      metadata,
      loop,
      loopIterations,
      padSeconds,
    });
  }

  return {
    html: preparedGifs.length > 0 ? document.toString() : html,
    preparedAssets,
    preparedGifs,
  };
}
