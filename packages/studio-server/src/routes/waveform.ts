import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { decodeAudioPeaks, buildWaveformCacheKey } from "../helpers/waveform.js";

export function registerWaveformRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/waveform/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const assetPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/waveform/`, "").split("?")[0] ?? "",
    );
    const audioPath = join(project.dir, assetPath);
    if (!existsSync(audioPath)) return c.json({ error: "file not found" }, 404);

    const cacheDir = join(project.dir, ".waveform-cache");
    const cachePath = join(cacheDir, buildWaveformCacheKey(assetPath));

    if (existsSync(cachePath)) {
      try {
        const peaks = JSON.parse(readFileSync(cachePath, "utf-8")) as number[];
        return c.json({ peaks });
      } catch {
        // corrupt cache — regenerate
      }
    }

    let peaks: number[];
    try {
      peaks = await decodeAudioPeaks(audioPath);
    } catch {
      return c.json({ error: "failed to decode audio" }, 500);
    }

    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, JSON.stringify(peaks));
    } catch {
      // cache write failure is non-fatal
    }

    return c.json({ peaks });
  });
}
