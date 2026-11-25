import { statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import {
  decodeAudioPeaks,
  buildWaveformCacheKey,
  readCachedPeaks,
  writeWaveformCache,
} from "../helpers/waveform.js";
import { requestSubPath } from "../helpers/requestSubPath.js";
import { decodeShared } from "../helpers/audioDecodes.js";
import { registerPcmRoutes } from "./pcm.js";

export function registerWaveformRoutes(api: Hono, adapter: StudioApiAdapter): void {
  registerPcmRoutes(api, adapter);
  api.get("/projects/:id/waveform/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const assetPath = requestSubPath(c.req.url, "projects/:id/waveform");
    if (assetPath === null) return c.json({ error: "file not found" }, 404);
    const audioPath = resolve(project.dir, assetPath);
    if (!isWithinProjectRoot(project.dir, audioPath)) {
      return c.json({ error: "file not found" }, 404);
    }
    const stats = statSync(audioPath, { throwIfNoEntry: false });
    if (!stats) return c.json({ error: "file not found" }, 404);

    const cacheDir = join(project.dir, ".waveform-cache");
    // Keyed on the file's size and mtime as well as its name, so re-encoding an
    // asset in place invalidates its peaks instead of drawing the old ones.
    const cachePath = join(
      cacheDir,
      buildWaveformCacheKey(relative(project.dir, audioPath), stats),
    );

    const cached = readCachedPeaks(project.dir, cachePath);
    if (cached) return c.json({ peaks: cached });

    let peaks: number[];
    try {
      peaks = await decodeShared(cachePath, audioPath, decodeAudioPeaks, c.req.raw.signal);
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
