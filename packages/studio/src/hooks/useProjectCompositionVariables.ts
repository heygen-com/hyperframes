import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { openComposition, type Composition, type CompositionVariable } from "@hyperframes/sdk";
import { persistSdkSerialize } from "../utils/sdkCutover";
import type { EditHistoryKind } from "../utils/editHistory";

/** Records an edit into the studio's undo history (label + kind + per-file before/after). */
export type RecordEditFn = (entry: {
  label: string;
  kind: EditHistoryKind;
  files: Record<string, { before: string; after: string }>;
}) => Promise<void>;

export interface CompositionVariableGroup {
  /** Project-relative file path, e.g. "compositions/frames/02-problem.html". */
  path: string;
  /** The composition's variable declarations (empty groups are dropped by the hook). */
  variables: CompositionVariable[];
}

/** Read one composition file's declarations, or null to skip (unreadable / none / unparseable). */
// fallow-ignore-next-line complexity
async function readGroup(
  path: string,
  readProjectFile: (path: string) => Promise<string>,
): Promise<CompositionVariableGroup | null> {
  let content: string;
  try {
    content = await readProjectFile(path);
  } catch {
    return null;
  }
  if (!content.includes("data-composition-variables")) return null;
  try {
    const comp = await openComposition(content, { history: false });
    try {
      const variables = comp.getVariableDeclarations();
      return variables.length > 0 ? { path, variables } : null;
    } finally {
      comp.dispose();
    }
  } catch {
    return null; // Unparseable composition — skip rather than break the whole panel.
  }
}

/**
 * Read variable declarations from every composition file in the project except
 * `excludePath` (the active composition, which the panel renders with its full
 * preview/add controls). Powers the Variables tab's "other compositions"
 * sections so a variable promoted into a sub-comp file is visible alongside the
 * host's own. Re-reads whenever `refreshKey` changes (after an edit or preview
 * reload). A cheap substring guard skips files with no declarations before the
 * full parse, so large projects don't pay N openComposition calls.
 */
export function useProjectCompositionVariables(
  fileTree: string[],
  excludePath: string | null,
  readProjectFile: (path: string) => Promise<string>,
  refreshKey: unknown,
): CompositionVariableGroup[] {
  const [groups, setGroups] = useState<CompositionVariableGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    const htmlFiles = fileTree.filter((p) => p.endsWith(".html") && p !== excludePath);

    void (async () => {
      const out: CompositionVariableGroup[] = [];
      for (const path of htmlFiles) {
        const group = await readGroup(path, readProjectFile);
        if (group) out.push(group);
      }
      if (!cancelled) setGroups(out);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree, excludePath, readProjectFile, refreshKey]);

  return groups;
}

interface EditVariablesDeps {
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: RecordEditFn;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
}

/**
 * Apply a variable-schema mutation to an arbitrary composition file (a sub-comp
 * that isn't the active SDK session) and persist it through the standard
 * single-writer path. Opens a throwaway session on the file, runs `mutate`,
 * and writes the serialized result — the same contract as useVariablesPersist,
 * but keyed on `path` rather than a live session.
 */
export function useEditVariablesInFile(deps: EditVariablesDeps) {
  const { readProjectFile, writeProjectFile, recordEdit, reloadPreview, domEditSaveTimestampRef } =
    deps;
  return useCallback(
    async (path: string, label: string, mutate: (session: Composition) => void): Promise<void> => {
      const originalContent = await readProjectFile(path);
      const comp = await openComposition(originalContent, { history: false });
      let after: string;
      try {
        mutate(comp);
        after = comp.serialize();
      } finally {
        comp.dispose();
      }
      if (after === originalContent) return;
      await persistSdkSerialize(
        after,
        path,
        originalContent,
        {
          editHistory: { recordEdit },
          writeProjectFile,
          reloadPreview,
          domEditSaveTimestampRef,
          compositionPath: path,
        },
        { label },
      );
    },
    [readProjectFile, writeProjectFile, recordEdit, reloadPreview, domEditSaveTimestampRef],
  );
}
