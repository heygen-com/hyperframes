import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";

export type PersistDomEditOperations = (
  selection: DomEditSelection,
  operations: PatchOperation[],
  options?: {
    label?: string;
    coalesceKey?: string;
    skipRefresh?: boolean;
    prepareContent?: (html: string, sourceFile: string) => string;
    shouldSave?: () => boolean;
  },
) => Promise<void>;
