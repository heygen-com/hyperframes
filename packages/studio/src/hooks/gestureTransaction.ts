import type {
  CommitMutation,
  CommitMutationCall,
  CommitMutationOptions,
} from "./gsapScriptCommitTypes";
import { trackStudioEvent } from "../utils/studioTelemetry";

type PixelRect = Pick<DOMRect, "x" | "y" | "width" | "height">;

export type TxCommit = (commitMutation: CommitMutation) => CommitMutation;

export interface GestureTransaction {
  element: HTMLElement;
  label: string;
  settle(): void;
  persist(commit: TxCommit): Promise<void>;
  restore(): void;
  skipPixelAssert?: boolean;
}

let transactionCounter = 0;
const transactionCommits = new WeakSet<CommitMutation>();

/** Whether a commit function already belongs to an active gesture transaction. */
export function isGestureTransactionCommit(commitMutation: CommitMutation): boolean {
  return transactionCommits.has(commitMutation);
}

function readPixelRect(element: HTMLElement): PixelRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function transactionOptions(
  options: CommitMutationOptions,
  coalesceKey: string,
  label: string,
): CommitMutationOptions {
  // The transaction owns the undo label: every wrapped mutation records under
  // `label`, so the coalesced entry reads as the gesture (e.g. "Resize layer")
  // rather than whichever sub-mutation happened to land last (the offset
  // persist's "Move layer").
  const { coalesceKey: _coalesceKey, skipReload: _skipReload, softReload, ...rest } = options;
  return softReload
    ? { ...rest, label, softReload: true, coalesceKey, coalesceMs: Number.POSITIVE_INFINITY }
    : { ...rest, label, skipReload: true, coalesceKey, coalesceMs: Number.POSITIVE_INFINITY };
}

function pixelDelta(before: PixelRect, after: PixelRect): PixelRect {
  return {
    x: after.x - before.x,
    y: after.y - before.y,
    width: after.width - before.width,
    height: after.height - before.height,
  };
}

function exceedsPixelTolerance(delta: PixelRect): boolean {
  return Object.values(delta).some((value) => Math.abs(value) > 1);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

type BufferedCommit = CommitMutationCall & { dispatch: CommitMutation };

function mergeTransactionOptions(calls: BufferedCommit[]): CommitMutationOptions {
  const reloadCall = calls.find(({ options }) => options.softReload);
  const source = reloadCall?.options ?? calls.at(-1)?.options;
  if (!source) throw new Error("Cannot merge an empty gesture transaction");
  const { skipReload: _skipReload, instantPatch: _instantPatch, ...options } = source;
  return reloadCall ? { ...options, softReload: true } : { ...options, skipReload: true };
}

/**
 * Dispatch a transaction's buffered commits and return the number of preview
 * reloads that ACTUALLY happened — a batch collapses every buffered softReload
 * into one reload, so reload telemetry reflects the real cost, not the count of
 * softReload requests.
 */
function reloadsRequested(calls: BufferedCommit[]): number {
  return calls.filter(({ options }) => options.softReload).length;
}

async function dispatchBufferedCommits(calls: BufferedCommit[]): Promise<number> {
  const first = calls[0];
  if (!first) return 0;
  if (calls.length === 1) {
    await first.dispatch(first.selection, first.mutation, first.options);
    return reloadsRequested(calls);
  }
  const canBatch = calls.every(
    ({ dispatch, selection }) =>
      dispatch === first.dispatch && selection.sourceFile === first.selection.sourceFile,
  );
  if (canBatch && first.dispatch.batch) {
    await first.dispatch.batch(
      calls.map(({ selection, mutation, options }) => ({ selection, mutation, options })),
      mergeTransactionOptions(calls),
    );
    // One server write, one reload — the reload count collapses with the batch.
    return reloadsRequested(calls) > 0 ? 1 : 0;
  }
  for (const { dispatch, selection, mutation, options } of calls) {
    await dispatch(selection, mutation, options);
  }
  return reloadsRequested(calls);
}

/**
 * Dev-only [hf-commit] lifecycle trace. The production observability lives in
 * the trackStudioEvent commit_* events (always on); these console lines are a
 * developer aid and stay out of end users' consoles.
 */
function traceCommit(stage: string, data: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.info(`[hf-commit] ${stage}`, data);
}

/**
 * Owns the visual + persistence + history lifecycle for one gesture release.
 * `settle` deliberately runs before the first promise is created or awaited.
 */
export function runGestureTransaction(tx: GestureTransaction): Promise<void> {
  const startedAt = performance.now();
  const coalesceKey = `tx:${tx.label}:${++transactionCounter}`;
  let mutationCount = 0;
  let reloadCount = 0;
  const bufferedCommits: BufferedCommit[] = [];
  traceCommit("start", { label: tx.label, coalesceKey });
  tx.settle();
  traceCommit("settled", { label: tx.label, coalesceKey });

  const before = !tx.skipPixelAssert ? readPixelRect(tx.element) : null;
  const commit: TxCommit = (commitMutation) => {
    const wrapped: CommitMutation = (selection, mutation, options) => {
      mutationCount += 1;
      bufferedCommits.push({
        dispatch: commitMutation,
        selection,
        mutation,
        options: transactionOptions(options, coalesceKey, tx.label),
      });
      return Promise.resolve();
    };
    transactionCommits.add(wrapped);
    return wrapped;
  };

  return tx
    .persist(commit)
    .then(async () => {
      reloadCount = await dispatchBufferedCommits(bufferedCommits);
      const durationMs = Math.round(performance.now() - startedAt);
      traceCommit("persisted", { label: tx.label, coalesceKey });
      if (before) {
        const after = readPixelRect(tx.element);
        const delta = pixelDelta(before, after);
        if (exceedsPixelTolerance(delta)) {
          if (import.meta.env.DEV) {
            console.error("[hf-commit] persist changed pixels", {
              label: tx.label,
              before,
              after,
              delta,
            });
          }
          trackStudioEvent("commit_invariant_violation", {
            label: tx.label,
            delta_x: roundToOneDecimal(delta.x),
            delta_y: roundToOneDecimal(delta.y),
            delta_w: roundToOneDecimal(delta.width),
            delta_h: roundToOneDecimal(delta.height),
            mutation_count: mutationCount,
            reload_count: reloadCount,
            duration_ms: durationMs,
          });
        }
      }
      trackStudioEvent("commit_transaction", {
        label: tx.label,
        mutation_count: mutationCount,
        reload_count: reloadCount,
        duration_ms: durationMs,
        pixel_asserted: before !== null,
      });
    })
    .catch((error: unknown) => {
      tx.restore();
      trackStudioEvent("commit_transaction_failed", {
        label: tx.label,
        mutation_count: mutationCount,
        error_name: error instanceof Error ? error.name : "unknown",
        restore_ran: true,
      });
      traceCommit("restore", { label: tx.label, coalesceKey });
      throw error;
    });
}
