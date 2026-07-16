// Soft-reload-first preview sync for timeline timing edits: server GSAP
// position mutations (shift / scale), folding those rewrites into the timing
// edit's undo history, and swapping the rewritten script into the live preview
// without a full iframe reload when possible.
import { type TimelineElement, usePlayerStore } from "../player/store/playerStore";
import { applySoftReload, applySoftReloadFinalization } from "../utils/gsapSoftReload";
import { furthestClipEndFromDocument } from "../player/lib/timelineElementHelpers";
import type { RecordEditInput } from "../utils/studioFileHistory";
import { patchDocumentRootDuration } from "./timelineEditingGsap";

class GsapPreviewConvergenceError extends Error {}
class GsapOwnershipProtocolError extends GsapPreviewConvergenceError {}

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

/** Verify rollback ownership support before any GSAP mutation can land. */
async function requireGsapOwnershipProtocol(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutation-capabilities`,
  );
  if (!response.ok) {
    throw new GsapOwnershipProtocolError("Server does not support owned GSAP mutations");
  }
  const body = await response.json().catch(() => null);
  if (!isRecord(body) || body.atomicOwnershipPairs !== true) {
    throw new GsapOwnershipProtocolError("Invalid GSAP mutation capability response");
  }
}

/** Atomically restore one GSAP mutation only while its exact output still owns
 * the file. The server performs compare + write synchronously, eliminating the
 * client GET→PUT window that could overwrite a successor edit. */
async function rollbackOwnedMutation(
  projectId: string,
  targetPath: string,
  expected: string,
  restore: string,
): Promise<"restored" | "conflict"> {
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    throw new Error(`Unsafe path: ${targetPath}`);
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutation-rollback/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected, restore }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to restore ${targetPath}`);
  }
  const result = (await response.json()) as { restored?: unknown; conflict?: unknown };
  if (result.restored === true && result.conflict === false) return "restored";
  if (result.restored === false && result.conflict === true) return "conflict";
  throw new Error(`Invalid restore response for ${targetPath}`);
}

/** Best-effort live-iframe wrapper for patchDocumentRootDuration (see timelineEditingGsap). */
function patchIframeRootDuration(iframe: HTMLIFrameElement | null, contentEnd: number): void {
  try {
    patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

/** Keep the duration readout and live root aligned with optimistically patched clips. */
export function syncPreviewContentDuration(iframe: HTMLIFrameElement | null): void {
  const end = furthestClipEndFromDocument(iframe?.contentDocument ?? null);
  if (end > 0) {
    usePlayerStore.getState().setDuration(end);
    patchIframeRootDuration(iframe, end);
  }
}

/** Restore both store and live-root duration when a timing persist fails. */
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
 * soft path can't scope) — the caller then full-reloads when `mutated`, or
 * rebinds the runtime timing in place when nothing was rewritten (see
 * syncTimingEditPreview).
 */
export type GsapMutationStatus = {
  mutated: boolean;
  scriptText: string | null;
  /** Atomic whole-file ownership pair returned by the mutation endpoint. */
  before?: string;
  after?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMutationStatus(value: unknown): GsapMutationStatus {
  if (
    !isRecord(value) ||
    typeof value.mutated !== "boolean" ||
    typeof value.before !== "string" ||
    typeof value.after !== "string" ||
    value.mutated !== (value.before !== value.after) ||
    ("changed" in value && value.changed !== value.mutated)
  ) {
    throw new GsapOwnershipProtocolError("Invalid owned GSAP mutation response");
  }
  return {
    mutated: value.mutated,
    scriptText: typeof value.scriptText === "string" ? value.scriptText : null,
    before: value.before,
    after: value.after,
  };
}

function readMutationError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === "string") return value.error;
  return fallback;
}

async function postGsapMutation(
  projectId: string,
  filePath: string,
  mutation: Record<string, unknown>,
  fallback: string,
): Promise<GsapMutationStatus> {
  let response: Response;
  try {
    response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      },
    );
  } catch (error) {
    throw new GsapPreviewConvergenceError(`${fallback}: mutation outcome unknown`, {
      cause: error,
    });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GsapPreviewConvergenceError(readMutationError(body, fallback));
  }
  return readMutationStatus(body);
}

/** Re-derive live timing windows without re-executing composition scripts.
 * Works for zero-GSAP compositions; false asks the caller to full-reload. */
