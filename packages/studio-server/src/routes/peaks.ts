import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { isWaveformCacheDirectory, writeWaveformCache } from "../helpers/waveform.js";
import { buildPeakMapCacheKey, decodePeakMap, PEAK_BIN_SECONDS } from "../helpers/peakMap.js";
import { requestSubPath } from "../helpers/requestSubPath.js";

type DecodePeaks = (mediaPath: string) => Promise<number[]>;

function readCachedBins(cacheDir: string, cachePath: string): number[] | null {
  try {
    if (!isWaveformCacheDirectory(cacheDir) || !existsSync(cachePath)) return null;
    const parsed: unknown = JSON.parse(readFileSync(cachePath, "utf-8"));
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? parsed : null;
  } catch {
    return null;
  }
}

/** Absolute per-bin sample peaks for one media file, so the timeline can mark where a clip redlines. */
export function registerPeakRoutes(
  api: Hono,
  adapter: StudioApiAdapter,
  decode: DecodePeaks = decodePeakMap,
): void {
  api.get("/projects/:id/peaks/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const assetPath = requestSubPath(c.req.url, "projects/:id/peaks");
    const mediaPath = resolve(project.dir, assetPath);
    if (!isWithinProjectRoot(project.dir, mediaPath))
      return c.json({ error: "file not found" }, 404);
    const stats = statSync(mediaPath, { throwIfNoEntry: false });
    if (!stats?.isFile()) return c.json({ error: "file not found" }, 404);

    const cacheDir = join(project.dir, ".waveform-cache");
    const cachePath = join(cacheDir, buildPeakMapCacheKey(assetPath, stats));
    const cached = readCachedBins(cacheDir, cachePath);
    if (cached) return c.json({ binSeconds: PEAK_BIN_SECONDS, bins: cached });

    let bins: number[];
    try {
      bins = await decode(mediaPath);
    } catch {
      return c.json({ error: "failed to decode audio" }, 500);
    }
    try {
      writeWaveformCache(cachePath, bins);
    } catch {
      // A cache that cannot be written only costs the next request a decode.
    }
    return c.json({ binSeconds: PEAK_BIN_SECONDS, bins });
  });
}
