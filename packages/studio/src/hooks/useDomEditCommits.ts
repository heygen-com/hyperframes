import { useCallback } from "react";
import { usePlayerStore } from "../player";
import { FONT_EXT } from "../utils/mediaTypes";
import { applyPatchByTarget } from "../utils/sourcePatcher";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { primaryFontFamilyValue } from "../utils/studioFontHelpers";
import { getDomEditTargetKey, type DomEditSelection } from "../components/editor/domEditing";
import {
  removeStudioManualEditsForSelection,
  type StudioManualEditManifest,
  upsertStudioBoxSizeEdit,
  upsertStudioPathOffsetEdit,
  upsertStudioRotationEdit,
} from "../components/editor/manualEdits";
import {
  removeStudioMotionForSelection,
  type StudioGsapMotion,
  type StudioMotionManifest,
  upsertStudioGsapMotion,
} from "../components/editor/studioMotion";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { EditHistoryKind } from "../utils/editHistory";
import { useDomEditTextCommits } from "./useDomEditTextCommits";

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export type PersistDomEditOperations = (
  selection: DomEditSelection,
  operations: Parameters<typeof applyPatchByTarget>[2][],
  options?: {
    label?: string;
    coalesceKey?: string;
    skipRefresh?: boolean;
    prepareContent?: (html: string, sourceFile: string) => string;
    shouldSave?: () => boolean;
  },
) => Promise<void>;

export interface UseDomEditCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  commitStudioManualEditManifestOptimistically: (
    updateManifest: (manifest: StudioManualEditManifest) => StudioManualEditManifest,
    options: { label: string; coalesceKey: string },
  ) => void;
  commitStudioMotionManifestOptimistically: (
    updateManifest: (manifest: StudioMotionManifest) => StudioMotionManifest,
    options: { label: string; coalesceKey: string },
  ) => void;
  applyCurrentStudioManualEditsToPreview: (iframe: HTMLIFrameElement | null) => void;
  applyCurrentStudioMotionToPreview: (iframe: HTMLIFrameElement | null) => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  editHistory: { recordEdit: (entry: RecordEditInput) => Promise<void> };
  fileTree: string[];
  importedFontAssetsRef: React.MutableRefObject<ImportedFontAsset[]>;
  projectId: string | null;
  projectIdRef: React.MutableRefObject<string | null>;
  reloadPreview: () => void;

  // From useDomSelection
  domEditSelection: DomEditSelection | null;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  domEditGroupSelectionsRef: React.MutableRefObject<DomEditSelection[]>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  clearDomSelection: () => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  refreshDomEditGroupSelectionsFromPreview: (selections: DomEditSelection[]) => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => DomEditSelection | null;
}

// ── Hook ──

