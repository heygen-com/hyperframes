import { useCallback, useRef } from "react";
import { usePlayerStore } from "../player";
import { FONT_EXT } from "../utils/mediaTypes";
import type { PatchOperation } from "../utils/sourcePatcher";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { primaryFontFamilyValue } from "../utils/studioFontHelpers";
import { getDomEditTargetKey, type DomEditSelection } from "../components/editor/domEditing";
import {
  applyStudioPathOffset,
  applyStudioBoxSize,
  applyStudioRotation,
  clearStudioPathOffset,
  clearStudioBoxSize,
  clearStudioRotation,
} from "../components/editor/manualEdits";
import {
  buildPathOffsetPatches,
  buildBoxSizePatches,
  buildRotationPatches,
  buildClearPathOffsetPatches,
  buildClearBoxSizePatches,
  buildClearRotationPatches,
  buildMotionPatches,
  buildClearMotionPatches,
} from "../components/editor/manualEditsDom";
import {
  writeStudioMotionToElement,
  clearStudioMotionFromElement,
  applyStudioMotionFromDom,
  type StudioGsapMotion,
} from "../components/editor/studioMotion";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { EditHistoryKind } from "../utils/editHistory";
import { useDomEditTextCommits } from "./useDomEditTextCommits";

// ── Helpers ──

type TimelineLike = { getChildren?: (nested: boolean) => Array<{ targets?: () => Element[] }> };

