import { lstatSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRenderDirectoryStats, type RenderDirectoryStats } from "./renderDirectoryStats.js";

/**
 * The metadata sidecar sits beside the output and is named by job id. Deriving
 * it by swapping the output's extension breaks for extensionless directory
 * outputs, where it would land inside the frames directory.
 */
export function renderMetadataPath(outputPath: string, jobId: string): string {
  return join(dirname(outputPath), `${jobId}.meta.json`);
}

/** Directory facts cached in the sidecar so listing can skip a scan; empty for file outputs. */
export function renderDirectoryMetadata(outputPath: string): Partial<RenderDirectoryStats> {
  try {
    return lstatSync(outputPath).isDirectory() ? readRenderDirectoryStats(outputPath) : {};
  } catch {
    return {};
  }
}

/** Best-effort cleanup after a cancelled render. Never follows symlinks. */
export function removeRenderArtifacts(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      if (lstatSync(path).isDirectory()) {
        rmSync(path, { recursive: true, force: true });
      } else {
        unlinkSync(path);
      }
    } catch {
      // Missing or locked paths are fine; keep going so the sidecar is still tried.
    }
  }
}
