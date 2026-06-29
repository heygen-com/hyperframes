import type { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { StudioApiAdapter } from "../types.js";
import { STUDIO_MANUAL_EDITS_PATH } from "../helpers/manualEditsRenderScript.js";
import { STUDIO_MOTION_PATH } from "../helpers/studioMotionRenderScript.js";

const THUMBNAIL_CACHE_VERSION = "v4";

export function registerThumbnailRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/thumbnail/*", async (c) => {
    if (!adapter.generateThumbnail) {
      return c.json({ error: "Thumbnails not available" }, 501);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let compPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/thumbnail/`, "").split("?")[0] ?? "",
    );
    if (compPath && !compPath.includes(".")) compPath += ".html";

    const url = new URL(c.req.url, `http://${c.req.header("host") || "localhost"}`);
    const rawSeekTime = url.searchParams.get("t");
    const parsedSeekTime = rawSeekTime == null ? Number.NaN : parseFloat(rawSeekTime);
    const seekTime = Number.isFinite(parsedSeekTime) ? parsedSeekTime : 0.5;
    const vpWidth = parseInt(url.searchParams.get("w") || "0") || 0;
    const vpHeight = parseInt(url.searchParams.get("h") || "0") || 0;
    const selector = url.searchParams.get("selector") || undefined;
    const format = url.searchParams.get("format") === "png" ? "png" : "jpeg";
    const contentType = format === "png" ? "image/png" : "image/jpeg";
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
    const htmlFile = join(project.dir, compPath);
    if (existsSync(htmlFile)) {
      const html = readFileSync(htmlFile, "utf-8");
      sourceKey = `_${createHash("sha1").update(html).digest("hex").slice(0, 16)}`;
      sourceMtime = Math.round(statSync(htmlFile).mtimeMs);
      if (!vpWidth) {
        const wMatch = html.match(/data-width=["'](\d+)["']/);
        const hMatch = html.match(/data-height=["'](\d+)["']/);
        if (wMatch?.[1]) compW = parseInt(wMatch[1]);
        if (hMatch?.[1]) compH = parseInt(hMatch[1]);
      }
    }
    const manualEditsFile = join(project.dir, STUDIO_MANUAL_EDITS_PATH);
    let manualEditsKey = "";
    if (existsSync(manualEditsFile)) {
      const manualEditsContent = readFileSync(manualEditsFile, "utf-8");
      manualEditsKey = `_${createHash("sha1").update(manualEditsContent).digest("hex").slice(0, 16)}`;
      sourceMtime = Math.max(sourceMtime, Math.round(statSync(manualEditsFile).mtimeMs));
    }
    const motionFile = join(project.dir, STUDIO_MOTION_PATH);
    let motionKey = "";
    if (existsSync(motionFile)) {
      const motionContent = readFileSync(motionFile, "utf-8");
      motionKey = `_${createHash("sha1").update(motionContent).digest("hex").slice(0, 16)}`;
      sourceMtime = Math.max(sourceMtime, Math.round(statSync(motionFile).mtimeMs));
    }

    const previewUrl =
      compPath === "index.html"
        ? `http://${c.req.header("host")}/api/projects/${project.id}/preview`
        : `http://${c.req.header("host")}/api/projects/${project.id}/preview/comp/${compPath}`;

    // Cache
    const cacheDir = join(project.dir, ".thumbnails");
    const selectorKey = selector
      ? `_${selector.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80)}_${selectorIndex ?? 0}`
      : "";
    const urlVersionKey = urlVersion
      ? `_${urlVersion.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 32)}`
      : "";
    const cacheKey = `${THUMBNAIL_CACHE_VERSION}${urlVersionKey}${manualEditsKey}${motionKey}${sourceKey}_${format}_${compPath.replace(/\//g, "_")}_${compW}x${compH}_${sourceMtime}_${seekTime.toFixed(2)}${selectorKey}.${format === "png" ? "png" : "jpg"}`;
    const cachePath = join(cacheDir, cacheKey);
    if (existsSync(cachePath)) {
      return new Response(new Uint8Array(readFileSync(cachePath)), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
      });
    }

    try {
      const buffer = await adapter.generateThumbnail({
        project,
        compPath,
        seekTime,
        width: compW,
        height: compH,
        previewUrl,
        selector,
        format,
        selectorIndex,
      });
      if (!buffer) {
        return c.json(
          { error: "Thumbnail generation failed — Chrome browser may not be available" },
          500,
        );
      }
      if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, buffer);
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Thumbnail generation failed: ${msg}` }, 500);
    }
  });
}
