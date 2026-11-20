import { lstatSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { readRenderDirectoryStats, type RenderDirectoryStats } from "./renderDirectoryStats.js";
import { isLinkFreeWithinProject, resolveWithinProject } from "./safePath.js";

export const RENDER_FILE_EXTENSIONS = [".mp4", ".webm", ".mov", ".gif"] as const;
export const RENDER_FILE_PATTERN = /\.(mp4|webm|mov|gif)$/;
export type RenderArtifactKind = "file" | "directory";

interface RenderMeta {
  status?: unknown;
  durationMs?: unknown;
  audioLoweredDb?: unknown;
  kind?: unknown;
  outputName?: unknown;
  frameCount?: unknown;
  size?: unknown;
  audioSidecar?: unknown;
}

function readRenderMeta(root: string, stem: string): RenderMeta | null {
  const path = join(root, `${stem}.meta.json`);
  try {
    if (!lstatSync(path).isFile()) return null;
    const meta: unknown = JSON.parse(readFileSync(path, "utf8"));
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

export function directoryRenderFacts(
  root: string,
  name: string,
  meta = readRenderMeta(root, name),
): RenderDirectoryStats | null {
  const path = join(root, name);
  if (!isLinkFreeWithinProject(root, path)) return null;
  try {
    if (!lstatSync(path).isDirectory()) return null;
    const explicit = meta?.kind === "directory" && meta.outputName === name;
    const scanned = explicit ? null : readRenderDirectoryStats(path);
    if (!explicit && !scanned?.frameCount) return null;
    if (
      typeof meta?.frameCount === "number" &&
      Number.isSafeInteger(meta.frameCount) &&
      meta.frameCount >= 0 &&
      typeof meta.size === "number" &&
      Number.isSafeInteger(meta.size) &&
      meta.size >= 0
    )
      return {
        frameCount: meta.frameCount,
        size: meta.size,
        audioSidecar: meta.audioSidecar === true,
      };
    return scanned ?? readRenderDirectoryStats(path);
  } catch {
    return null;
  }
}

export type RenderListingRow = {
  id: string;
  filename: string;
  path: string;
  root: string;
  size: number;
  createdAt: number;
  status: "complete" | "failed";
  durationMs?: number;
  audioLoweredDb?: number;
} & ({ kind?: undefined } | { kind: "directory"; frameCount: number; audioSidecar: boolean });

export function readRenderHistory(root: string): RenderListingRow[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const row = readHistoryEntry(root, entry);
    return row ? [row] : [];
  });
}

function readHistoryEntry(root: string, entry: Dirent): RenderListingRow | null {
  if (!isHistoryCandidate(entry)) return null;
  const directory = entry.isDirectory();
  const path = resolveWithinProject(root, entry.name);
  if (!path || !isLinkFreeWithinProject(root, path)) return null;
  const id = directory ? entry.name : entry.name.replace(RENDER_FILE_PATTERN, "");
  const meta = readRenderMeta(root, id);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  const base = {
    id,
    filename: entry.name,
    path,
    root,
    createdAt: stat.mtimeMs,
    status: "complete" as const,
    ...historyMetadata(meta),
  };
  if (!directory) return { ...base, size: stat.size };
  const facts = directoryRenderFacts(root, entry.name, meta);
  return facts ? { ...base, kind: "directory", ...facts } : null;
}

function isHistoryCandidate(entry: Dirent): boolean {
  if (entry.name.startsWith(".")) return false;
  return entry.isDirectory() || (entry.isFile() && RENDER_FILE_PATTERN.test(entry.name));
}

function historyMetadata(meta: RenderMeta | null) {
  return {
    durationMs:
      typeof meta?.durationMs === "number" && meta.durationMs ? meta.durationMs : undefined,
    ...(typeof meta?.audioLoweredDb === "number" ? { audioLoweredDb: meta.audioLoweredDb } : {}),
  };
}
