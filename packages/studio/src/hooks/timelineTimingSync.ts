// Soft-reload-first preview sync for timeline timing edits: server GSAP
// position mutations (shift / scale), folding those rewrites into the timing
// edit's undo history, and swapping the rewritten script into the live preview
// without a full iframe reload when possible.
import { type TimelineElement, usePlayerStore } from "../player/store/playerStore";
import { applySoftReload } from "../utils/gsapSoftReload";
import { furthestClipEndFromDocument } from "../player/lib/timelineElementHelpers";
import type { RecordEditInput } from "../utils/studioFileHistory";
import { patchDocumentRootDuration } from "./timelineEditingGsap";

export async function readFileContent(projectId: string, targetPath: string): Promise<string> {
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    throw new Error(`Unsafe path: ${targetPath}`);
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(targetPath)}`,
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

/** Best-effort live-iframe wrapper for patchDocumentRootDuration (see timelineEditingGsap). */
function patchIframeRootDuration(iframe: HTMLIFrameElement | null, contentEnd: number): void {
  try {
    patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

/**
 * Optimistically push the composition's content-driven length into the player
 * store right after the live DOM patch, so the duration readout + seek bar
 * update immediately. The readout binds to store.duration (PlayerControls);
 * edits only patched store.elements, so the number stayed frozen (esp. on
 * shrink) until a manual refresh. Read from the just-patched preview DOM (raw
 * data-duration) so it's immune to the runtime's truncated live durations.
 *
 * Also writes the content end into the live root's `data-duration`. Timing
 * edits take the soft-reload path (no full iframe reload), which lets the
 * runtime recompute the length from the root's declared duration and post it
 * back — reading the STALE root would revert this optimistic set.
 */
export function syncPreviewContentDuration(iframe: HTMLIFrameElement | null): void {
  const end = furthestClipEndFromDocument(iframe?.contentDocument ?? null);
  if (end > 0) {
    usePlayerStore.getState().setDuration(end);
    patchIframeRootDuration(iframe, end);
  }
}

/**
 * Snapshot the store duration BEFORE an optimistic duration update
 * (extendRootDurationIfNeeded + syncPreviewContentDuration) and return a
 * rollback closure for the persist-failure path. The rollback restores BOTH
 * the store duration and the live root's `data-duration` — otherwise a failed
 * write leaves the readout/seek bar and the live root advertising a duration
 * the saved source never got. No-op when the duration never changed.
 */
export function captureDurationRollback(iframe: HTMLIFrameElement | null): () => void {
  const previousDuration = usePlayerStore.getState().duration;
  return () => {
    if (usePlayerStore.getState().duration === previousDuration) return;
    usePlayerStore.getState().setDuration(previousDuration);
    patchIframeRootDuration(iframe, previousDuration);
  };
}

/**
 * The bits of the server GSAP-mutation response the timeline edit path needs.
 * `scriptText` is the rewritten root GSAP script — feeding it to `applySoftReload`
 * swaps the runtime timeline in place (no iframe reload = no all-clips flash). Null
 * when the endpoint didn't return one (older server, or a multi-script comp the
 * soft path can't scope), in which case the caller full-reloads as before.
 */
export type GsapMutationStatus = { mutated: boolean; scriptText: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMutationStatus(value: unknown): GsapMutationStatus {
  if (!isRecord(value)) return { mutated: false, scriptText: null };
  return {
    mutated: value.mutated === true || value.changed === true,
    scriptText: typeof value.scriptText === "string" ? value.scriptText : null,
  };
}

function readMutationError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === "string") return value.error;
  return fallback;
}

/**
 * Sync the live preview after a TIMING-ONLY edit (move / resize), preferring a
 * soft reload over the full iframe reload that flashes every clip.
 *
 * Why this is safe WITHOUT re-deriving timeline elements: a move/resize commit has
 * already (a) patched the live DOM timing attributes, (b) updated the store's
 * elements optimistically (the drag commit calls `updateElement` before the
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
function syncTimingEditPreview(
  iframe: HTMLIFrameElement | null,
  outcome: Pick<GsapMutationStatus, "scriptText">,
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

async function finishTimelineTimingFallback(input: {
  iframe: HTMLIFrameElement | null;
  reloadPreview: () => void;
  gsapMutation?: () => Promise<GsapMutationStatus>;
  onGsapError: (error: unknown) => void;
}): Promise<void> {
  let outcome: GsapMutationStatus = { mutated: false, scriptText: null };
  if (input.gsapMutation) {
    try {
      outcome = await input.gsapMutation();
    } catch (error) {
      input.onGsapError(error);
      return;
    }
  }
  syncTimingEditPreview(
    input.iframe,
    outcome,
    usePlayerStore.getState().currentTime,
    input.reloadPreview,
  );
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
 *
 * Failure domains are separate: a MUTATION failure propagates (nothing was applied, so
 * the caller must skip the preview sync), but a failure in the history-FOLD step
 * (re-read / recordEdit) after a successful mutation is surfaced via `onFoldError` and
 * the mutation status is still returned — the server rewrite already landed on disk, so
 * the caller must still sync the preview or it shows stale GSAP positions.
 */
async function foldGsapMutationIntoHistory(input: {
  projectId: string;
  paths: string[];
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  gsapMutation: () => Promise<GsapMutationStatus>;
  onFoldError: (error: unknown) => void;
}): Promise<GsapMutationStatus> {
  const uniquePaths = [...new Set(input.paths)];
  const before = new Map<string, string>();
  // A `before`-snapshot failure propagates like a mutation failure: the mutation
  // has not run yet, so nothing landed on disk and skipping the sync is correct.
  for (const path of uniquePaths) {
    before.set(path, await readFileContent(input.projectId, path));
  }
  const status = await input.gsapMutation();
  if (status.mutated) {
    try {
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
    } catch (error) {
      input.onFoldError(error);
    }
  }
  return status;
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
): Promise<GsapMutationStatus> {
  if (delta === 0 || !elementId) return { mutated: false, scriptText: null };
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(filePath)}`,
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
  if (!elementId || oldDuration <= 0 || newDuration <= 0)
    return { mutated: false, scriptText: null };
  if (oldStart === newStart && oldDuration === newDuration)
    return { mutated: false, scriptText: null };
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(filePath)}`,
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

/** Timing delta a single-clip edit applies to its GSAP tweens. */
export type SingleClipGsapEdit =
  | { kind: "shift"; delta: number }
  | {
      kind: "scale";
      from: { start: number; duration: number };
      to: { start: number; duration: number };
    };

/**
 * Post-persist GSAP sync for a SINGLE-clip timing edit (move / resize): runs the
 * server shift/scale mutation, folds the rewrite into the timing edit's history
 * entry (see foldGsapMutationIntoHistory), then soft-reloads the preview with
 * the rewritten script — full reload when the mutation is skipped, failed, or
 * returned no script.
 */
export function finishClipTimingFallback(input: {
  iframe: HTMLIFrameElement | null;
  reloadPreview: () => void;
  projectId: string | null;
  targetPath: string;
  domId: string | undefined;
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  edit: SingleClipGsapEdit;
}): Promise<void> {
  const { projectId, targetPath, domId, edit } = input;
  const timingChanged =
    edit.kind === "shift"
      ? edit.delta !== 0
      : edit.from.start !== edit.to.start || edit.from.duration !== edit.to.duration;
  const runMutation = (pid: string, id: string): Promise<GsapMutationStatus> =>
    edit.kind === "shift"
      ? shiftGsapPositions(pid, targetPath, id, edit.delta)
      : scaleGsapPositions(
          pid,
          targetPath,
          id,
          edit.from.start,
          edit.from.duration,
          edit.to.start,
          edit.to.duration,
        );
  const onGsapError = (err: unknown) =>
    console.error(`[Timeline] Failed to ${edit.kind} GSAP positions`, err);
  return finishTimelineTimingFallback({
    iframe: input.iframe,
    reloadPreview: input.reloadPreview,
    gsapMutation:
      timingChanged && domId && projectId
        ? () =>
            foldGsapMutationIntoHistory({
              projectId,
              paths: [targetPath],
              label: input.label,
              coalesceKey: input.coalesceKey,
              recordEdit: input.recordEdit,
              gsapMutation: () => runMutation(projectId, domId),
              onFoldError: onGsapError,
            })
        : undefined,
    onGsapError,
  });
}

/**
 * Shared post-persist GSAP sync for GROUP timing edits (move / resize): runs the
 * per-change server mutation for every changed clip, folds the rewrites into the
 * timing edit's history entry, and soft-reloads the preview when possible.
 *
 * The preview is a SINGLE shared iframe showing the ACTIVE composition, so only
 * the active comp's rewritten script can be soft-reloaded (swapped in place, no
 * all-clips flash). If any OTHER file changed too — e.g. a sub-comp group in a
 * multi-file move — no scriptText is passed, so the fallback does ONE full
 * reload that reflects every changed file.
 */
export async function finishGroupTimingGsapFallback<C extends { element: TimelineElement }>(input: {
  projectId: string;
  iframe: HTMLIFrameElement | null;
  reloadPreview: () => void;
  label: string;
  errorLabel: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  activeCompPath: string | null;
  changes: readonly C[];
  resolveChangePath: (element: TimelineElement) => string;
  /** Per-change GSAP mutation; return null to skip a change with no timing delta. */
  mutateChange: (change: C, changePath: string) => Promise<GsapMutationStatus> | null;
}): Promise<void> {
  const activePath = input.activeCompPath || "index.html";
  const otherFileChanged = input.changes.some(
    (change) => input.resolveChangePath(change.element) !== activePath,
  );
  const onGsapError = (err: unknown) => console.error(`[Timeline] ${input.errorLabel}`, err);
  await finishTimelineTimingFallback({
    iframe: input.iframe,
    reloadPreview: input.reloadPreview,
    gsapMutation: () =>
      foldGsapMutationIntoHistory({
        projectId: input.projectId,
        paths: input.changes.map((change) => input.resolveChangePath(change.element)),
        label: input.label,
        coalesceKey: input.coalesceKey,
        recordEdit: input.recordEdit,
        gsapMutation: async () => {
          let mutated = false;
          let scriptText: GsapMutationStatus["scriptText"] = null;
          for (const change of input.changes) {
            const changePath = input.resolveChangePath(change.element);
            const pending = input.mutateChange(change, changePath);
            if (!pending) continue;
            const status = await pending;
            mutated = mutated || status.mutated;
            // The LAST mutation against the active comp carries the cumulative
            // rewritten script for that file.
            if (changePath === activePath) scriptText = status.scriptText;
          }
          return { mutated, scriptText: otherFileChanged ? null : scriptText };
        },
        onFoldError: onGsapError,
      }),
    onGsapError,
  });
}
