import type { TimelineElement } from "../player/store/playerStore";
import { applySoftReload } from "../utils/gsapSoftReload";
import { applyPatchByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";

// ── Types ──

export interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

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

/** One clip-timing attribute to write for a move, in both patch dialects. */
export interface TimelineMoveTimingPatch {
  /** Source-patcher attribute name (no `data-` prefix): fed to applyPatchByTarget. */
  property: "start" | "track-index";
  /** Live-DOM attribute name (`data-` prefixed): fed to patchIframeDomTiming. */
  attr: "data-start" | "data-track-index";
  value: string;
}

let warnedNonFiniteMoveTiming = false;

/**
 * Build the timing-attribute patches (data-start + data-track-index) for one clip
 * move, SKIPPING any field whose numeric value is non-finite.
 *
 * #2212 insurance: in a mid-stack deploy window a stale handler can receive a move
 * whose `start` (or `track`) is `undefined`, and `formatTimelineAttributeNumber`
 * / `String` would then serialize `NaN`/`"NaN"` straight into `data-start`,
 * poisoning the source and the live DOM (the runtime re-reads the attribute and
 * renders the clip at NaN). Dropping the non-finite field leaves the clip's prior
 * value intact instead of persisting garbage, and warns once (naming the field) so
 * the upstream shape bug is still visible.
 */
export function buildTimelineMoveTimingPatch(
  updates: Pick<TimelineElement, "start" | "track">,
): TimelineMoveTimingPatch[] {
  const patches: TimelineMoveTimingPatch[] = [];
  const push = (
    field: "start" | "track",
    property: TimelineMoveTimingPatch["property"],
    attr: TimelineMoveTimingPatch["attr"],
    value: number,
    format: (v: number) => string,
  ): void => {
    if (!Number.isFinite(value)) {
      if (!warnedNonFiniteMoveTiming) {
        warnedNonFiniteMoveTiming = true;
        console.warn(
          `[Timeline] Skipping non-finite move timing patch for "${field}" (value=${String(value)}) — not persisting NaN into ${attr}`,
        );
      }
      return;
    }
    patches.push({ property, attr, value: format(value) });
  };
  push("start", "start", "data-start", updates.start, formatTimelineAttributeNumber);
  push("track", "track-index", "data-track-index", updates.track, String);
  return patches;
}

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

/**
 * Pure: find the TOP-LEVEL composition root in `doc` (the `[data-composition-id]`
 * with no ancestor composition, matching the runtime's own root resolution) and
 * write `contentEnd` into its `data-duration`. Returns whether a write happened.
 *
 * A timing edit optimistically patches the moved clip's `data-start`/`-duration`
 * in the live iframe, but NOT the root's `data-duration`. Timing edits now take
 * the soft-reload path (no full iframe reload), which re-runs the GSAP script and
 * lets the runtime recompute the composition length — it reads the root's
 * `data-duration` as the authored floor (core/runtime/init.ts) and posts it back,
 * so the studio store's duration is set from the STALE root and the readout
 * reverts to the pre-edit length. Patching the root here keeps the runtime's
 * post-soft-reload duration report in agreement with the optimistic readout, so
 * the number stays live (grow AND shrink) instead of snapping back.
 */
export function patchDocumentRootDuration(
  doc: Document | null | undefined,
  contentEnd: number,
): boolean {
  if (!doc || !Number.isFinite(contentEnd) || contentEnd <= 0) return false;
  const nodes = Array.from(doc.querySelectorAll("[data-composition-id]"));
  const root =
    nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0] ?? null;
  if (!root) return false;
  root.setAttribute("data-duration", formatTimelineAttributeNumber(contentEnd));
  return true;
}