export function useDomEditCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  commitStudioManualEditManifestOptimistically,
  commitStudioMotionManifestOptimistically,
  applyCurrentStudioManualEditsToPreview,
  applyCurrentStudioMotionToPreview,
  writeProjectFile,
  domEditSaveTimestampRef,
  editHistory,
  fileTree,
  importedFontAssetsRef,
  projectId,
  projectIdRef,
  reloadPreview,
  domEditSelection,
  domEditGroupSelectionsRef,
  applyDomSelection,
  clearDomSelection,
  refreshDomEditSelectionFromPreview,
  refreshDomEditGroupSelectionsFromPreview,
  buildDomSelectionFromTarget,
}: UseDomEditCommitsParams) {
  const resolveImportedFontAsset = useCallback(
    (fontFamilyValue: string): ImportedFontAsset | null => {
      const family = primaryFontFamilyValue(fontFamilyValue);
      if (!family) return null;
      const imported = importedFontAssetsRef.current.find(
        (font) => font.family.toLowerCase() === family.toLowerCase(),
      );
      if (imported) return imported;
      const asset = fileTree.find(
        (path) =>
          FONT_EXT.test(path) &&
          fontFamilyFromAssetPath(path).toLowerCase() === family.toLowerCase(),
      );
      if (!asset) return null;
      return {
        family: fontFamilyFromAssetPath(asset),
        path: asset,
        url: `/api/projects/${projectId}/preview/${asset}`,
      };
    },
    [fileTree, projectId, importedFontAssetsRef],
  );

  const persistDomEditOperations: PersistDomEditOperations = useCallback(
    async (selection, operations, options) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      let patchedContent = originalContent;
      for (const operation of operations) {
        patchedContent = applyPatchByTarget(patchedContent, selection, operation);
      }
      if (options?.prepareContent) {
        patchedContent = options.prepareContent(patchedContent, targetPath);
      }
      if (options?.shouldSave && !options.shouldSave()) return;

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch ${selection.selector ?? selection.id ?? "selection"}`);
      }

      await saveProjectFilesWithHistory({
        projectId: pid,
        label: options?.label ?? "Edit layer",
        kind: "manual",
        coalesceKey: options?.coalesceKey,
        files: { [targetPath]: patchedContent },
        readFile: async () => originalContent,
        writeFile: writeProjectFile,
        recordEdit: editHistory.recordEdit,
      });

      if (options?.skipRefresh) {
        domEditSaveTimestampRef.current = Date.now();
      } else {
        reloadPreview();
      }
    },
    [
      activeCompPath,
      editHistory.recordEdit,
      writeProjectFile,
      projectIdRef,
      domEditSaveTimestampRef,
      reloadPreview,
    ],
  );

  // ── Text & style commits (delegated to useDomEditTextCommits) ──

  const {
    handleDomStyleCommit,
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
  } = useDomEditTextCommits({
    activeCompPath,
    previewIframeRef,
    domEditSelection,
    applyDomSelection,
    refreshDomEditSelectionFromPreview,
    buildDomSelectionFromTarget,
    persistDomEditOperations,
    resolveImportedFontAsset,
  });

  // ── Manifest commits ──

  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioPathOffsetEdit(manifest, selection, next),
        {
          label: "Move layer",
          coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomGroupPathOffsetCommit = useCallback(
    (updates: DomEditGroupPathOffsetCommit[]) => {
      if (updates.length === 0) return;
      const coalesceKey = updates
        .map((update) => getDomEditTargetKey(update.selection))
        .sort()
        .join(":");
      commitStudioManualEditManifestOptimistically(
        (manifest) =>
          updates.reduce(
            (nextManifest, update) =>
              upsertStudioPathOffsetEdit(nextManifest, update.selection, update.next),
            manifest,
          ),
        {
          label: `Move ${updates.length} layers`,
          coalesceKey: `group-path-offset:${coalesceKey}`,
        },
      );
      refreshDomEditGroupSelectionsFromPreview(domEditGroupSelectionsRef.current);
    },
    [
      commitStudioManualEditManifestOptimistically,
      domEditGroupSelectionsRef,
      refreshDomEditGroupSelectionsFromPreview,
    ],
  );

  const handleDomBoxSizeCommit = useCallback(
    (selection: DomEditSelection, next: { width: number; height: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioBoxSizeEdit(manifest, selection, next),
        {
          label: "Resize layer box",
          coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => upsertStudioRotationEdit(manifest, selection, next),
        {
          label: "Rotate layer",
          coalesceKey: `rotation:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioManualEditManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomManualEditsReset = useCallback(
    (selection: DomEditSelection) => {
      commitStudioManualEditManifestOptimistically(
        (manifest) => removeStudioManualEditsForSelection(manifest, selection),
        {
          label: "Reset layer edits",
          coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        },
      );
      applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
      refreshDomEditSelectionFromPreview(selection);
    },
    [
      applyCurrentStudioManualEditsToPreview,
      commitStudioManualEditManifestOptimistically,
      refreshDomEditSelectionFromPreview,
      previewIframeRef,
    ],
  );

  const handleDomMotionCommit = useCallback(
    (
      selection: DomEditSelection,
      motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
    ) => {
      commitStudioMotionManifestOptimistically(
        (manifest) => upsertStudioGsapMotion(manifest, selection, motion),
        {
          label: "Set GSAP motion",
          coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
        },
      );
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitStudioMotionManifestOptimistically, refreshDomEditSelectionFromPreview],
  );

  const handleDomMotionClear = useCallback(
    (selection: DomEditSelection) => {
      commitStudioMotionManifestOptimistically(
        (manifest) => removeStudioMotionForSelection(manifest, selection),
        {
          label: "Clear GSAP motion",
          coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
        },
      );
      applyCurrentStudioMotionToPreview(previewIframeRef.current);
      refreshDomEditSelectionFromPreview(selection);
    },
    [
      applyCurrentStudioMotionToPreview,
      commitStudioMotionManifestOptimistically,
      refreshDomEditSelectionFromPreview,
      previewIframeRef,
    ],
  );

  const handleDomEditElementDelete = useCallback(
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const label = selection.label || selection.id || selection.selector || selection.tagName;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) throw new Error(`Failed to read ${targetPath}`);

        const data = (await response.json()) as { content?: string };
        const originalContent = data.content;
        if (typeof originalContent !== "string")
          throw new Error(`Missing file contents for ${targetPath}`);

        const patchTarget: { id?: string; selector?: string; selectorIndex?: number } = selection.id
          ? {
              id: selection.id,
              selector: selection.selector,
              selectorIndex: selection.selectorIndex,
            }
          : selection.selector
            ? { selector: selection.selector, selectorIndex: selection.selectorIndex }
            : ({} as never);
        if (!patchTarget.id && !patchTarget.selector) {
          throw new Error("Selected element has no patchable target");
        }

        const removeResponse = await fetch(
          `/api/projects/${pid}/file-mutations/remove-element/${encodeURIComponent(targetPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: patchTarget }),
          },
        );
        if (!removeResponse.ok) throw new Error(`Failed to delete element from ${targetPath}`);

        const removeData = (await removeResponse.json()) as { changed?: boolean; content?: string };
        const patchedContent =
          typeof removeData.content === "string" ? removeData.content : originalContent;

        domEditSaveTimestampRef.current = Date.now();
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

  return {
    resolveImportedFontAsset,
    handleDomStyleCommit,
    handleDomTextCommit,
    commitDomTextFields,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,
    handleDomMotionCommit,
    handleDomMotionClear,
    handleDomEditElementDelete,
  };
}
