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

function readStudioFileChangePathFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        return readStudioFileChangePathFromValue(JSON.parse(trimmed) as unknown);
      } catch {
        return normalizeStudioFileChangePath(trimmed);
      }
    }
    return normalizeStudioFileChangePath(trimmed);
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string") return normalizeStudioFileChangePath(record.path);
  if (typeof record.filePath === "string") return normalizeStudioFileChangePath(record.filePath);
  if ("data" in record) return readStudioFileChangePathFromValue(record.data);
  return null;
}

export function readStudioFileChangePath(payload: unknown): string | null {
  return readStudioFileChangePathFromValue(payload);
}