function rebindPreviewTiming(iframe: HTMLIFrameElement | null, currentTime: number): boolean {
  return applySoftReloadFinalization(iframe, currentTime);
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
 * already applied the shift; a remount would re-flash for nothing.
 *
 * `mutated` is the canonical decision, regardless of whether the server echoes
 * the unchanged script text:
 * - `mutated: false` — nothing was rewritten because there was NOTHING TO
 *   REWRITE (the clip has no domId so no id-addressed tweens, the delta was
 *   zero, or the server confirmed a no-op). Every script is unchanged and the
 *   timing attributes are already live-patched, so (when `rebindWhenUnmutated`
 *   allows it) `rebindPreviewTiming` re-seeks + rebinds and the runtime
 *   re-derives the clip windows from the live DOM — no script re-execution,
 *   no full-reload blink. This covers comps with zero GSAP scripts too; only
 *   a missing iframe/runtime hook falls back to the full reload.
 * - `mutated: true` with no script — the file on disk WAS rewritten but the
 *   server returned no script (older server, multi-script comp): the live
 *   script is now stale, so a rebind against it would show wrong positions →
 *   full-reload.
 */
function syncTimingEditPreview(
  iframe: HTMLIFrameElement | null,
  outcome: GsapMutationStatus,
  currentTime: number,
  reloadPreview: () => void,
  rebindWhenUnmutated: boolean,
): void {
  if (!outcome.mutated && rebindWhenUnmutated) {
    if (!rebindPreviewTiming(iframe, currentTime)) reloadPreview();
    return;
  }
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
  /**
   * When the mutation produced no rewrite (mutated:false, no scriptText),
   * rebind the runtime timing in place (no script re-execution) instead of
   * full-reloading (see syncTimingEditPreview). Callers pass false when a full
   * reload is the only sync that reflects everything (e.g. a multi-file group
   * edit).
   */
  rebindWhenUnmutated: boolean;
}): Promise<void> {
  let outcome: GsapMutationStatus = { mutated: false, scriptText: null };
  if (input.gsapMutation) {
    try {
      outcome = await input.gsapMutation();
    } catch (error) {
      input.onGsapError(error);
      // Protocol and ownership conflicts mean the live iframe may no longer
      // represent the bytes that won on disk. Converge explicitly by reloading.
      if (error instanceof GsapPreviewConvergenceError) input.reloadPreview();
      return;
    }
  }
  syncTimingEditPreview(
    input.iframe,
    outcome,
    usePlayerStore.getState().currentTime,
    input.reloadPreview,
    input.rebindWhenUnmutated,
  );
}

// Coalesce window for folding a GSAP mutation into the preceding timing edit; only has to
// outlast one GSAP server round-trip, never a real second edit.
const GSAP_HISTORY_COALESCE_MS = 10_000;

type OwnedMutationStep = {
  path: string;
  before: string;
  after: string;
};

type OwnedMutationRunner = (
  path: string,
  mutation: () => Promise<GsapMutationStatus> | null,
) => Promise<GsapMutationStatus>;

/**
 * Restore successful mutation steps in reverse order through the server's
 * atomic compare-and-restore endpoint. A conflict means a successor owns the
 * file and is deliberately preserved. Conflicts and restore errors require a
 * preview reload; errors are also reported through onError.
 */
async function rollbackMutatedFiles(
  projectId: string,
  ownedSteps: readonly OwnedMutationStep[],
  onError: (error: unknown) => void,
): Promise<"restored" | "convergence-required"> {
  let convergenceRequired = false;
  for (let index = ownedSteps.length - 1; index >= 0; index -= 1) {
    const step = ownedSteps[index];
    if (!step || step.before === step.after) continue;
    try {
      if (
        (await rollbackOwnedMutation(projectId, step.path, step.after, step.before)) === "conflict"
      ) {
        convergenceRequired = true;
      }
    } catch (rollbackError) {
      convergenceRequired = true;
      onError(rollbackError);
    }
  }
  return convergenceRequired ? "convergence-required" : "restored";
}

async function rollbackAfterFailure(
  projectId: string,
  ownedSteps: readonly OwnedMutationStep[],
  onError: (error: unknown) => void,
  originalError: unknown,
): Promise<never> {
  const outcome = await rollbackMutatedFiles(projectId, ownedSteps, onError);
  if (outcome === "convergence-required") {
    throw new GsapPreviewConvergenceError(
      "GSAP rollback could not safely restore every owned write; preview reload required",
      { cause: originalError },
    );
  }
  throw originalError;
}

/**
 * Fold server-owned GSAP rewrites into the preceding timing history entry.
 * Every mutation contributes the atomic before/after pair returned by its
 * endpoint; the first before and last after for each contiguous file chain are
 * the only bytes this transaction may record or roll back.
 */
