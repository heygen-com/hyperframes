/**
 * Side effects for syncing the DOM edit selection with the preview iframe on
 * load/refresh, and for auto-revealing source in the Code tab.
 * Extracted from useDomEditSession to keep file sizes under the 600-line limit.
 */
import { useEffect, useRef } from "react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
} from "../components/editor/manualEditingAvailability";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import { reapplyPositionEditsAfterSeek } from "../components/editor/manualEdits";
import type { SidebarTab } from "../components/sidebar/LeftSidebar";
import type { PatchTarget } from "../utils/sourcePatcher";

interface UseDomEditPreviewSyncParams {
  previewIframe: HTMLIFrameElement | null;
  activeCompPath: string | null;
  captionEditMode: boolean;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  domEditSelection: DomEditSelection | null;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; preserveGroup?: boolean },
  ) => void;
  buildDomSelectionFromTarget: (element: HTMLElement) => Promise<DomEditSelection | null>;
  refreshPreviewDocumentVersion: () => void;
  syncPreviewHistoryHotkey: (iframe: HTMLIFrameElement | null) => void;
  applyStudioManualEditsToPreviewRef: React.MutableRefObject<
    (iframe: HTMLIFrameElement) => Promise<void>
  >;
  openSourceForSelection?: (sourceFile: string, target: PatchTarget) => void;
  getSidebarTab?: () => SidebarTab;
}

export function useDomEditPreviewSync({
  previewIframe,
  activeCompPath,
  captionEditMode,
  domEditSelectionRef,
  domEditSelection,
  applyDomSelection,
  buildDomSelectionFromTarget,
  refreshPreviewDocumentVersion,
  syncPreviewHistoryHotkey,
  applyStudioManualEditsToPreviewRef,
  openSourceForSelection,
  getSidebarTab,
}: UseDomEditPreviewSyncParams): void {
  // Sync selection from preview document on load / refresh
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    // fallow-ignore-next-line complexity
    const syncSelectionFromDocument = async () => {
      if (!STUDIO_INSPECTOR_PANELS_ENABLED || captionEditMode) return;
      const currentSelection = domEditSelectionRef.current;
      if (!currentSelection) return;
      let doc: Document | null = null;
      try {
        doc = previewIframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      reapplyPositionEditsAfterSeek(doc);

      const nextElement = findElementForSelection(doc, currentSelection, activeCompPath);
      if (!nextElement) {
        applyDomSelection(null, { revealPanel: false });
        return;
      }

      const nextSelection = await buildDomSelectionFromTarget(nextElement);
      if (nextSelection) {
        applyDomSelection(nextSelection, { revealPanel: false, preserveGroup: true });
      }
    };

    syncPreviewHistoryHotkey(previewIframe);
    void applyStudioManualEditsToPreviewRef.current(previewIframe);
    void syncSelectionFromDocument();
    refreshPreviewDocumentVersion();

    const handleLoad = () => {
      syncPreviewHistoryHotkey(previewIframe);
      void applyStudioManualEditsToPreviewRef.current(previewIframe);
      void syncSelectionFromDocument();
      refreshPreviewDocumentVersion();
    };

    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
    };
  }, [
    activeCompPath,
    applyDomSelection,
    buildDomSelectionFromTarget,
    captionEditMode,
    domEditSelectionRef,
    previewIframe,
    refreshPreviewDocumentVersion,
    syncPreviewHistoryHotkey,
    applyStudioManualEditsToPreviewRef,
  ]);

  // Auto-reveal source when an element is selected while the Code tab is active.
  // Use a ref for the callback so the effect only fires on selection changes,
  // not when openSourceForSelection is recreated due to editingFile content updates.
  const openSourceRef = useRef(openSourceForSelection);
  openSourceRef.current = openSourceForSelection;
  useEffect(
    // fallow-ignore-next-line complexity
    () => {
      if (!domEditSelection || !openSourceRef.current || !getSidebarTab) return;
      if (!domEditSelection.sourceFile) return;
      if (getSidebarTab() !== "code") return;
      openSourceRef.current(domEditSelection.sourceFile, {
        id: domEditSelection.id,
        selector: domEditSelection.selector,
        selectorIndex: domEditSelection.selectorIndex,
      });
    },
    [domEditSelection, getSidebarTab],
  );
}
