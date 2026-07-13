import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation, PatchTarget } from "../utils/sourcePatcher";

export interface DomEditPatchBatch {
  sourceFile: string;
  patches: Array<{ target: PatchTarget; operations: PatchOperation[] }>;
}

export type CommitDomEditPatchBatches = (
  batches: DomEditPatchBatch[],
  options: { label: string; coalesceKey: string },
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
