import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonlValues } from "./jsonl";
import type { FigmaManifestRecord } from "./types";

const MANIFEST_FILE = "manifest.jsonl";

// Mirrors the media-use `.media/` layout for interop (one shared inventory).
const TYPE_DIRS: Record<FigmaManifestRecord["type"], string> = {
  image: "images",
  video: "video",
};

export function mediaDir(projectDir: string): string {
  return join(projectDir, ".media");
}

export function manifestPath(projectDir: string): string {
  return join(mediaDir(projectDir), MANIFEST_FILE);
}

export function typeDirPath(projectDir: string, type: FigmaManifestRecord["type"]): string {
  return join(mediaDir(projectDir), TYPE_DIRS[type]);
}

/**
 * Guards figma-OWNED rows only — media-use rows (bgm/sfx/icon, no
 * provenance.source) legitimately fail this and are filtered out of
 * figma's read-view. The shared file is the inventory; each writer
 * reads its own rows. `nextId` is the one cross-writer concern and
 * scans the full file.
 */
export function isFigmaManifestRecord(value: unknown): value is FigmaManifestRecord {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("type" in value) || !("path" in value) || !("source" in value))
    return false;
  if (
    typeof value.id !== "string" ||
    (value.type !== "image" && value.type !== "video") ||
    typeof value.path !== "string"
  )
    return false;
  if (typeof value.source !== "string") return false;
  if (!("provenance" in value)) return false;

  const provenance = value.provenance;
  if (typeof provenance !== "object" || provenance === null) return false;
  if (!("source" in provenance) || !("fileKey" in provenance) || !("nodeId" in provenance))
    return false;
  return (
    provenance.source === "figma" &&
    typeof provenance.fileKey === "string" &&
    typeof provenance.nodeId === "string"
  );
}

export function readManifest(projectDir: string): FigmaManifestRecord[] {
  return readJsonlValues(manifestPath(projectDir)).filter(isFigmaManifestRecord);
}

export function appendRecord(projectDir: string, record: FigmaManifestRecord): void {
  mkdirSync(typeDirPath(projectDir, record.type), { recursive: true });
  appendFileSync(manifestPath(projectDir), JSON.stringify(record) + "\n");
}

export function findByFigmaNode(
  projectDir: string,
  fileKey: string,
  nodeId: string,
): FigmaManifestRecord | null {
  for (const r of readManifest(projectDir)) {
    if (
      r.provenance.source === "figma" &&
      r.provenance.fileKey === fileKey &&
      r.provenance.nodeId === nodeId
    )
      return r;
  }
  return null;
}

export function nextId(projectDir: string, type: FigmaManifestRecord["type"]): string {
  const re = new RegExp(`^${type}_(\\d+)$`);
  let max = 0;
  // Scan EVERY writer's rows (media-use included), not just figma-owned ones —
  // ids and file paths are shared across the inventory, so a figma id minted
  // from a figma-only view would collide with media-use's image_NNN files.
  const p = manifestPath(projectDir);
  if (!existsSync(p)) return `${type}_001`;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      typeof parsed.id !== "string"
    )
      continue;
    const m = parsed.id.match(re);
    const n = m?.[1];
    if (n !== undefined) max = Math.max(max, Number.parseInt(n, 10));
  }
  return `${type}_${String(max + 1).padStart(3, "0")}`;
}
