import { StudioFileConflictError } from "./studioSaveDiagnostics";

const STUDIO_FLUSH_PENDING_EDITS_EVENT = "hf-studio-flush-pending-edits";

interface StudioFlushPendingEditsDetail {
  promises: Array<Promise<unknown>>;
}

export type StudioPendingEditsDrainResult =
  | { status: "clean" }
  | { status: "conflict"; error: StudioFileConflictError }
  | { status: "failed"; error: unknown };

const pendingEditPromises = new Set<Promise<unknown>>();

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
    // React blur handlers enqueue their save synchronously, while state-driven
    // registrations can land in the next microtask.
    await Promise.resolve();
  }
  const detail: StudioFlushPendingEditsDetail = { promises: [] };
  window.dispatchEvent(
    new CustomEvent<StudioFlushPendingEditsDetail>(STUDIO_FLUSH_PENDING_EDITS_EVENT, { detail }),
  );
  while (detail.promises.length > 0 || pendingEditPromises.size > 0) {
    const promises = [...detail.promises, ...pendingEditPromises];
    detail.promises = [];
    const results = await Promise.allSettled(promises);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) {
      return rejected.reason instanceof StudioFileConflictError
        ? { status: "conflict", error: rejected.reason }
        : { status: "failed", error: rejected.reason };
    }
  }
  return { status: "clean" };
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
