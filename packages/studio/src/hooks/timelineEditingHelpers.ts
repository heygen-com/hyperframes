import { type TimelineElement, usePlayerStore } from "../player/store/playerStore";
import { applyPatchByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import {
  formatTimelineAttributeNumber,
  type TimelineStackingReorderIntent,
} from "../player/components/timelineEditing";
import { getElementZIndex } from "../player/lib/layerOrdering";
import { getTimelineElementIdentity } from "../player/lib/timelineElementHelpers";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import type { TimelineZIndexReorderCommit } from "./useTimelineEditingTypes";
import { extendRootDurationInSource } from "../utils/rootDuration";
export { deleteSelectedKeyframes } from "./deleteSelectedKeyframes";
function isHTMLElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  // Use the element's OWN realm's HTMLElement: timeline clips live in the preview
  // iframe, and cross-realm `element instanceof HTMLElement` (main window) is
  // always false — which silently dropped every timeline z-index commit.
  const Ctor = element.ownerDocument?.defaultView?.HTMLElement ?? globalThis.HTMLElement;
  return element instanceof Ctor;
}
/**
 * Resolve a timeline vertical move to a z-index stacking reorder and commit it
 * through the shared layers-panel reorder path. Reads live sibling z-index from
 * the preview DOM, remaps with the dup-preserving reorder math, and writes only
 * z-index (never data-track-index). No-op when the move isn't a reorder, the
 * dragged clip is audio (no visual layer to restack), or the live siblings can't
 * be resolved. Extracted from StudioApp's timeline hook to keep it under the
 * studio 600-LOC cap.
 */
