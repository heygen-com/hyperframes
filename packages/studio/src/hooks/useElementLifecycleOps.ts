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
  /** Route delete through SDK when session resolves the hf-id; returns true if handled. */
  onTrySdkDelete?: (hfId: string, originalContent: string, targetPath: string) => Promise<boolean>;
  /** Resolver-shadow tripwire for the reordered targets (telemetry-only, decoupled from cutover). */
  onReorderShadow?: (targets: string[]) => void;
  /** Resync the SDK session after a server-fallback delete. */
  forceReloadSdkSession?: () => void;
  commitPositionPatchToHtml: (
    selection: DomEditSelection,
    patches: PatchOperation[],
    options: { label: string; coalesceKey: string; skipRefresh?: boolean },
  ) => Promise<void>;
  /** Stage 7 Step 3b: called after a successful server-side element delete (shadow). */
  onElementDeleted?: (selection: DomEditSelection) => void;
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
  onTrySdkDelete,
  onReorderShadow,
  forceReloadSdkSession,
  commitPositionPatchToHtml,
  onElementDeleted,
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

        if (onTrySdkDelete && selection.hfId) {
          const handled = await onTrySdkDelete(selection.hfId, originalContent, targetPath);
          if (handled) {
            clearDomSelection();
            usePlayerStore.getState().setSelectedElementId(null);
            showToast(`Deleted ${label}. Use Undo to restore it.`, "info");
            return;
          }
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
        // ponytail: the server remove-element route (removeElementFromHtml) strips
        // only the element node — it does NOT cascade-remove GSAP tweens targeting
        // it, unlike the SDK path (removeElement → cascadeRemoveAnimations). This
        // fallback runs only when the element isn't in the SDK doc (e.g. runtime-
        // generated / unaddressable), where targeting tweens are unlikely. Upgrade
        // path: cascade in removeElementFromHtml by selector/hf-id to fully match.
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
        // Server wrote the file; resync the stale in-memory SDK doc so a later
        // SDK edit doesn't resurrect the deleted element.
        forceReloadSdkSession?.();
        reloadPreview();
        onElementDeleted?.(selection);
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
      onTrySdkDelete,
      onElementDeleted,
      forceReloadSdkSession,
      projectIdRef,
      reloadPreview,
      showToast,
      writeProjectFile,
    ],
  );

  // ponytail: z-index reorder writes inline-style patches via commitPositionPatchToHtml →
  // persistDomEditOperations → onTrySdkPersist, so it is already SDK-cut-over as setStyle.
  // No SDK reorder/reparent op exists; DOM sibling order stays server-authoritative if ever needed.
  const handleDomZIndexReorderCommit = useCallback(
    // fallow-ignore-next-line complexity
    (
      entries: Array<{
        element: HTMLElement;
        zIndex: number;
        id?: string;
        selector?: string;
        selectorIndex?: number;
        sourceFile: string;
        key?: string;
      }>,
    ) => {
      if (entries.length === 0) return Promise.resolve();
      // Resolver shadow (telemetry-only, decoupled from cutover): record whether
      // the SDK resolves each reordered element — the reorderElements op's targets.
      onReorderShadow?.(
        entries.map((e) => readHfId(e.element)).filter((id): id is string => id != null),
      );
      const coalesceKey = `z-reorder:${entries.map((e) => e.id ?? e.selector ?? e.element.getAttribute("data-hf-id") ?? "el").join(":")}`;
      const saves: Array<Promise<void>> = [];
      const rollbacks: Array<() => void> = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const priorZIndex = entry.element.style.zIndex;
        const priorPosition = entry.element.style.position;
        const priorStoreEntry = entry.key
          ? usePlayerStore.getState().elements.find((el) => (el.key ?? el.id) === entry.key)
          : undefined;
        let positionChanged = false;
        entry.element.style.zIndex = String(entry.zIndex);
        const patches: Array<{ type: "inline-style"; property: string; value: string }> = [
          { type: "inline-style", property: "z-index", value: String(entry.zIndex) },
        ];
        try {
          const win = entry.element.ownerDocument?.defaultView;
          if (win && win.getComputedStyle(entry.element).position === "static") {
            entry.element.style.position = "relative";
            positionChanged = true;
            patches.push({ type: "inline-style", property: "position", value: "relative" });
          }
        } catch {
          /* cross-origin or detached — skip */
        }
        if (entry.key) {
          usePlayerStore
            .getState()
            .updateElement(entry.key, { zIndex: entry.zIndex, hasExplicitZIndex: true });
        }
        rollbacks.push(() => {
          entry.element.style.zIndex = priorZIndex;
          if (positionChanged) entry.element.style.position = priorPosition;
          if (entry.key && priorStoreEntry) {
            usePlayerStore.getState().updateElement(entry.key, {
              zIndex: priorStoreEntry.zIndex,
              hasExplicitZIndex: priorStoreEntry.hasExplicitZIndex,
            });
          }
        });
        saves.push(
          commitPositionPatchToHtml(
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
          ),
        );
      }
      // Resolves once every z-index patch is persisted so a same-file timing write
      // can be ordered after it (see applyTimelineStackingReorder callers).
      return Promise.allSettled(saves).then((settled) => {
        const rejected = settled.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) {
          for (const rollback of rollbacks) rollback();
          return Promise.reject(rejected.reason);
        }
        return undefined;
      });
    },
    [commitPositionPatchToHtml, onReorderShadow],
  );

  return {
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  };
}
