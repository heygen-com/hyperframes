import { StudioFileConflictError, type StudioSaveDrainResult } from "./studioSaveDiagnostics";
import { isTypingTarget } from "./typingTarget";

const STUDIO_FLUSH_PENDING_EDITS_EVENT = "hf-studio-flush-pending-edits";

interface StudioFlushPendingEditsDetail {
  promises: Array<Promise<unknown>>;
}

export type StudioPendingEditsDrainResult = StudioSaveDrainResult;

export type StudioEditRevert = () => () => void;

interface PendingEdit {
  revert: StudioEditRevert | null;
  landed: () => Promise<boolean>;
}

const pendingEdits = new Map<Promise<unknown>, PendingEdit>();
const NOT_SAVED = () => Promise.resolve(false);
let adopting = false;

function waitForPostBlurEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function inspectDrainFailures(results: PromiseSettledResult<unknown>[]): {
  conflict?: StudioFileConflictError;
  firstFailure?: PromiseRejectedResult;
} {
  let firstFailure: PromiseRejectedResult | undefined;
  for (const result of results) {
    if (result.status !== "rejected") continue;
    if (result.reason instanceof StudioFileConflictError) return { conflict: result.reason };
    firstFailure ??= result;
  }
  return { firstFailure };
}

function focusedField(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && isTypingTarget(active) ? active : null;
}

export function hasStudioPendingEdits(): boolean {
  return pendingEdits.size > 0 || focusedField() !== null;
}

export function isStudioEditSaving(): boolean {
  return pendingEdits.size > 0;
}

export function afterStudioPendingEdits(run: () => void): () => void {
  let waiting = true;
  const check = () => {
    if (!waiting) return;
    if (isStudioEditSaving()) {
      void Promise.allSettled([...pendingEdits.keys()]).then(check);
      return;
    }
    waiting = false;
    run();
  };
  check();
  return () => {
    waiting = false;
  };
}

export function trackStudioPendingEdit(
  result: Promise<unknown> | unknown,
): Promise<unknown> | undefined {
  if (!result) return undefined;
  const promise = Promise.resolve(result);
  if (adopting) return promise;
  pendingEdits.set(promise, { revert: null, landed: NOT_SAVED });
  promise.then(
    () => pendingEdits.delete(promise),
    () => pendingEdits.delete(promise),
  );
  return promise;
}

export function trackedStudioEdit<Args extends unknown[], R>(
  edit: (...args: Args) => R,
): (...args: Args) => R {
  return (...args) => {
    const result = edit(...args);
    if (result instanceof Promise) trackStudioPendingEdit(result);
    return result;
  };
}

export function beginStudioPendingEdit(revert: StudioEditRevert | null) {
  let settle!: (saved?: Promise<unknown>) => void;
  const promise = trackStudioPendingEdit(new Promise<unknown>((resolve) => (settle = resolve)))!;
  const entry = pendingEdits.get(promise)!;
  entry.revert = revert;
  let landed = Promise.resolve(false);
  entry.landed = () => landed;
  return {
    settle,
    reverted: () => entry.revert === null && revert !== null,
    // Only what `start` registers synchronously is adopted; a registration after an await is a newer edit.
    adopt<T>(start: () => T): T {
      adopting = true;
      try {
        const committed = start();
        landed = Promise.resolve(committed).then(
          () => true,
          () => false,
        );
        return committed;
      } catch (error) {
        settle();
        throw error;
      } finally {
        adopting = false;
      }
    },
  };
}

export function paintBackNewestStudioPendingEdit(): {
  showAgain: () => void;
  landed: () => Promise<boolean>;
} | null {
  const newest = [...pendingEdits.values()].at(-1);
  const revert = newest?.revert;
  if (!newest || !revert) return null;
  newest.revert = null;
  return { showAgain: revert(), landed: newest.landed };
}

export function revertNewestStudioPendingEdit(): (() => void) | null {
  return paintBackNewestStudioPendingEdit()?.showAgain ?? null;
}

export async function flushStudioPendingEdits({
  onlyCurrent = false,
} = {}): Promise<StudioPendingEditsDrainResult> {
  const active = focusedField();
  if (active) {
    active.blur();
    // ponytail: keep blur commits, then cross one task so effects the blur runs can add their listener.
    await Promise.resolve();
    await waitForPostBlurEffects();
  }
  const detail: StudioFlushPendingEditsDetail = { promises: [] };
  window.dispatchEvent(
    new CustomEvent<StudioFlushPendingEditsDetail>(STUDIO_FLUSH_PENDING_EDITS_EVENT, { detail }),
  );
  const current = onlyCurrent ? new Set(pendingEdits.keys()) : null;
  const waiting = () => [...pendingEdits.keys()].filter((edit) => !current || current.has(edit));
  let conflict: StudioFileConflictError | undefined;
  let firstFailure: PromiseRejectedResult | undefined;
  while (detail.promises.length > 0 || waiting().length > 0) {
    const promises = [...detail.promises, ...waiting()];
    detail.promises = [];
    const batchFailures = inspectDrainFailures(await Promise.allSettled(promises));
    conflict ??= batchFailures.conflict;
    firstFailure ??= batchFailures.firstFailure;
  }
  if (conflict) return { status: "conflict", error: conflict };
  return firstFailure ? { status: "failed", error: firstFailure.reason } : { status: "clean" };
}

export function addStudioPendingEditFlushListener(
  handler: () => Promise<unknown> | unknown,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<StudioFlushPendingEditsDetail>).detail;
    if (!detail?.promises) return;
    const promise = trackStudioPendingEdit(handler());
    if (promise) detail.promises.push(promise);
  };
  window.addEventListener(STUDIO_FLUSH_PENDING_EDITS_EVENT, listener);
  return () => window.removeEventListener(STUDIO_FLUSH_PENDING_EDITS_EVENT, listener);
}
