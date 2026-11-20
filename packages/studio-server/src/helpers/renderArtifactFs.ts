import { lstatSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readRenderDirectoryStats, type RenderDirectoryStats } from "./renderDirectoryStats.js";

/** Named by job id, not by swapping the output's extension: a directory output has none. */
export function renderMetadataPath(outputPath: string, jobId: string): string {
  return join(dirname(outputPath), `${jobId}.meta.json`);
}

export function renderDirectoryMetadata(
  outputPath: string,
  kind?: "file" | "directory",
): Partial<RenderDirectoryStats> & { kind?: "directory"; outputName?: string } {
  if (kind === "file") return {};
  const identity = { kind: "directory" as const, outputName: basename(outputPath) };
  try {
    return lstatSync(outputPath).isDirectory()
      ? { ...identity, ...readRenderDirectoryStats(outputPath) }
      : {};
  } catch {
    return kind === "directory" ? identity : {};
  }
}

export function removeRenderArtifacts(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      if (lstatSync(path).isDirectory()) {
        rmSync(path, { recursive: true, force: true });
      } else {
        unlinkSync(path);
      }
    } catch {
      continue;
    }
  }
}
