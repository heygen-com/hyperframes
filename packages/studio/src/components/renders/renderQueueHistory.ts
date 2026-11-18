import type { RenderJob } from "./useRenderQueue";

const hiddenIdsKey = (projectId: string) => `hf-studio-hidden-renders:${projectId}`;

export function renderQueueFamilyKey(row?: { filename: string; kind?: unknown }): string | null {
  if (!row) return null;
  if (row.kind === "directory") return JSON.stringify(["directory", row.filename]);
  const extension = /\.(mp4|webm|mov|gif)$/;
  return extension.test(row.filename)
    ? JSON.stringify(["file", row.filename.replace(extension, "")])
    : null;
}

function removedFamily(
  row: { filename: string; kind?: unknown },
  families: ReadonlySet<string>,
): boolean {
  const key = renderQueueFamilyKey(row);
  return key !== null && families.has(key);
}

export function removeDeletedRenderFamily(
  jobs: RenderJob[],
  id: string,
  family: string | null,
  removed: Set<string>,
): RenderJob[] {
  return jobs.filter((job) => {
    if (job.id !== id && (!family || renderQueueFamilyKey(job) !== family)) return true;
    removed.add(job.id);
    return false;
  });
}

export function readHiddenIds(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(hiddenIdsKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenIds(projectId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(hiddenIdsKey(projectId), JSON.stringify([...ids].slice(-200)));
  } catch {
    return;
  }
}

export function cancelledRenderOutcome(body: unknown): "complete" | "failed" | null {
  if (!body || typeof body !== "object" || !("status" in body)) return null;
  return body.status === "complete" || body.status === "failed" ? body.status : null;
}

export function upsertSessionRender(
  previous: RenderJob[],
  job: RenderJob,
  hidden: ReadonlySet<string>,
  removedFamilies: ReadonlySet<string>,
): RenderJob[] {
  if (hidden.has(job.id) || removedFamily(job, removedFamilies)) return previous;
  const jobs = new Map(previous.map((entry) => [entry.id, entry]));
  jobs.set(job.id, { ...job, ...jobs.get(job.id), createdAt: job.createdAt });
  return [...jobs.values()];
}

interface HistoryRow {
  id: string;
  filename: string;
  createdAt: number;
  status?: unknown;
  durationMs?: unknown;
  kind?: unknown;
  frameCount?: unknown;
  size?: unknown;
  audioSidecar?: unknown;
}

function isHistoryRow(value: unknown): value is HistoryRow {
  if (!value || typeof value !== "object") return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "number"
  );
}

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function mergeRenderHistory(
  previous: RenderJob[],
  rows: unknown[],
  hidden: ReadonlySet<string>,
  removedFamilies: ReadonlySet<string>,
  onlyId?: string,
): RenderJob[] {
  const jobs = new Map(previous.map((job) => [job.id, job]));
  for (const row of rows) {
    if (
      !isHistoryRow(row) ||
      hidden.has(row.id) ||
      removedFamily(row, removedFamilies) ||
      (onlyId && row.id !== onlyId)
    )
      continue;
    const existing = jobs.get(row.id);
    if (onlyId && !existing) continue;
    const metadata = historyMetadata(row, existing);
    jobs.set(
      row.id,
      existing
        ? { ...existing, ...metadata }
        : {
            id: row.id,
            createdAt: row.createdAt,
            status: row.status === "failed" ? "failed" : "complete",
            progress: 100,
            ...metadata,
          },
    );
  }
  return [...jobs.values()].filter(
    (job) => !hidden.has(job.id) && !removedFamily(job, removedFamilies),
  );
}

function historyMetadata(row: HistoryRow, existing?: RenderJob) {
  return {
    filename: row.filename,
    ...(typeof row.durationMs === "number" && existing?.durationMs === undefined
      ? { durationMs: row.durationMs }
      : {}),
    ...(row.kind === "directory"
      ? {
          kind: "directory" as const,
          ...(count(row.frameCount) !== undefined ? { frameCount: count(row.frameCount) } : {}),
          ...(count(row.size) !== undefined ? { size: count(row.size) } : {}),
          ...(typeof row.audioSidecar === "boolean" ? { audioSidecar: row.audioSidecar } : {}),
        }
      : {}),
  };
}
