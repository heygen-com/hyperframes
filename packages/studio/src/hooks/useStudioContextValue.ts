import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { STUDIO_INSPECTOR_PANELS_ENABLED } from "../components/editor/manualEditingAvailability";
import type { StudioContextValue } from "../contexts/StudioContext";
import type { RightInspectorPanes } from "../utils/studioHelpers";
import type { TimelineFileDropHandler } from "./useTimelineEditingTypes";
import { usePlayerStore } from "../player";

interface StudioContextInput {
  projectId: string;
  activeCompPath: string | null;
  setActiveCompPath: (path: string | null) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  captionEditMode: boolean;
  compositionLoading: boolean;
  refreshKey: number;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  timelineElements: StudioContextValue["timelineElements"];
  isPlaying: boolean;
  editHistory: { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string };
  handleUndo: StudioContextValue["handleUndo"];
  handleRedo: StudioContextValue["handleRedo"];
  renderQueue: {
    jobs: unknown[];
    isRendering: boolean;
    loadError: string | null;
    actionError: string | null;
    dismissActionError: () => void;
    reloadRenders: () => void;
    deleteRender: (id: string) => void;
    cancelRender: (id: string) => void;
    clearCompleted: () => void;
    startRender: (options: unknown) => Promise<void>;
  };
  compositionDimensions: { width: number; height: number } | null;
  waitForPendingDomEditSaves: () => Promise<void>;
  handlePreviewIframeRef: (iframe: HTMLIFrameElement | null) => void;
  refreshPreviewDocumentVersion: () => void;
}

// fallow-ignore-next-line complexity
export function buildStudioContextValue(input: StudioContextInput): StudioContextValue {
  return {
    projectId: input.projectId,
    activeCompPath: input.activeCompPath,
    setActiveCompPath: input.setActiveCompPath,
    showToast: input.showToast,
    previewIframeRef: input.previewIframeRef,
    captionEditMode: input.captionEditMode,
    compositionLoading: input.compositionLoading,
    refreshKey: input.refreshKey,
    setRefreshKey: input.setRefreshKey,

    timelineElements: input.timelineElements,
    isPlaying: input.isPlaying,
    editHistory: input.editHistory,
    handleUndo: input.handleUndo,
    handleRedo: input.handleRedo,
    renderQueue: input.renderQueue,
    compositionDimensions: input.compositionDimensions,
    waitForPendingDomEditSaves: input.waitForPendingDomEditSaves,
    handlePreviewIframeRef: input.handlePreviewIframeRef,
    refreshPreviewDocumentVersion: input.refreshPreviewDocumentVersion,
  };
}

export interface InspectorState {
  layersPanelActive: boolean;
  designPanelActive: boolean;
  inspectorPanelActive: boolean;
  inspectorButtonActive: boolean;
  shouldShowSelectedDomBounds: boolean;
}

export function useInspectorState(
  rightPanelTab: string,
  rightInspectorPanes: RightInspectorPanes,
  rightCollapsed: boolean,
  isPlaying: boolean,
  isGestureRecording?: boolean,
): InspectorState {
  // fallow-ignore-next-line complexity
  return useMemo(() => {
    const inspectorTabActive = rightPanelTab === "design" || rightPanelTab === "layers";
    const layersPanelActive =
      STUDIO_INSPECTOR_PANELS_ENABLED && inspectorTabActive && rightInspectorPanes.layers;
    const designPanelActive =
      STUDIO_INSPECTOR_PANELS_ENABLED && inspectorTabActive && rightInspectorPanes.design;
    const inspectorPanelActive = layersPanelActive || designPanelActive;
    return {
      layersPanelActive,
      designPanelActive,
      inspectorPanelActive,
      inspectorButtonActive:
        STUDIO_INSPECTOR_PANELS_ENABLED && !rightCollapsed && inspectorPanelActive,
      // Keep the selection box + motion path drawn even when the Inspector is
      // collapsed — closing the panel shouldn't visually deselect the element.
      // The Variables tab also works against the canvas selection (bind card),
      // so the selection outline stays visible there too.
      shouldShowSelectedDomBounds:
        (inspectorPanelActive || rightPanelTab === "variables") &&
        !isPlaying &&
        !isGestureRecording,
    };
  }, [rightPanelTab, rightInspectorPanes, rightCollapsed, isPlaying, isGestureRecording]);
}

// fallow-ignore-next-line complexity
function useDragOverlay(onImportFiles: (files: FileList) => void) {
  const [active, setActive] = useState(false);
  const counterRef = useRef(0);
  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
  }, []);
  const onDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    counterRef.current++;
    setActive(true);
  }, []);
  const onDragLeave = useCallback(() => {
    counterRef.current--;
    if (counterRef.current === 0) setActive(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      counterRef.current = 0;
      setActive(false);
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer.files.length) onImportFiles(e.dataTransfer.files);
    },
    [onImportFiles],
  );
  return { active, onDragOver, onDragEnter, onDragLeave, onDrop };
}

/** Global OS file drop: imports and places at the playhead position. */
export function useGlobalFileDrop(handleTimelineFileDrop: TimelineFileDropHandler) {
  const onDrop = useCallback(
    (files: FileList) => {
      const start = usePlayerStore.getState().currentTime;
      void handleTimelineFileDrop(Array.from(files), { start, track: 0 });
    },
    [handleTimelineFileDrop],
  );
  return useDragOverlay(onDrop);
}