// fallow-ignore-next-line complexity
export function applyTimelineStackingReorder(input: {
  element: TimelineElement;
  stackingReorder: TimelineStackingReorderIntent | null | undefined;
  timelineElements: readonly TimelineElement[];
  iframe: HTMLIFrameElement | null;
  activeCompPath: string | null;
  commit: TimelineZIndexReorderCommit | null | undefined;
  coalesceKey?: string;
}): Promise<void> {
  // Audio has no visual stacking; a vertical drag on it must never write z-index.
  if (input.element.tag === "audio") return Promise.resolve();
  const intent = input.stackingReorder ?? null;
  if (intent == null || intent.zIndexChanges.length === 0) return Promise.resolve();
  // Resolve each change's live element from the change's OWN locator (the intent
  // is self-contained), falling back to the top-level element list. Sub-comp
  // children aren't in `timelineElements`, so a list-only lookup would miss them.
  const siblingByKey = new Map(
    input.timelineElements.map((el) => [getTimelineElementIdentity(el), el]),
  );
  const doc = input.iframe?.contentDocument ?? null;
  const findLive = (domId?: string, selector?: string, selectorIndex?: number): Element | null => {
    if (!doc) return null;
    if (domId) return doc.getElementById(domId);
    if (selector) return doc.querySelectorAll(selector)[selectorIndex ?? 0] ?? null;
    return null;
  };
  const commitEntries: Array<{
    element: HTMLElement;
    zIndex: number;
    id?: string;
    selector?: string;
    selectorIndex?: number;
    sourceFile: string;
    key: string;
  }> = [];
  for (const change of intent.zIndexChanges) {
    const sibling = siblingByKey.get(change.key);
    const domId = change.domId ?? sibling?.domId;
    const selector = change.selector ?? sibling?.selector;
    const selectorIndex = change.selectorIndex ?? sibling?.selectorIndex;
    const element = findLive(domId, selector, selectorIndex);
    if (!isHTMLElement(element)) return Promise.resolve();
    if (getElementZIndex(element) === change.zIndex) continue;
    commitEntries.push({
      element,
      zIndex: change.zIndex,
      id: domId ?? sibling?.id ?? change.key,
      selector,
      selectorIndex,
      sourceFile: change.sourceFile ?? sibling?.sourceFile ?? input.activeCompPath ?? "index.html",
      key: change.key,
    });
  }
  if (commitEntries.length === 0) return Promise.resolve();
  return input.commit?.(commitEntries, input.coalesceKey) ?? Promise.resolve();
}
export function extendRootDurationIfNeeded(newEnd: number): boolean {
  const store = usePlayerStore.getState();
  if (newEnd <= store.duration) return false;
  store.setDuration(newEnd);
  return true;
}
// ── Types ──
export type { RecordEditInput } from "../utils/studioFileHistory";
export function buildPatchTarget(element: {
  domId?: string;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
}) {
  if (element.domId) {
    return {
      id: element.domId,
      hfId: element.hfId,
      selector: element.selector,
      selectorIndex: element.selectorIndex,
    };
  }
  if (element.hfId) {
    return { hfId: element.hfId, selector: element.selector, selectorIndex: element.selectorIndex };
  }
  if (element.selector) {
    return { selector: element.selector, selectorIndex: element.selectorIndex };
  }
  return null;
}
export type PatchTarget = NonNullable<ReturnType<typeof buildPatchTarget>>;
// The runtime re-reads data-start/data-duration from the DOM on each sync tick
// (packages/core/src/runtime/init.ts:1324-1368), so attribute mutations here are
// picked up automatically on the next frame without a rebind call.
export function findTimelineElementInIframe(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
): Element | null {
  try {
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    return element.domId
      ? doc.getElementById(element.domId)
      : element.selector
        ? (doc.querySelectorAll(element.selector)[element.selectorIndex ?? 0] ?? null)
        : null;
  } catch {
    return null;
  }
}
export function patchIframeDomTiming(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
  attrs: Array<[string, string]>,
): void {
  try {
    const el = findTimelineElementInIframe(iframe, element);
    if (!el) return;
    for (const [name, value] of attrs) el.setAttribute(name, value);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}
function postRootDurationToPreview(
  iframe: HTMLIFrameElement | null,
  durationSeconds: number,
): void {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return;
  iframe?.contentWindow?.postMessage(
    {
      source: "hf-parent",
      type: "control",
      action: "set-root-duration",
      durationSeconds: duration,
    },
    "*",
  );
}
// fallow-ignore-next-line complexity
function resolveResizePlaybackStart(
  original: string,
  target: PatchTarget,
  element: TimelineElement,
  updates: Pick<TimelineElement, "start" | "playbackStart">,
): { attrName: string; value: number } | null {
  if (updates.playbackStart != null) {
    const attrName =
      element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
    return { attrName, value: updates.playbackStart };
  }
  const trimDelta = updates.start - element.start;
  if (trimDelta === 0) return null;
  const raw =
    readAttributeByTarget(original, target, "playback-start") ??
    readAttributeByTarget(original, target, "media-start");
  const current = raw != null ? parseFloat(raw) : undefined;
  if (current == null || !Number.isFinite(current)) return null;
  const attrName =
    element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
  return {
    attrName,
    value: Math.max(0, current + trimDelta * Math.max(element.playbackRate ?? 1, 0.1)),
  };
}

export function buildTimelineMoveTimingPatch(
  original: string,
  target: PatchTarget,
  start: number,
  duration: number,
  track?: number,
): string {
  if (!Number.isFinite(start) || !Number.isFinite(duration)) {
    console.warn(
      `[Timeline] buildTimelineMoveTimingPatch: non-finite timing (start=${start}, duration=${duration}) — patch skipped`,
    );
    return original;
  }
  let patched = applyPatchByTarget(original, target, {
    type: "attribute",
    property: "start",
    value: formatTimelineAttributeNumber(start),
  });
  if (track != null && Number.isFinite(track)) {
    patched = applyPatchByTarget(patched, target, {
      type: "attribute",
      property: "track-index",
      value: formatTimelineAttributeNumber(track),
    });
  }
  return extendRootDurationInSource(patched, start + duration);
}

export function buildTimelineResizeTimingPatch(
  original: string,
  target: PatchTarget,
  element: TimelineElement,
  updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
): string {
  const pbs = resolveResizePlaybackStart(original, target, element, updates);
  let patched = applyPatchByTarget(original, target, {
    type: "attribute",
    property: "start",
    value: formatTimelineAttributeNumber(updates.start),
  });
  patched = applyPatchByTarget(patched, target, {
    type: "attribute",
    property: "duration",
    value: formatTimelineAttributeNumber(updates.duration),
  });
  if (pbs) {
    patched = applyPatchByTarget(patched, target, {
      type: "attribute",
      property: pbs.attrName,
      value: formatTimelineAttributeNumber(pbs.value),
    });
  }
  return extendRootDurationInSource(patched, updates.start + updates.duration);
}

export interface PersistTimelineEditInput {
  projectId: string;
  element: TimelineElement;
  activeCompPath: string | null;
  label: string;
  buildPatches: (original: string, target: PatchTarget) => string;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>>;
  coalesceKey?: string;
}

export async function persistTimelineEdit(input: PersistTimelineEditInput): Promise<void> {
  const targetPath = input.element.sourceFile || input.activeCompPath || "index.html";
  const originalContent = await readFileContent(input.projectId, targetPath);

  const patchTarget = buildPatchTarget(input.element);
  if (!patchTarget) {
    throw new Error(`Timeline element ${input.element.id} is missing a patchable target`);
  }

  const patchedContent = input.buildPatches(originalContent, patchTarget);
  if (patchedContent === originalContent) {
    throw new Error(`Unable to patch timeline element ${input.element.id} in ${targetPath}`);
  }

  input.pendingTimelineEditPathRef.current.add(targetPath);
  input.domEditSaveTimestampRef.current = Date.now();
  await saveProjectFilesWithHistory({
    projectId: input.projectId,
    label: input.label,
    kind: "timeline",
    coalesceKey: input.coalesceKey,
    files: { [targetPath]: patchedContent },
    readFile: async () => originalContent,
    writeFile: input.writeProjectFile,
    recordEdit: input.recordEdit,
  });
  input.domEditSaveTimestampRef.current = Date.now();
}

export interface PersistTimelineBatchChange {
  element: TimelineElement;
  buildPatches: (original: string, target: PatchTarget) => string;
}

export interface PersistTimelineBatchEditInput {
  projectId: string;
  activeCompPath: string | null;
  label: string;
  changes: PersistTimelineBatchChange[];
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>>;
  coalesceKey?: string;
}

export async function persistTimelineBatchEdit(
  input: PersistTimelineBatchEditInput,
): Promise<void> {
  const originals = new Map<string, string>();
  const patchedByPath = new Map<string, string>();

  for (const change of input.changes) {
    const targetPath = change.element.sourceFile || input.activeCompPath || "index.html";
    const original =
      originals.get(targetPath) ?? (await readFileContent(input.projectId, targetPath));
    originals.set(targetPath, original);

    const patchTarget = buildPatchTarget(change.element);
    if (!patchTarget) {
      throw new Error(`Timeline element ${change.element.id} is missing a patchable target`);
    }

    const current = patchedByPath.get(targetPath) ?? original;
    const patched = change.buildPatches(current, patchTarget);
    if (patched === current) {
      throw new Error(`Unable to patch timeline element ${change.element.id} in ${targetPath}`);
    }
    patchedByPath.set(targetPath, patched);
  }

  const files = Object.fromEntries(patchedByPath);
  for (const targetPath of Object.keys(files)) {
    input.pendingTimelineEditPathRef.current.add(targetPath);
  }
  input.domEditSaveTimestampRef.current = Date.now();
  await saveProjectFilesWithHistory({
    projectId: input.projectId,
    label: input.label,
    kind: "timeline",
    coalesceKey: input.coalesceKey,
    files,
    readFile: async (path) => originals.get(path) ?? readFileContent(input.projectId, path),
    writeFile: input.writeProjectFile,
    recordEdit: input.recordEdit,
  });
  input.domEditSaveTimestampRef.current = Date.now();
}

export async function readFileContent(projectId: string, targetPath: string): Promise<string> {
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    throw new Error(`Unsafe path: ${targetPath}`);
  }
  const response = await fetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(targetPath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read ${targetPath}`);
  }
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") {
    throw new Error(`Missing file contents for ${targetPath}`);
  }
  return data.content;
}

export type GsapMutationStatus = { mutated: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMutationStatus(value: unknown): GsapMutationStatus {
  if (!isRecord(value)) return { mutated: false };
  return { mutated: value.mutated === true || value.changed === true };
}

function readMutationError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === "string") return value.error;
  return fallback;
}

export async function finishTimelineTimingFallback(input: {
  iframe: HTMLIFrameElement | null;
  needsExtension: boolean;
  rootDurationSeconds: number;
  reloadPreview: () => void;
  gsapMutation?: () => Promise<GsapMutationStatus>;
  onGsapError: (error: unknown) => void;
}): Promise<void> {
  let gsapMutated = false;
  if (input.gsapMutation) {
    try {
      gsapMutated = (await input.gsapMutation()).mutated;
    } catch (error) {
      input.onGsapError(error);
      return;
    }
  }
  if (input.needsExtension) {
    postRootDurationToPreview(input.iframe, input.rootDurationSeconds);
    if (gsapMutated) input.reloadPreview();
    return;
  }
  input.reloadPreview();
}

// Coalesce window for folding a GSAP mutation into the preceding timing edit; only has to
// outlast one GSAP server round-trip, never a real second edit.
const GSAP_HISTORY_COALESCE_MS = 10_000;

/**
 * A server GSAP rewrite mutates the same file the timing patch just wrote, but AFTER the
 * timing edit was recorded, leaving the recorded `after` stale so an undo hits a hash
 * conflict. This snapshots every touched file, runs the mutation, then records a follow-up
 * edit under the same coalesceKey with a window wide enough to survive the GSAP round-trip,
 * folding both writes into one undo step. Returns the mutation status for caller reloads.
 */
export async function foldGsapMutationIntoHistory(input: {
  projectId: string;
  paths: string[];
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  gsapMutation: () => Promise<GsapMutationStatus>;
}): Promise<GsapMutationStatus> {
  const uniquePaths = [...new Set(input.paths)];
  const before = new Map<string, string>();
  for (const path of uniquePaths) {
    before.set(path, await readFileContent(input.projectId, path));
  }
  const status = await input.gsapMutation();
  if (status.mutated) {
    const files: Record<string, { before: string; after: string }> = {};
    for (const path of uniquePaths) {
      const priorContent = before.get(path);
      const finalContent = await readFileContent(input.projectId, path);
      if (priorContent !== undefined && finalContent !== priorContent) {
        files[path] = { before: priorContent, after: finalContent };
      }
    }
    if (Object.keys(files).length > 0) {
      await input.recordEdit({
        label: input.label,
        kind: "timeline",
        coalesceKey: input.coalesceKey,
        coalesceMs: GSAP_HISTORY_COALESCE_MS,
        files,
      });
    }
  }
  return status;
}

/**
 * Shift all GSAP animation positions targeting a given element by a time delta.
 * Calls the server-side GSAP mutation endpoint which uses the AST-based parser.
 */
export async function shiftGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  delta: number,
): Promise<GsapMutationStatus> {
  if (delta === 0 || !elementId) return { mutated: false };
  const res = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift-positions",
        targetSelector: `#${elementId}`,
        delta,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(readMutationError(err, "shift-positions failed"));
  }
  return readMutationStatus(await res.json().catch(() => null));
}

