import { type TimelineElement, usePlayerStore } from "../player/store/playerStore";
import { applyPatchByTarget, findTagByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import {
  formatTimelineAttributeNumber,
  type TimelineStackingReorderIntent,
} from "../player/components/timelineEditing";
import { getElementZIndex } from "../player/lib/layerOrdering";
import {
  furthestClipEndFromSource,
  getTimelineElementIdentity,
} from "../player/lib/timelineElementHelpers";
import { saveProjectFilesWithHistory, type RecordEditInput } from "../utils/studioFileHistory";
import type { TimelineZIndexReorderCommit } from "./useTimelineEditingTypes";
import { setCompositionDurationToContent } from "../utils/timelineAssetDrop";
import { readFileContent } from "./timelineTimingSync";
import { findElementForSelection } from "../components/editor/domEditingElement";
export { deleteSelectedKeyframes } from "./deleteSelectedKeyframes";
export { readFileContent };
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
    const sourceFile =
      change.sourceFile ?? sibling?.sourceFile ?? input.activeCompPath ?? "index.html";
    const element = doc
      ? findElementForSelection(
          doc,
          { id: domId, selector, selectorIndex, sourceFile },
          input.activeCompPath,
        )
      : null;
    if (!isHTMLElement(element)) return Promise.resolve();
    if (getElementZIndex(element) === change.zIndex) continue;
    commitEntries.push({
      element,
      zIndex: change.zIndex,
      id: domId ?? sibling?.id ?? change.key,
      selector,
      selectorIndex,
      sourceFile,
      key: change.key,
    });
  }
  if (commitEntries.length === 0) return Promise.resolve();
  // The durability report is for gesture-level callers (z→lane mirror); this
  // lane-drag z-sync path has no dependent follow-up write — swallow it.
  // Promise.resolve-wrapped: a commit implementation may return void.
  return Promise.resolve(input.commit?.(commitEntries, input.coalesceKey)).then(() => undefined);
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
  activeCompositionPath: string | null = null,
): Element | null {
  try {
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    return findElementForSelection(
      doc,
      {
        hfId: element.hfId,
        id: element.domId,
        selector: element.selector,
        selectorIndex: element.selectorIndex,
        sourceFile: element.sourceFile || activeCompositionPath || "index.html",
      },
      activeCompositionPath,
    );
  } catch {
    return null;
  }
}
export function patchIframeDomTiming(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
  attrs: Array<[string, string]>,
  activeCompositionPath: string | null = null,
): void {
  try {
    const el = findTimelineElementInIframe(iframe, element, activeCompositionPath);
    if (!el) return;
    for (const [name, value] of attrs) el.setAttribute(name, value);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

export function playbackStartAttributeForElement(
  element: Pick<TimelineElement, "kind" | "playbackStartAttr">,
): "data-media-start" | "data-playback-start" {
  return element.playbackStartAttr === "playback-start" || element.kind === "composition"
    ? "data-playback-start"
    : "data-media-start";
}
// fallow-ignore-next-line complexity
function resolveResizePlaybackStart(
  original: string,
  target: PatchTarget,
  element: TimelineElement,
  updates: Pick<TimelineElement, "start" | "playbackStart">,
): { attrName: string; value: number } | null {
  if (updates.playbackStart != null) {
    const attrName = playbackStartAttributeForElement(element).slice("data-".length);
    return { attrName, value: updates.playbackStart };
  }
  const trimDelta = updates.start - element.start;
  if (trimDelta === 0) return null;
  const raw =
    readAttributeByTarget(original, target, "playback-start") ??
    readAttributeByTarget(original, target, "media-start");
  const current = raw != null ? parseFloat(raw) : undefined;
  if (current == null || !Number.isFinite(current)) return null;
  const attrName = playbackStartAttributeForElement(element).slice("data-".length);
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
  // Content-driven duration: sync data-duration to the furthest clip end read
  // from the PATCHED SOURCE (raw data-duration), so it grows if a clip moved
  // past the end and shrinks if the furthest clip moved left. Measured from the
  // source, NOT the store — store durations are runtime-truncated to the current
  // comp length, which would ratchet the duration down every move.
  return setCompositionDurationToContent(patched, furthestClipEndFromSource(patched));
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
  // Content-driven duration from the PATCHED SOURCE (raw data-duration) —
  // grows/shrinks to the furthest clip end. Not from the store, whose
  // durations are runtime-truncated.
  return setCompositionDurationToContent(patched, furthestClipEndFromSource(patched));
}

export interface PersistTimelineEditInput {
  projectId: string;
  element: TimelineElement;
  activeCompPath: string | null;
  label: string;
  buildPatches: (original: string, target: PatchTarget) => string;
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
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
  writeProjectFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>>;
  coalesceKey?: string;
  /** Per-entry undo coalesce window override (ms) — see EditHistoryEntry.coalesceMs. */
  coalesceMs?: number;
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
    // Resolve the target FIRST: byte-identical output below is only a legit
    // no-op when the member actually resolved in the source. A mistargeted
    // member (stale id/selector) must fail loudly like the single-edit path,
    // not be silently dropped as "already at target".
    if (!findTagByTarget(current, patchTarget)) {
      throw new Error(`Unable to patch timeline element ${change.element.id} in ${targetPath}`);
    }
    const patched = change.buildPatches(current, patchTarget);
    // The target resolved, so a member whose attributes already hold the target
    // values patches to the identical string — e.g. a track-insert renumber
    // where one clip's lane is already correct. That is a legitimate no-op:
    // skip it instead of aborting (and rolling back) the whole batch.
    if (patched === current) continue;
    patchedByPath.set(targetPath, patched);
  }

  if (patchedByPath.size === 0) return;

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
    coalesceMs: input.coalesceMs,
    files,
    readFile: async (path) => originals.get(path) ?? readFileContent(input.projectId, path),
    writeFile: input.writeProjectFile,
    recordEdit: input.recordEdit,
  });
  input.domEditSaveTimestampRef.current = Date.now();
}

export { applyPatchByTarget, formatTimelineAttributeNumber };

export { patchDocumentRootDuration } from "./timelineEditingGsap";
