import type { Hono } from "hono";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { StudioApiAdapter } from "../types.js";
import { STUDIO_MANUAL_EDITS_PATH } from "../helpers/manualEditsRenderScript.js";
import { compositionInputSignature } from "../helpers/compositionInputs.js";
import { createProjectSignature, resolveProjectAndSignature } from "../helpers/projectSignature.js";
import { STUDIO_MOTION_PATH } from "../helpers/studioMotionRenderScript.js";
import { thumbnailGenerationCoordinator } from "./thumbnailGenerationCoordinator.js";
import { requestSubPath } from "../helpers/requestSubPath.js";
import { resolveWithinProject } from "../helpers/safePath.js";

const THUMBNAIL_CACHE_VERSION = "v4";
const THUMBNAIL_MAX_OUTPUT_WIDTH = 240;
const THUMBNAIL_MAX_OUTPUT_HEIGHT = 135;
const THUMBNAIL_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const THUMBNAIL_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const prunedCacheDirs = new Set<string>();

export function pruneThumbnailCache(
  cacheDir: string,
  protectedPaths: ReadonlySet<string>,
  now = Date.now(),
): void {
  if (!existsSync(cacheDir)) return;
  const files = readdirSync(cacheDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const path = join(cacheDir, entry.name);
    try {
      const stats = statSync(path);
      return [{ path, bytes: stats.size, mtimeMs: stats.mtimeMs }];
    } catch {
      return [];
    }
  });
  const retained = [];
  for (const file of files) {
    if (!protectedPaths.has(file.path) && now - file.mtimeMs > THUMBNAIL_CACHE_MAX_AGE_MS) {
      rmSync(file.path, { force: true });
    } else {
      retained.push(file);
    }
  }

  let bytes = retained.reduce((total, file) => total + file.bytes, 0);
  for (const file of retained.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (bytes <= THUMBNAIL_CACHE_MAX_BYTES) break;
    if (protectedPaths.has(file.path)) continue;
    try {
      unlinkSync(file.path);
      bytes -= file.bytes;
    } catch {
      // Another request may have pruned the same file.
    }
  }
}

function writeThumbnailAtomically(path: string, buffer: Buffer): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, buffer, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

type FileRead = { data: Buffer; mtimeMs: number } | "missing" | "not-a-file";

// One open for the stat and the read, so the file cannot change between the check and the use.
function readFileOnce(file: string): FileRead {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw err;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return "not-a-file";
    return { data: readFileSync(fd), mtimeMs: stat.mtimeMs };
  } finally {
    closeSync(fd);
  }
}

// A manifest that is gone or not a file adds nothing to the key, as preview and render read it.
function manifestKey(file: string): { key: string; mtimeMs: number } {
  const manifest = readFileOnce(file);
  if (typeof manifest === "string") return { key: "", mtimeMs: 0 };
  const hash = createHash("sha1").update(manifest.data).digest("hex").slice(0, 16);
  return { key: `_${hash}`, mtimeMs: Math.round(manifest.mtimeMs) };
}