export async function scaleGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  oldStart: number,
  oldDuration: number,
  newStart: number,
  newDuration: number,
): Promise<GsapMutationStatus> {
  if (!elementId || oldDuration <= 0 || newDuration <= 0) return { mutated: false };
  if (oldStart === newStart && oldDuration === newDuration) return { mutated: false };
  const res = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "scale-positions",
        targetSelector: `#${elementId}`,
        oldStart,
        oldDuration,
        newStart,
        newDuration,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(readMutationError(err, "scale-positions failed"));
  }
  return readMutationStatus(await res.json().catch(() => null));
}

/** Single-clip move GSAP shift, folded into the timing edit's history entry (see above). */
export function foldedShiftGsapMutation(input: {
  projectId: string;
  targetPath: string;
  domId: string;
  delta: number;
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
}): () => Promise<GsapMutationStatus> {
  return () =>
    foldGsapMutationIntoHistory({
      projectId: input.projectId,
      paths: [input.targetPath],
      label: input.label,
      coalesceKey: input.coalesceKey,
      recordEdit: input.recordEdit,
      gsapMutation: () =>
        shiftGsapPositions(input.projectId, input.targetPath, input.domId, input.delta),
    });
}

/** Single-clip resize GSAP scale, folded into the timing edit's history entry (see above). */
export function foldedScaleGsapMutation(input: {
  projectId: string;
  targetPath: string;
  domId: string;
  from: { start: number; duration: number };
  to: { start: number; duration: number };
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
}): () => Promise<GsapMutationStatus> {
  return () =>
    foldGsapMutationIntoHistory({
      projectId: input.projectId,
      paths: [input.targetPath],
      label: input.label,
      coalesceKey: input.coalesceKey,
      recordEdit: input.recordEdit,
      gsapMutation: () =>
        scaleGsapPositions(
          input.projectId,
          input.targetPath,
          input.domId,
          input.from.start,
          input.from.duration,
          input.to.start,
          input.to.duration,
        ),
    });
}

export { applyPatchByTarget, formatTimelineAttributeNumber };

export { patchDocumentRootDuration } from "./timelineEditingGsap";