/** Best-effort live-iframe wrapper for patchDocumentRootDuration (see above). */
export function patchIframeRootDuration(
  iframe: HTMLIFrameElement | null,
  contentEnd: number,
): void {
  try {
    patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

// fallow-ignore-next-line complexity
export function resolveResizePlaybackStart(
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

/**
 * The bits of the server GSAP-mutation response the timeline edit path needs.
 * `scriptText` is the rewritten root GSAP script — feeding it to `applySoftReload`
 * swaps the runtime timeline in place (no iframe reload = no all-clips flash). Null
 * when the endpoint didn't return one (older server, or a multi-script comp the
 * soft path can't scope), in which case the caller full-reloads as before.
 */
export interface GsapMutationOutcome {
  scriptText: string | null;
}

function readGsapMutationScriptText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const text = (body as { scriptText?: unknown }).scriptText;
  return typeof text === "string" ? text : null;
}

/**
 * Shift all GSAP animation positions targeting a given element by a time delta.
 * Calls the server-side GSAP mutation endpoint which uses the AST-based parser.
 * Returns the rewritten script so the caller can soft-reload instead of full-reload.
 */
export async function shiftGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  delta: number,
): Promise<GsapMutationOutcome> {
  if (delta === 0 || !elementId) return { scriptText: null };
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
    throw new Error((err as { error?: string })?.error ?? "shift-positions failed");
  }
  return { scriptText: readGsapMutationScriptText(await res.json().catch(() => null)) };
}

/**
 * Batched counterpart to shiftGsapPositions: shift several elements' GSAP tween
 * positions in ONE server write (the `shift-positions-batch` op). Used by the
 * atomic multi-clip persist so a ripple/insert shifts every affected clip's
 * tweens together instead of one racing round-trip per clip. No-op when every
 * delta is 0 or the list is empty.
 */
export async function shiftGsapPositionsBatch(
  projectId: string,
  filePath: string,
  shifts: Array<{ elementId: string; delta: number }>,
): Promise<GsapMutationOutcome> {
  const payload = shifts
    .filter((s) => s.elementId && Number.isFinite(s.delta) && s.delta !== 0)
    .map((s) => ({ targetSelector: `#${s.elementId}`, delta: s.delta }));
  if (payload.length === 0) return { scriptText: null };
  const res = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shift-positions-batch", shifts: payload }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "shift-positions-batch failed");
  }
  return { scriptText: readGsapMutationScriptText(await res.json().catch(() => null)) };
}

export async function scaleGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  oldStart: number,
  oldDuration: number,
  newStart: number,
  newDuration: number,
): Promise<GsapMutationOutcome> {
  if (!elementId || oldDuration <= 0 || newDuration <= 0) return { scriptText: null };
  if (oldStart === newStart && oldDuration === newDuration) return { scriptText: null };
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
    throw new Error((err as { error?: string })?.error ?? "scale-positions failed");
  }
  return { scriptText: readGsapMutationScriptText(await res.json().catch(() => null)) };
}

/**
 * Sync the live preview after a TIMING-ONLY edit (move / resize), preferring a
 * soft reload over the full iframe reload that flashes every clip.
 *
 * Why this is safe WITHOUT re-deriving timeline elements: a move/resize commit has
 * already (a) patched the live DOM timing attributes, (b) updated the store's
 * elements optimistically (useTimelineClipDrag calls `updateElement` before the
 * persist), and (c) had the server rewrite the GSAP tween positions — which is the
 * `scriptText` we swap in here. `applySoftReload` re-runs that script in the LIVE
 * document (no navigation), re-seeks to the current playhead, and rebinds the
 * timeline, so the runtime matches the already-correct store. Nothing structural
 * changed (no clip added/removed), so `processTimelineMessage` would re-derive the
 * identical element set — skipping it just avoids the flash.
 *
 * Escalates to the full `reloadPreview()` only on the PERMANENT `cannot-soft-reload`
 * result (no gsap runtime / rebind hook / scopable key / script element, or the
 * re-run threw). The TRANSIENT `verify-failed` is NOT escalated — the live re-run
 * already applied the shift; a remount would re-flash for nothing. When the server
 * returned no `scriptText` (older server, multi-script comp), we also full-reload.
 */
export function syncTimingEditPreview(
  iframe: HTMLIFrameElement | null,
  outcome: GsapMutationOutcome,
  currentTime: number,
  reloadPreview: () => void,
): void {
  if (!iframe || !outcome.scriptText) {
    reloadPreview();
    return;
  }
  const result = applySoftReload(iframe, outcome.scriptText, {
    onAsyncFailure: reloadPreview,
    currentTimeOverride: currentTime,
  });
  if (result === "cannot-soft-reload") reloadPreview();
}

// Re-export applyPatchByTarget for use in the hook (avoids double import in callers)
export { applyPatchByTarget, formatTimelineAttributeNumber };