function isElementGsapTargeted(iframe: HTMLIFrameElement | null, element: HTMLElement): boolean {
  if (!iframe?.contentWindow) return false;
  let timelines: Record<string, TimelineLike> | undefined;
  try {
    timelines = (iframe.contentWindow as Window & { __timelines?: Record<string, TimelineLike> })
      .__timelines;
  } catch {
    return false;
  }
  if (!timelines) return false;
  const id = element.id;
  for (const tl of Object.values(timelines)) {
    if (!tl?.getChildren) continue;
    try {
      for (const child of tl.getChildren(true)) {
        if (!child.targets) continue;
        for (const t of child.targets()) {
          if (t === element || (id && t.id === id)) return true;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

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

export interface UseDomEditCommitsParams {
  activeCompPath: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  queueDomEditSave: (save: () => Promise<void>) => Promise<void>;
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
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  clearDomSelection: () => void;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
}

// ── Hook ──

export function useDomEditCommits({
  activeCompPath,
  previewIframeRef,
  showToast,
  queueDomEditSave,
  writeProjectFile,
  domEditSaveTimestampRef,
  editHistory,
  fileTree,
  importedFontAssetsRef,
  projectId,
  projectIdRef,
  reloadPreview,
  domEditSelection,
  applyDomSelection,
  clearDomSelection,
  refreshDomEditSelectionFromPreview,
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

  const reportedUnresolvableRef = useRef(new Set<string>());

  // fallow-ignore-next-line complexity
  const persistDomEditOperations: PersistDomEditOperations = useCallback(
    async (selection, operations, options) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";

      const readResponse = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
      );
      if (!readResponse.ok) throw new Error(`Failed to read ${targetPath}`);
      const readData = (await readResponse.json()) as { content?: string };
      const originalContent = readData.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      if (options?.shouldSave && !options.shouldSave()) return;

      const patchTarget: { id?: string | null; selector?: string; selectorIndex?: number } = {
        id: selection.id,
        selector: selection.selector,
        selectorIndex: selection.selectorIndex,
      };

      // Mark the save timestamp before the file write so the SSE file-change
      // handler suppresses the reload even if the event arrives before the
      // response (the server writes the file and emits SSE during the fetch).
      domEditSaveTimestampRef.current = Date.now();

      const patchResponse = await fetch(
        `/api/projects/${pid}/file-mutations/patch-element/${encodeURIComponent(targetPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: patchTarget, operations }),
        },
      );
      if (!patchResponse.ok) throw new Error(`Failed to patch ${targetPath}`);

      const patchData = (await patchResponse.json()) as {
        ok?: boolean;
        changed?: boolean;
        matched?: boolean;
        content?: string;
      };

      if (!patchData.changed) {
        if (patchData.matched === false) {
          const targetKey = selection.selector ?? selection.id ?? "selection";
          if (!reportedUnresolvableRef.current.has(targetKey)) {
            reportedUnresolvableRef.current.add(targetKey);
            trackStudioEvent("save_skipped_unresolvable", {
              target_id: selection.id ?? undefined,
              target_selector: selection.selector ?? undefined,
              target_source_file: selection.sourceFile ?? undefined,
              composition: activeCompPath ?? undefined,
            });
            console.warn(
              `[studio] Element not found in source: ${targetKey}. ` +
                "This element may be generated at runtime and cannot be persisted.",
            );
          }
        }
        return;
      }

      const patchedContent =
        typeof patchData.content === "string" ? patchData.content : originalContent;

      let finalContent = patchedContent;
      if (options?.prepareContent) {
        finalContent = options.prepareContent(patchedContent, targetPath);
        if (finalContent !== patchedContent) {
          await writeProjectFile(targetPath, finalContent);
        }
      }

      await editHistory.recordEdit({
        label: options?.label ?? "Edit layer",
        kind: "manual",
        coalesceKey: options?.coalesceKey,
        files: { [targetPath]: { before: originalContent, after: finalContent } },
      });

      if (!options?.skipRefresh) {
        reloadPreview();
      }
    },
    [
      activeCompPath,
      editHistory,
      writeProjectFile,
      projectIdRef,
      domEditSaveTimestampRef,
      reloadPreview,
    ],
  );

  // ── Text & style commits (delegated to useDomEditTextCommits) ──

  const {
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomHtmlAttributeCommit,
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

  // ── Position patch helper ──

  // fallow-ignore-next-line complexity
  const commitPositionPatchToHtml = useCallback(
    (
      selection: DomEditSelection,
      patches: PatchOperation[],
      options: { label: string; coalesceKey: string; skipRefresh?: boolean },
    ) => {
      void queueDomEditSave(async () => {
        await persistDomEditOperations(selection, patches, {
          label: options.label,
          coalesceKey: options.coalesceKey,
          skipRefresh: options.skipRefresh ?? true,
        });
        // fallow-ignore-next-line complexity
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to save position";
        showToast(message);
        trackStudioEvent("save_failure", {
          source: "dom_edit",
          label: options.label,
          error_message: message,
          target_id: selection.id ?? undefined,
          target_selector: selection.selector ?? undefined,
          target_source_file: selection.sourceFile ?? undefined,
        });
      });
    },
    [persistDomEditOperations, queueDomEditSave, showToast],
  );

  // ── Position commits ──

  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      applyStudioPathOffset(selection.element, next);
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) return;
      commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
        label: "Move layer",
        coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef],
  );

  const handleDomGroupPathOffsetCommit = useCallback(
    (updates: DomEditGroupPathOffsetCommit[]) => {
      if (updates.length === 0) return;
      const coalesceKey = updates
        .map((u) => getDomEditTargetKey(u.selection))
        .sort()
        .join(":");
      for (const { selection, next } of updates) {
        applyStudioPathOffset(selection.element, next);
        if (isElementGsapTargeted(previewIframeRef.current, selection.element)) continue;
        commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
          label: `Move ${updates.length} layers`,
          coalesceKey: `group-path-offset:${coalesceKey}`,
        });
      }
    },
    [commitPositionPatchToHtml, previewIframeRef],
  );

  const handleDomBoxSizeCommit = useCallback(
    (selection: DomEditSelection, next: { width: number; height: number }) => {
      applyStudioBoxSize(selection.element, next);
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) return;
      commitPositionPatchToHtml(selection, buildBoxSizePatches(selection.element), {
        label: "Resize layer box",
        coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) => {
      applyStudioRotation(selection.element, next);
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) return;
      commitPositionPatchToHtml(selection, buildRotationPatches(selection.element), {
        label: "Rotate layer",
        coalesceKey: `rotation:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef],
  );

  const handleDomManualEditsReset = useCallback(
    (selection: DomEditSelection) => {
      const element = selection.element;
      const clearPatches = [
        ...buildClearPathOffsetPatches(element),
        ...buildClearBoxSizePatches(element),
        ...buildClearRotationPatches(element),
      ];
      clearStudioPathOffset(element);
      clearStudioBoxSize(element);
      clearStudioRotation(element);
      // skipRefresh:false triggers reloadPreview() which re-syncs selection on load
      commitPositionPatchToHtml(selection, clearPatches, {
        label: "Reset layer edits",
        coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        skipRefresh: false,
      });
    },
    [commitPositionPatchToHtml],
  );

  // ── Motion commits (HTML-attribute–backed) ──

  // fallow-ignore-next-line complexity
  const handleDomMotionCommit = useCallback(
    (
      selection: DomEditSelection,
      motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
    ) => {
      // 1. Write motion data as JSON attribute on the element
      writeStudioMotionToElement(selection.element, motion);
      // 2. Apply the GSAP timeline from DOM attributes
      let doc: Document | null = null;
      try {
        doc = previewIframeRef.current?.contentDocument ?? null;
      } catch {
        // cross-origin guard
      }
      if (doc) applyStudioMotionFromDom(doc);
      // 3. Build patches and persist to HTML
      const patches = buildMotionPatches(selection.element);
      commitPositionPatchToHtml(selection, patches, {
        label: "Set GSAP motion",
        coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
      });
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitPositionPatchToHtml, previewIframeRef, refreshDomEditSelectionFromPreview],
  );

  // fallow-ignore-next-line complexity
  const handleDomMotionClear = useCallback(
    (selection: DomEditSelection) => {
      const clearPatches = buildClearMotionPatches(selection.element);
      // Get gsap from the preview window for proper cleanup
      let gsap: { set?: (target: HTMLElement, vars: Record<string, unknown>) => void } | undefined;
      try {
        gsap = (previewIframeRef.current?.contentWindow as { gsap?: typeof gsap })?.gsap;
      } catch {
        // cross-origin guard
      }
      clearStudioMotionFromElement(selection.element, gsap);
      let doc: Document | null = null;
      try {
        doc = previewIframeRef.current?.contentDocument ?? null;
      } catch {
        // cross-origin guard
      }
      if (doc) applyStudioMotionFromDom(doc);
      commitPositionPatchToHtml(selection, clearPatches, {
        label: "Clear GSAP motion",
        coalesceKey: `motion:${getDomEditTargetKey(selection)}`,
        skipRefresh: false,
      });
      refreshDomEditSelectionFromPreview(selection);
    },
    [commitPositionPatchToHtml, previewIframeRef, refreshDomEditSelectionFromPreview],
  );

  // fallow-ignore-next-line complexity
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

        domEditSaveTimestampRef.current = Date.now();
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
      const coalesceKey = `z-reorder:${entries.map((e) => e.id ?? e.selector ?? "el").join(":")}`;
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
        commitPositionPatchToHtml(
          {
            element: entry.element,
            id: entry.id ?? null,
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
        );
      }
    },
    [commitPositionPatchToHtml],
  );

  return {
    resolveImportedFontAsset,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomHtmlAttributeCommit,
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
    handleDomZIndexReorderCommit,
  };
}
