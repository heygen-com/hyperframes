import type { DomEditSelection } from "./domEditing";
import type {
  StudioManualEdit,
  StudioManualEditManifest,
  StudioManualEditTarget,
  StudioPathOffsetEdit,
  StudioBoxSizeEdit,
  StudioRotationEdit,
} from "./manualEditsTypes";
import { STUDIO_MANUAL_EDITS_PATH } from "./manualEditsTypes";

/* ── Helpers ──────────────────────────────────────────────────────── */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ── Manifest factory ─────────────────────────────────────────────── */
export function emptyStudioManualEditManifest(): StudioManualEditManifest {
  return { version: 1, edits: [] };
}

/* ── Parsing ──────────────────────────────────────────────────────── */
function parsePathOffsetEdit(value: unknown): StudioPathOffsetEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "path-offset") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  if (x == null || y == null) return null;

  return {
    kind: "path-offset",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    x,
    y,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseBoxSizeEdit(value: unknown): StudioBoxSizeEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "box-size") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (width == null || height == null || width <= 0 || height <= 0) return null;

  return {
    kind: "box-size",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    width,
    height,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseRotationEdit(value: unknown): StudioRotationEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "rotation") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const angle = finiteNumber(record.angle);
  if (angle == null) return null;

  return {
    kind: "rotation",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    angle,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseManualEdit(value: unknown): StudioManualEdit | null {
  return parsePathOffsetEdit(value) ?? parseBoxSizeEdit(value) ?? parseRotationEdit(value);
}

export function parseStudioManualEditManifest(content: string): StudioManualEditManifest {
  if (!content.trim()) return emptyStudioManualEditManifest();

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStudioManualEditManifest();
    const edits = (parsed as { edits?: unknown }).edits;
    if (!Array.isArray(edits)) return emptyStudioManualEditManifest();
    return {
      version: 1,
      edits: edits.map(parseManualEdit).filter((edit): edit is StudioManualEdit => edit !== null),
    };
  } catch {
    return emptyStudioManualEditManifest();
  }
}

export function serializeStudioManualEditManifest(manifest: StudioManualEditManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
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

export function isStudioManualEditManifestPath(path: string | null): boolean {
  if (!path) return false;
  const normalized = normalizeStudioFileChangePath(path);
  return (
    normalized === STUDIO_MANUAL_EDITS_PATH || normalized.endsWith(`/${STUDIO_MANUAL_EDITS_PATH}`)
  );
}

/* ── Target / upsert helpers ──────────────────────────────────────── */
function selectionTarget(selection: DomEditSelection): StudioManualEditTarget {
  return {
    sourceFile: selection.sourceFile || "index.html",
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
    id: selection.id ?? undefined,
  };
}

function targetKey(target: StudioManualEditTarget): string {
  return [
    target.sourceFile,
    target.id ?? "",
    target.selector ?? "",
    target.selectorIndex ?? "",
  ].join("|");
}

export function roundRotationAngle(angle: number): number {
  return Math.round(angle * 10) / 10;
}

export function upsertStudioPathOffsetEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  offset: { x: number; y: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioPathOffsetEdit = {
    kind: "path-offset",
    target,
    x: Math.round(offset.x),
    y: Math.round(offset.y),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "path-offset" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function upsertStudioBoxSizeEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  size: { width: number; height: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioBoxSizeEdit = {
    kind: "box-size",
    target,
    width: Math.round(Math.max(1, size.width)),
    height: Math.round(Math.max(1, size.height)),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "box-size" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function upsertStudioRotationEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  rotation: { angle: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioRotationEdit = {
    kind: "rotation",
    target,
    angle: roundRotationAngle(rotation.angle),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "rotation" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function removeStudioManualEditsForSelection(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
): StudioManualEditManifest {
  const key = targetKey(selectionTarget(selection));
  const edits = manifest.edits.filter((edit) => targetKey(edit.target) !== key);
  if (edits.length === manifest.edits.length) return manifest;
  return { version: 1, edits };
}
