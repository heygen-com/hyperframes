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
    /**
     * Request skipping the preview iframe reload after a successful persist.
     * Only honored when the persist is provably in sync with the live DOM:
     * every patch operation is inline-style-only AND the server matched every
     * patch target. Any unmatched target (or a non-style op) falls back to the
     * reload so the preview reconverges with disk. Default: always reload.
     */
    skipReload?: boolean;
  },
) => Promise<void>;

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
