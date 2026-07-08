import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  BaselineManifest,
  BaselineManifestEntry,
  BaselineStatus,
  RegistryItem,
} from "./types.ts";

export const MANIFEST_FILENAME = "index.json";

export function manifestPathForBaselineDir(baselineDir: string): string {
  return join(baselineDir, MANIFEST_FILENAME);
}

export function createEmptyManifest(input: {
  baselineDir: string;
  forkSha: string;
  generatedAt: string;
}): BaselineManifest {
  return {
    version: 1,
    fork_sha: input.forkSha,
    baseline_dir: input.baselineDir,
    generated_at: input.generatedAt,
    updated_at: input.generatedAt,
    entries: [],
  };
}

export function loadOrCreateManifest(input: {
  baselineDir: string;
  forkSha: string;
  now: string;
}): BaselineManifest {
  const path = manifestPathForBaselineDir(input.baselineDir);
  if (!existsSync(path)) {
    return createEmptyManifest({
      baselineDir: input.baselineDir,
      forkSha: input.forkSha,
      generatedAt: input.now,
    });
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  const manifest = parseManifest(parsed);
  if (manifest === null) {
    throw new Error(`Invalid baseline manifest: ${path}`);
  }
  return {
    ...manifest,
    baseline_dir: input.baselineDir,
    fork_sha: input.forkSha,
  };
}

export function writeManifest(path: string, manifest: BaselineManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export function ensurePendingManifestEntries(input: {
  manifest: BaselineManifest;
  items: RegistryItem[];
  forkSha: string;
  now: string;
  relativeVideoPathForItem: (item: RegistryItem) => string;
}): BaselineManifest {
  let manifest = input.manifest;
  for (const item of input.items) {
    const existing = findManifestEntry(manifest, item.key, input.forkSha);
    if (existing) continue;
    manifest = recordManifestEntry(manifest, {
      item,
      forkSha: input.forkSha,
      relativeVideoPath: input.relativeVideoPathForItem(item),
      status: "pending",
      renderedAt: null,
      renderDurationMs: null,
    });
  }
  return { ...manifest, updated_at: input.now };
}

export function recordManifestEntry(
  inputManifest: BaselineManifest,
  input: {
    item: RegistryItem;
    forkSha: string;
    relativeVideoPath: string;
    status: BaselineStatus;
    renderedAt: string | null;
    renderDurationMs: number | null;
    errorMessage?: string;
  },
): BaselineManifest {
  const entry: BaselineManifestEntry = {
    item_key: input.item.key,
    item_name: input.item.name,
    kind: input.item.kind,
    source_dir: input.item.itemDirRelative,
    entry_file: input.item.entryFile,
    baseline_video_path: input.relativeVideoPath,
    fork_sha: input.forkSha,
    rendered_at: input.renderedAt,
    fps: input.item.fps,
    duration: input.item.duration,
    dimensions: input.item.dimensions,
    status: input.status,
    render_duration_ms: input.renderDurationMs,
    ...(input.errorMessage ? { error_message: input.errorMessage } : {}),
    ...(input.item.notes.length > 0 ? { notes: input.item.notes } : {}),
  };

  const entries = inputManifest.entries.filter(
    (candidate) => !(candidate.item_key === input.item.key && candidate.fork_sha === input.forkSha),
  );
  entries.push(entry);
  entries.sort((a, b) => a.item_key.localeCompare(b.item_key));
  return {
    ...inputManifest,
    fork_sha: input.forkSha,
    updated_at: input.renderedAt ?? inputManifest.updated_at,
    entries,
  };
}

export function findManifestEntry(
  manifest: BaselineManifest,
  itemKey: string,
  forkSha: string,
): BaselineManifestEntry | null {
  return (
    manifest.entries.find((entry) => entry.item_key === itemKey && entry.fork_sha === forkSha) ??
    null
  );
}

export function findSuccessfulEntry(
  manifest: BaselineManifest,
  itemKeyOrName: string,
  forkSha: string,
): BaselineManifestEntry | null {
  return (
    manifest.entries.find(
      (entry) =>
        entry.fork_sha === forkSha &&
        entry.status === "success" &&
        (entry.item_key === itemKeyOrName || entry.item_name === itemKeyOrName),
    ) ?? null
  );
}

// fallow-ignore-next-line complexity
function parseManifest(value: unknown): BaselineManifest | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.fork_sha !== "string") return null;
  if (typeof value.baseline_dir !== "string") return null;
  if (typeof value.generated_at !== "string") return null;
  if (typeof value.updated_at !== "string") return null;
  if (!Array.isArray(value.entries)) return null;
  const entries = value.entries.filter(isManifestEntry);
  if (entries.length !== value.entries.length) return null;
  return {
    version: 1,
    fork_sha: value.fork_sha,
    baseline_dir: value.baseline_dir,
    generated_at: value.generated_at,
    updated_at: value.updated_at,
    entries,
  };
}

// fallow-ignore-next-line complexity
function isManifestEntry(value: unknown): value is BaselineManifestEntry {
  if (!isRecord(value)) return false;
  if (typeof value.item_key !== "string") return false;
  if (typeof value.item_name !== "string") return false;
  if (!isKind(value.kind)) return false;
  if (typeof value.source_dir !== "string") return false;
  if (typeof value.entry_file !== "string") return false;
  if (typeof value.baseline_video_path !== "string") return false;
  if (typeof value.fork_sha !== "string") return false;
  if (!(typeof value.rendered_at === "string" || value.rendered_at === null)) return false;
  if (!isPositiveNumber(value.fps)) return false;
  if (!isPositiveNumber(value.duration)) return false;
  if (!isDimensions(value.dimensions)) return false;
  if (!isStatus(value.status)) return false;
  if (!(typeof value.render_duration_ms === "number" || value.render_duration_ms === null)) {
    return false;
  }
  return value.error_message === undefined || typeof value.error_message === "string";
}

function isKind(value: unknown): value is BaselineManifestEntry["kind"] {
  return value === "block" || value === "component" || value === "example";
}

function isStatus(value: unknown): value is BaselineStatus {
  return value === "pending" || value === "success" || value === "failed";
}

function isDimensions(value: unknown): value is BaselineManifestEntry["dimensions"] {
  if (!isRecord(value)) return false;
  return isPositiveNumber(value.width) && isPositiveNumber(value.height);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