// The ledger, reverse rollback, final ownership check, and history fold are one
// transaction; extracting phases would obscure which function owns convergence.
// fallow-ignore-next-line complexity
async function foldGsapMutationIntoHistory(input: {
  projectId: string;
  label: string;
  coalesceKey?: string;
  recordEdit: (edit: RecordEditInput) => Promise<void>;
  gsapMutation: (runOwnedMutation: OwnedMutationRunner) => Promise<GsapMutationStatus>;
  onRollbackError: (error: unknown) => void;
}): Promise<GsapMutationStatus> {
  const ownedSteps: OwnedMutationStep[] = [];
  const runOwnedMutation: OwnedMutationRunner = async (path, mutation) => {
    const pending = mutation();
    if (!pending) return { mutated: false, scriptText: null };
    const status = await pending;
    if (!status.mutated) return status;
    if (status.before === undefined || status.after === undefined) {
      throw new GsapOwnershipProtocolError(
        `GSAP mutation returned no owned before/after pair for ${path}`,
      );
    }
    const previous = [...ownedSteps].reverse().find((step) => step.path === path);
    const step = { path, before: status.before, after: status.after };
    ownedSteps.push(step);
    // A foreign writer landed between two same-file mutation steps. The second
    // step already wrote, so keep it in ownedSteps for reverse rollback, then
    // fail rather than folding foreign bytes into this gesture's history.
    if (previous && previous.after !== step.before) {
      throw new Error(`GSAP mutation ownership chain broke for ${path}`);
    }
    return status;
  };
  let status: GsapMutationStatus;
  try {
    await requireGsapOwnershipProtocol(input.projectId);
    status = await input.gsapMutation(runOwnedMutation);
  } catch (error) {
    return rollbackAfterFailure(input.projectId, ownedSteps, input.onRollbackError, error);
  }
  if (status.mutated) {
    try {
      const ownershipByPath = new Map<string, { before: string; after: string }>();
      for (const step of ownedSteps) {
        const owned = ownershipByPath.get(step.path);
        if (owned) owned.after = step.after;
        else ownershipByPath.set(step.path, { before: step.before, after: step.after });
      }
      const files: Record<string, { before: string; after: string }> = {};
      for (const [path, owned] of ownershipByPath) {
        const finalContent = await readFileContent(input.projectId, path);
        if (finalContent !== owned.after) {
          throw new Error(`GSAP mutation ownership lost for ${path}`);
        }
        if (owned.before !== owned.after) {
          files[path] = owned;
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
      return rollbackAfterFailure(input.projectId, ownedSteps, input.onRollbackError, error);
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
  return postGsapMutation(
    projectId,
    filePath,
    {
      type: "shift-positions",
      targetSelector: `#${elementId}`,
      delta,
    },
    "shift-positions failed",
  );
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
  return postGsapMutation(
    projectId,
    filePath,
    {
      type: "scale-positions",
      targetSelector: `#${elementId}`,
      oldStart,
      oldDuration,
      newStart,
      newDuration,
    },
    "scale-positions failed",
  );
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
 * the rewritten script. When there was nothing to rewrite (no domId — e.g. a
 * selector-addressed caption clip — zero delta, or a server no-op) it rebinds
 * the runtime timing in place instead of full-reloading; full reload remains
 * for genuine rewrites without a returned script and for comps the soft path
 * can't handle (see syncTimingEditPreview).
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
              label: input.label,
              coalesceKey: input.coalesceKey,
              recordEdit: input.recordEdit,
              gsapMutation: (runOwnedMutation) =>
                runOwnedMutation(targetPath, () => runMutation(projectId, domId)),
              onRollbackError: onGsapError,
            })
        : undefined,
    onGsapError,
    rebindWhenUnmutated: true,
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
        label: input.label,
        coalesceKey: input.coalesceKey,
        recordEdit: input.recordEdit,
        gsapMutation: async (runOwnedMutation) => {
          let mutated = false;
          let scriptText: GsapMutationStatus["scriptText"] = null;
          for (const change of input.changes) {
            const changePath = input.resolveChangePath(change.element);
            const status = await runOwnedMutation(changePath, () =>
              input.mutateChange(change, changePath),
            );
            mutated = mutated || status.mutated;
            // The LAST mutation against the active comp carries the cumulative
            // rewritten script for that file.
            if (changePath === activePath) scriptText = status.scriptText;
          }
          return { mutated, scriptText: otherFileChanged ? null : scriptText };
        },
        onRollbackError: onGsapError,
      }),
    onGsapError,
    // A batch where nothing needed rewriting (every change was zero-delta or
    // no-domId, e.g. closing a gap over caption clips) still needs the runtime
    // to re-derive clip windows — the in-place timing rebind covers that. But
    // when another file changed, only a full reload reflects every file.
    rebindWhenUnmutated: !otherFileChanged,
  });
}
