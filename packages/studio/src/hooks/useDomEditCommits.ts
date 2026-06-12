import { useCallback, useRef } from "react";
import { findUnsafeDomPatchValues } from "@hyperframes/core/studio-api/finite-mutation";
import { usePlayerStore } from "../player";
import { STUDIO_GSAP_DRAG_INTERCEPT_ENABLED } from "../components/editor/manualEditingAvailability";
import { FONT_EXT } from "../utils/mediaTypes";
import type { PatchOperation } from "../utils/sourcePatcher";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { primaryFontFamilyValue } from "../utils/studioFontHelpers";
import { createStudioSaveHttpError } from "../utils/studioSaveDiagnostics";
import {
  buildDomEditPatchTarget,
  getDomEditTargetKey,
  readHfId,
  type DomEditSelection,
} from "../components/editor/domEditing";
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
} from "../components/editor/manualEditsDom";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
import type { EditHistoryKind } from "../utils/editHistory";
import { useDomEditPositionPatchCommit } from "./useDomEditPositionPatchCommit";
import { useDomEditTextCommits } from "./useDomEditTextCommits";

// ── Helpers ──
type TimelineLike = { getChildren?: (nested: boolean) => Array<{ targets?: () => Element[] }> };

function formatUnsafeFieldList(fields: Array<{ path: string }>): string {
  return fields.map((field) => field.path).join(", ");
}

async function readErrorResponseBody(
  response: Response,
): Promise<{ error?: string; fields?: string[] } | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return (await response.json().catch(() => null)) as { error?: string; fields?: string[] } | null;
}

function formatPatchRejectionMessage(body: { error?: string; fields?: string[] } | null): string {
  if (!body?.error) return "Couldn't save edit";
  const fields = Array.isArray(body.fields)
    ? body.fields.filter((field): field is string => typeof field === "string")
    : [];
  const suffix = fields.length > 0 ? ` (${fields.join(", ")})` : "";
  return `Couldn't save edit: ${body.error}${suffix}`;
}

export const GSAP_CSS_FALLBACK_BLOCKED_MESSAGE =
  "This element is GSAP-animated — dragging via CSS would corrupt keyframes";

// fallow-ignore-next-line complexity
function isElementGsapTargeted(iframe: HTMLIFrameElement | null, element: HTMLElement): boolean {
  // When the GSAP drag intercept is disabled for debugging, treat every
  // element as un-targeted so commits take the plain CSS persist path.
  if (!STUDIO_GSAP_DRAG_INTERCEPT_ENABLED) return false;
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
    // fallow-ignore-next-line complexity
    async (selection, operations, options) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");
      if (options?.shouldSave && !options.shouldSave()) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";

      const readResponse = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
      );
      if (!readResponse.ok) {
        throw await createStudioSaveHttpError(readResponse, `Failed to read ${targetPath}`);
      }
      const readData = (await readResponse.json()) as { content?: string };
      const originalContent = readData.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      if (options?.shouldSave && !options.shouldSave()) return;

      const patchTarget = buildDomEditPatchTarget(selection);
      const patchBody = { target: patchTarget, operations };
      const unsafeFields = findUnsafeDomPatchValues(patchBody);
      if (unsafeFields.length > 0) {
        const fields = formatUnsafeFieldList(unsafeFields);
        showToast("Couldn't save edit because it contains invalid layout values", "error");
        throw new Error(`DOM patch contains unsafe values: ${fields}`);
      }

      // Mark the save timestamp before the file write so the SSE file-change
      // handler suppresses the reload even if the event arrives before the
      // response (the server writes the file and emits SSE during the fetch).
      domEditSaveTimestampRef.current = Date.now();

      const patchResponse = await fetch(
        `/api/projects/${pid}/file-mutations/patch-element/${encodeURIComponent(targetPath)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        },
      );
      if (!patchResponse.ok) {
        showToast(formatPatchRejectionMessage(await readErrorResponseBody(patchResponse)), "error");
        throw await createStudioSaveHttpError(patchResponse, `Failed to patch ${targetPath}`);
      }

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
      showToast,
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

  const commitPositionPatchToHtml = useDomEditPositionPatchCommit({
    activeCompPath,
    persistDomEditOperations,
    queueDomEditSave,
    showToast,
  });

  // ── Position commits ──

  const handleDomPathOffsetCommit = useCallback(
    (selection: DomEditSelection, next: { x: number; y: number }) => {
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioPathOffset(selection.element, next);
      return commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
        label: "Move layer",
        coalesceKey: `path-offset:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomGroupPathOffsetCommit = useCallback(
    (updates: DomEditGroupPathOffsetCommit[]) => {
      if (updates.length === 0) return Promise.resolve();
      const blockedUpdate = updates.find(({ selection }) =>
        isElementGsapTargeted(previewIframeRef.current, selection.element),
      );
      if (blockedUpdate) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      const coalesceKey = updates
        .map((u) => getDomEditTargetKey(u.selection))
        .sort()
        .join(":");
      const saves = updates.map(({ selection, next }) => {
        applyStudioPathOffset(selection.element, next);
        return commitPositionPatchToHtml(selection, buildPathOffsetPatches(selection.element), {
          label: `Move ${updates.length} layers`,
          coalesceKey: `group-path-offset:${coalesceKey}`,
        });
      });
      return Promise.all(saves).then(() => undefined);
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomBoxSizeCommit = useCallback(
    (selection: DomEditSelection, next: { width: number; height: number }) => {
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioBoxSize(selection.element, next);
      return commitPositionPatchToHtml(selection, buildBoxSizePatches(selection.element), {
        label: "Resize layer box",
        coalesceKey: `box-size:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
  );

  const handleDomRotationCommit = useCallback(
    (selection: DomEditSelection, next: { angle: number }) => {
      if (isElementGsapTargeted(previewIframeRef.current, selection.element)) {
        const error = new Error(GSAP_CSS_FALLBACK_BLOCKED_MESSAGE);
        showToast(error.message, "error");
        return Promise.reject(error);
      }
      applyStudioRotation(selection.element, next);
      return commitPositionPatchToHtml(selection, buildRotationPatches(selection.element), {
        label: "Rotate layer",
        coalesceKey: `rotation:${getDomEditTargetKey(selection)}`,
      });
    },
    [commitPositionPatchToHtml, previewIframeRef, showToast],
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
      void commitPositionPatchToHtml(selection, clearPatches, {
        label: "Reset layer edits",
        coalesceKey: `manual-reset:${getDomEditTargetKey(selection)}`,
        skipRefresh: false,
      }).catch(() => undefined);
    },
    [commitPositionPatchToHtml],
  );

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
    handleDomEditElementDelete,
    handleDomZIndexReorderCommit,
  };
}
