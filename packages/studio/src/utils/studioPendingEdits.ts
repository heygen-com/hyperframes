import { StudioFileConflictError, type StudioSaveDrainResult } from "./studioSaveDiagnostics";

const STUDIO_FLUSH_PENDING_EDITS_EVENT = "hf-studio-flush-pending-edits";

interface StudioFlushPendingEditsDetail {
  promises: Array<Promise<unknown>>;
}

export type StudioPendingEditsDrainResult = StudioSaveDrainResult;

const pendingEditPromises = new Set<Promise<unknown>>();

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

export function trackStudioPendingEdit(
  result: Promise<unknown> | unknown,
): Promise<unknown> | undefined {
  if (!result) return undefined;
  const promise = Promise.resolve(result);
  pendingEditPromises.add(promise);
  promise.then(
    () => pendingEditPromises.delete(promise),
    () => pendingEditPromises.delete(promise),
  );
  return promise;
}

export async function flushStudioPendingEdits(): Promise<StudioPendingEditsDrainResult> {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  ) {
    active.blur();
    // ponytail: Preserve synchronous/microtask blur commits, then cross one task boundary
    // so React effects triggered by the blur can register their flush listener.
    await Promise.resolve();
    await waitForPostBlurEffects();
  }
  const detail: StudioFlushPendingEditsDetail = { promises: [] };
  window.dispatchEvent(
    new CustomEvent<StudioFlushPendingEditsDetail>(STUDIO_FLUSH_PENDING_EDITS_EVENT, { detail }),
  );
  let firstFailure: PromiseRejectedResult | undefined;
  while (detail.promises.length > 0 || pendingEditPromises.size > 0) {
    const promises = [...detail.promises, ...pendingEditPromises];
    detail.promises = [];
    const results = await Promise.allSettled(promises);
    const batchFailures = inspectDrainFailures(results);
    if (batchFailures.conflict) return { status: "conflict", error: batchFailures.conflict };
    firstFailure ??= batchFailures.firstFailure;
  }
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
