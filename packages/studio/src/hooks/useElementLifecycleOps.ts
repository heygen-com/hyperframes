import { useCallback } from "react";
import { usePlayerStore } from "../player";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { createStudioSaveHttpError } from "../utils/studioSaveDiagnostics";
import {
  buildDomEditPatchTarget,
  readHfId,
  type DomEditSelection,
} from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import type { EditHistoryKind } from "../utils/editHistory";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseElementLifecycleOpsParams {
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  projectIdRef: React.MutableRefObject<string | null>;
  reloadPreview: () => void;
  clearDomSelection: () => void;
  commitPositionPatchToHtml: (
    selection: DomEditSelection,
    patches: PatchOperation[],
    options: { label: string; coalesceKey: string; skipRefresh?: boolean },
  ) => Promise<void>;
}

export function useElementLifecycleOps({
  activeCompPath,
  showToast,
  writeProjectFile,
  domEditSaveTimestampRef,
  editHistory,
  projectIdRef,
  reloadPreview,
  clearDomSelection,
  commitPositionPatchToHtml,
}: UseElementLifecycleOpsParams) {
  // fallow-ignore-next-line complexity
  const handleDomEditElementDelete = useCallback(
    // fallow-ignore-next-line complexity
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const label = selection.label || selection.id || selection.selector || selection.tagName;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) {
          throw await createStudioSaveHttpError(response, `Failed to read ${targetPath}`);
        }

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string")
          throw new Error(`Missing file contents for ${targetPath}`);

        const patchTarget = buildDomEditPatchTarget(selection);
        if (!patchTarget.id && !patchTarget.selector && !patchTarget.hfId) {
          throw new Error("Selected element has no patchable target");
        }

        domEditSaveTimestampRef.current = Date.now();
        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) {
          throw await createStudioSaveHttpError(
            removeResponse,
            `Failed to delete element from ${targetPath}`,
          );
        }

        const removeData = (await removeResponse.json()) as { changed?: boolean; content?: string };
        const patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: "Delete element",
          kind: "timeline",
          files: { [targetPath]: patchedContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit: editHistory.recordEdit,
        });

        clearDomSelection();
        usePlayerStore.getState().setSelectedElementId(null);
        reloadPreview();
        showToast(`Deleted ${label}. Use Undo to restore it.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete element";
        showToast(message);
      }
    },
    [
      activeCompPath,
      clearDomSelection,
      domEditSaveTimestampRef,
      editHistory.recordEdit,
      projectIdRef,
      reloadPreview,
      showToast,
      writeProjectFile,
    ],
  );

  const handleDomZIndexReorderCommit = useCallback(
    (
      entries: Array<{
        element: HTMLElement;
        zIndex: number;
        id?: string;
        selector?: string;
        selectorIndex?: number;
        sourceFile: string;
      }>,
    ) => {
      if (entries.length === 0) return;
      const coalesceKey = `z-reorder:${entries.map((e) => e.id ?? e.selector ?? e.element.getAttribute("data-hf-id") ?? "el").join(":")}`;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.element.style.zIndex = String(entry.zIndex);
        const patches: Array<{ type: "inline-style"; property: string; value: string }> = [
          { type: "inline-style", property: "z-index", value: String(entry.zIndex) },
        ];
        try {
          const win = entry.element.ownerDocument?.defaultView;
          if (win && win.getComputedStyle(entry.element).position === "static") {
            entry.element.style.position = "relative";
            patches.push({ type: "inline-style", property: "position", value: "relative" });
          }
        } catch {
          /* cross-origin or detached — skip */
        }
        void commitPositionPatchToHtml(
          {
            element: entry.element,
            id: entry.id ?? null,
            hfId: readHfId(entry.element),
            selector: entry.selector,
            selectorIndex: entry.selectorIndex,
            sourceFile: entry.sourceFile,
          } as unknown as DomEditSelection,
          patches,
          {
            label: "Reorder layers",
            coalesceKey,
            skipRefresh: i < entries.length - 1,
          },
        ).catch(() => undefined);
      }
    },
    [commitPositionPatchToHtml],
  );

  return {
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  };
}
