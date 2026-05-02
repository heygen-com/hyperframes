import type { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";

const THUMBNAIL_CACHE_VERSION = "v3";

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

    // Determine composition dimensions from HTML
    let compW = vpWidth || 1920;
    let compH = vpHeight || 1080;
    if (!vpWidth) {
      const htmlFile = join(project.dir, compPath);
      if (existsSync(htmlFile)) {
        const html = readFileSync(htmlFile, "utf-8");
        const wMatch = html.match(/data-width=["'](\d+)["']/);
        const hMatch = html.match(/data-height=["'](\d+)["']/);
        if (wMatch?.[1]) compW = parseInt(wMatch[1]);
        if (hMatch?.[1]) compH = parseInt(hMatch[1]);
      }
    }

    const previewUrl =
      compPath === "index.html"
        ? `http://${c.req.header("host")}/api/projects/${project.id}/preview`
        : `http://${c.req.header("host")}/api/projects/${project.id}/preview/comp/${compPath}`;

    // Cache
    const cacheDir = join(project.dir, ".thumbnails");
    const selectorKey = selector
      ? `_${selector.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80)}`
      : "";
    const cacheKey = `${THUMBNAIL_CACHE_VERSION}_${format}_${compPath.replace(/\//g, "_")}_${seekTime.toFixed(2)}${selectorKey}.${format === "png" ? "png" : "jpg"}`;
    const cachePath = join(cacheDir, cacheKey);
    if (existsSync(cachePath)) {
      return new Response(new Uint8Array(readFileSync(cachePath)), {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=60" },
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
      });
      if (!buffer) {
        return c.json({ error: "Thumbnail generation returned null" }, 500);
      }
      if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, buffer);
      return new Response(new Uint8Array(buffer), {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=60" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Thumbnail generation failed: ${msg}` }, 500);
    }
  });
}
