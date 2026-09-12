/* ── Helpers ──────────────────────────────────────────────────────── */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function roundRotationAngle(angle: number): number {
  return Math.round(angle * 10) / 10;
}

/* ── File path utilities ──────────────────────────────────────────── */
function normalizeStudioFileChangePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

/**
 * Read one string field out of an ALREADY-DECODED file-change payload. Every
 * reader of that payload goes through here, so no reader can disagree with its
 * siblings about the shape. Decoding a raw delivery is the transport's job.
 */
export function readFileChangeField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function readStudioFileChangePath(payload: unknown): string | null {
  const path = readFileChangeField(payload, "path") ?? readFileChangeField(payload, "filePath");
  return path === null ? null : normalizeStudioFileChangePath(path);
}