export function registerThumbnailRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/thumbnail/*", async (c) => {
    if (!adapter.generateThumbnail) {
      return c.json({ error: "Thumbnails not available" }, 501);
    }
    const resolved = await resolveProjectAndSignature(adapter, c.req.param("id"));
    if (!resolved) return c.json({ error: "not found" }, 404);
    const { project, signature: projectSignature } = resolved;

    let compPath = requestSubPath(c.req.url, "projects/:id/thumbnail");
    if (compPath && !compPath.includes(".")) compPath += ".html";
    const htmlFile = resolveWithinProject(project.dir, compPath);
    const source = htmlFile ? readFileOnce(htmlFile) : "not-a-file";
    if (source === "not-a-file") return c.json({ error: "not found" }, 404);
    // Keyed on what this composition renders from, so editing one scene leaves the others cached.
    const inputSignature = compositionInputSignature(project.dir, compPath, projectSignature);

    const url = new URL(c.req.url, `http://${c.req.header("host") || "localhost"}`);
    const rawSeekTime = url.searchParams.get("t");
    const parsedSeekTime = rawSeekTime == null ? Number.NaN : parseFloat(rawSeekTime);
    const seekTime = Number.isFinite(parsedSeekTime) ? parsedSeekTime : 0.5;
    const vpWidth = parseInt(url.searchParams.get("w") || "0") || 0;
    const vpHeight = parseInt(url.searchParams.get("h") || "0") || 0;
    const selector = url.searchParams.get("selector") || undefined;
    const format = url.searchParams.get("format") === "png" ? "png" : "jpeg";
    const contentType = format === "png" ? "image/png" : "image/jpeg";
    const requestedOutput = url.searchParams.get("output");
    // PNG is the legacy source-density capture contract. Callers can opt either
    // format into the bounded preview contract explicitly.
    const outputMode =
      requestedOutput === "source" || (requestedOutput !== "preview" && format === "png")
        ? "source"
        : "preview";
    const rawSelectorIndex = Number.parseInt(url.searchParams.get("selectorIndex") || "0", 10);
    const selectorIndex =
      Number.isFinite(rawSelectorIndex) && rawSelectorIndex > 0 ? rawSelectorIndex : undefined;
    const urlVersion = url.searchParams.get("v") || "";

    // Determine composition dimensions from HTML
    let compW = vpWidth || 1920;
    let compH = vpHeight || 1080;
    let sourceMtime = 0;
    // Content-hash the composition HTML into the cache key — ALWAYS, even when
    // explicit w/h are supplied. The old code only read the file when `!vpWidth`,
    // so Studio thumbnail requests (which pass dimensions) kept the source out of
    // the key entirely (sourceMtime=0) and served a stale thumbnail after every
    // edit, even on a hard reload. Keyed on content (like manualEdits/motion), not
    // just mtime, so a restore/copy with a preserved mtime can't serve stale.
    let sourceKey = "";
    if (source !== "missing") {
      const html = source.data.toString("utf-8");
      sourceKey = `_${createHash("sha1").update(html).digest("hex").slice(0, 16)}`;
      sourceMtime = Math.round(source.mtimeMs);
      if (!vpWidth) {
        const wMatch = html.match(/data-width=["'](\d+)["']/);
        const hMatch = html.match(/data-height=["'](\d+)["']/);
        if (wMatch?.[1]) compW = parseInt(wMatch[1]);
        if (hMatch?.[1]) compH = parseInt(hMatch[1]);
      }
    }
    const manualEdits = manifestKey(join(project.dir, STUDIO_MANUAL_EDITS_PATH));
    const motion = manifestKey(join(project.dir, STUDIO_MOTION_PATH));
    sourceMtime = Math.max(sourceMtime, manualEdits.mtimeMs, motion.mtimeMs);

    const projectUrl = `http://${c.req.header("host")}/api/projects/${encodeURIComponent(project.id)}`;
    const previewUrl =
      compPath === "index.html"
        ? `${projectUrl}/preview`
        : `${projectUrl}/preview/comp/${compPath.split("/").map(encodeURIComponent).join("/")}`;

    // Cache
    const cacheDir = join(project.dir, ".thumbnails");
    const selectorKey = selector
      ? `_${selector.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80)}_${selectorIndex ?? 0}`
      : "";
    const urlVersionKey = urlVersion
      ? `_${urlVersion.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 32)}`
      : "";
    const inputSignatureKey = `_${createHash("sha1").update(inputSignature).digest("hex").slice(0, 16)}`;
    const outputScale =
      outputMode === "source"
        ? 1
        : Math.min(1, THUMBNAIL_MAX_OUTPUT_WIDTH / compW, THUMBNAIL_MAX_OUTPUT_HEIGHT / compH);
    const outputWidth = Math.max(1, Math.round(compW * outputScale));
    const outputHeight = Math.max(1, Math.round(compH * outputScale));
    const cacheKey = `${THUMBNAIL_CACHE_VERSION}${urlVersionKey}${inputSignatureKey}${manualEdits.key}${motion.key}${sourceKey}_${format}_${outputMode}_${compPath.replace(/\//g, "_")}_${compW}x${compH}_${outputWidth}x${outputHeight}_${sourceMtime}_${seekTime.toFixed(2)}${selectorKey}.${format === "png" ? "png" : "jpg"}`;
    const cachePath = join(cacheDir, cacheKey);
    if (!prunedCacheDirs.has(cacheDir)) {
      prunedCacheDirs.add(cacheDir);
      pruneThumbnailCache(
        cacheDir,
        new Set([...thumbnailGenerationCoordinator.protectedKeys(), cachePath]),
      );
    }
    const cached = readFileOnce(cachePath);
    if (typeof cached === "object") {
      return new Response(new Uint8Array(cached.data), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
      });
    }

    try {
      const buffer = await thumbnailGenerationCoordinator.acquire(
        cachePath,
        c.req.raw.signal,
        async (signal) => {
          const generated = await adapter.generateThumbnail!({
            project,
            compPath,
            seekTime,
            width: compW,
            height: compH,
            outputWidth,
            outputHeight,
            previewUrl,
            selector,
            format,
            selectorIndex,
            signal,
          });
          if (!generated) return null;
          const afterGeneration = await resolveProjectAndSignature(adapter, project.id);
          const inputsUnchanged = (signature: string) =>
            compositionInputSignature(project.dir, compPath, signature) === inputSignature;
          // Both the adapter's signature and a fresh one: the adapter's can lag the watcher.
          if (
            afterGeneration?.project.dir !== project.dir ||
            !inputsUnchanged(afterGeneration.signature) ||
            !inputsUnchanged(createProjectSignature(project.dir))
          ) {
            // The browser may have rendered content written after this request
            // captured its cache identity. Return the pixels to this caller,
            // but never file them under a signature they do not prove.
            return generated;
          }
          if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
          writeThumbnailAtomically(cachePath, generated);
          return generated;
        },
      );
      if (!buffer) {
        return c.json(
          { error: "Thumbnail generation failed — Chrome browser may not be available" },
          500,
        );
      }
      pruneThumbnailCache(cacheDir, thumbnailGenerationCoordinator.protectedKeys());
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return new Response(null, { status: 499 });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Thumbnail generation failed: ${msg}` }, 500);
    }
  });
}
