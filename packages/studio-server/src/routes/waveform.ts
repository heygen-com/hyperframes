import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import {
  decodeAudioPeaks,
  buildWaveformCacheKey,
  writeWaveformCache,
  isWaveformCacheDirectory,
} from "../helpers/waveform.js";

export function registerWaveformRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/waveform/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const assetPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/waveform/`, "").split("?")[0] ?? "",
    );
    const audioPath = join(project.dir, assetPath);
    const stats = statSync(audioPath, { throwIfNoEntry: false });
    if (!stats) return c.json({ error: "file not found" }, 404);

    const cacheDir = join(project.dir, ".waveform-cache");
    // Keyed on the file's size and mtime as well as its name, so re-encoding an
    // asset in place invalidates its peaks instead of drawing the old ones.
    const cachePath = join(cacheDir, buildWaveformCacheKey(assetPath, stats));

    try {
      if (isWaveformCacheDirectory(cacheDir) && existsSync(cachePath)) {
        const peaks = JSON.parse(readFileSync(cachePath, "utf-8")) as number[];
        return c.json({ peaks });
      }
    } catch {
      // corrupt or inaccessible cache — regenerate
    }

    let peaks: number[];
    try {
      peaks = await decodeAudioPeaks(audioPath);
    } catch {
      return c.json({ error: "failed to decode audio" }, 500);
    }

    try {
      writeWaveformCache(cachePath, peaks);
    } catch {
      // cache write failure is non-fatal
    }

    return c.json({ peaks });
  });
}
