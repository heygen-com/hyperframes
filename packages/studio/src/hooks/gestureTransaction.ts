import type { CommitMutation, CommitMutationOptions } from "./gsapScriptCommitTypes";
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

/**
 * Owns the visual + persistence + history lifecycle for one gesture release.
 * `settle` deliberately runs before the first promise is created or awaited.
 */
export function runGestureTransaction(tx: GestureTransaction): Promise<void> {
  const startedAt = performance.now();
  const coalesceKey = `tx:${tx.label}:${++transactionCounter}`;
  let mutationCount = 0;
  let reloadCount = 0;
  console.info("[hf-commit] start", { label: tx.label, coalesceKey });
  tx.settle();
  console.info("[hf-commit] settled", { label: tx.label, coalesceKey });

  const before = !tx.skipPixelAssert ? readPixelRect(tx.element) : null;
  const commit: TxCommit = (commitMutation) => {
    const wrapped: CommitMutation = (selection, mutation, options) => {
      mutationCount += 1;
      if (options.softReload) reloadCount += 1;
      return commitMutation(
        selection,
        mutation,
        transactionOptions(options, coalesceKey, tx.label),
      );
    };
    transactionCommits.add(wrapped);
    return wrapped;
  };

  return tx
    .persist(commit)
    .then(() => {
      const durationMs = Math.round(performance.now() - startedAt);
      console.info("[hf-commit] persisted", { label: tx.label, coalesceKey });
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
      console.info("[hf-commit] restore", { label: tx.label, coalesceKey });
      throw error;
    });
}
