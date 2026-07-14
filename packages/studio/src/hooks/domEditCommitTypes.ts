import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation, PatchTarget } from "../utils/sourcePatcher";

export interface DomEditPatchBatch {
  sourceFile: string;
  patches: Array<{ target: PatchTarget; operations: PatchOperation[] }>;
}

export type CommitDomEditPatchBatches = (
  batches: DomEditPatchBatch[],
  options: {
    label: string;
    coalesceKey: string;
    /** Per-entry undo coalesce window override (ms) — see EditHistoryEntry.coalesceMs. */
    coalesceMs?: number;
    /**
     * Request skipping the preview iframe reload after a successful persist.
     * Only honored when the persist is provably in sync with the live DOM:
     * every patch operation is inline-style-only AND the server matched every
     * patch target. Any unmatched target (or a non-style op) falls back to the
     * reload so the preview reconverges with disk. Default: always reload.
     */
    skipReload?: boolean;
  },
) => Promise<DomEditPatchBatchesResult>;

/**
 * Durability report for a patch-batches commit. `allMatched === false` means
 * the server could not locate at least one patch target on disk — the write is
 * NOT durable for that target (the preview was reloaded to reconverge), and
 * dependent follow-up writes (the z→lane timeline mirror) must be skipped.
 * `changed === false` means every batch was a byte-identical no-op.
 */
export interface DomEditPatchBatchesResult {
  allMatched: boolean;
  changed: boolean;
}

export type PersistDomEditOperations = (
  selection: DomEditSelection,
  operations: PatchOperation[],
  options?: {
    label?: string;
    coalesceKey?: string;
    coalesceMs?: number;
    skipRefresh?: boolean;
    prepareContent?: (html: string, sourceFile: string) => string;
    shouldSave?: () => boolean;
  },
) => Promise<void>;
