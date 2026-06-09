import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_MOTION_PANEL_ENABLED,
} from "../components/editor/manualEditingAvailability";
import { readStudioMotionFromElement } from "../components/editor/studioMotion";
import type { StudioContextValue } from "../contexts/StudioContext";
import type { DomEditSelection } from "../components/editor/domEditing";

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
    deleteRender: (id: string) => void;
    clearCompleted: () => void;
    startRender: (options: unknown) => Promise<void>;
  };
  compositionDimensions: { width: number; height: number } | null;
  waitForPendingDomEditSaves: () => Promise<void>;
  handlePreviewIframeRef: (iframe: HTMLIFrameElement | null) => void;
  refreshPreviewDocumentVersion: () => void;
  timelineVisible: boolean;
  toggleTimelineVisibility: () => void;
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
    timelineVisible: input.timelineVisible,
    toggleTimelineVisibility: input.toggleTimelineVisibility,
  };
}

export interface InspectorState {
  selectedStudioMotion: ReturnType<typeof readStudioMotionFromElement> | null;
  layersPanelActive: boolean;
  designPanelActive: boolean;
  motionPanelActive: boolean;
  inspectorPanelActive: boolean;
  inspectorButtonActive: boolean;
  shouldShowSelectedDomBounds: boolean;
}

export function useInspectorState(
  rightPanelTab: string,
  rightCollapsed: boolean,
  isPlaying: boolean,
  domEditSelection: DomEditSelection | null,
  isGestureRecording?: boolean,
): InspectorState {
  // fallow-ignore-next-line complexity
  return useMemo(() => {
    const selectedStudioMotion =
      STUDIO_INSPECTOR_PANELS_ENABLED && domEditSelection
        ? readStudioMotionFromElement(domEditSelection.element)
        : null;
    const layersPanelActive = STUDIO_INSPECTOR_PANELS_ENABLED && rightPanelTab === "layers";
    const designPanelActive = STUDIO_INSPECTOR_PANELS_ENABLED && rightPanelTab === "design";
    const motionPanelActive =
      STUDIO_INSPECTOR_PANELS_ENABLED && STUDIO_MOTION_PANEL_ENABLED && rightPanelTab === "motion";
    const inspectorPanelActive = layersPanelActive || designPanelActive || motionPanelActive;
    return {
      selectedStudioMotion,
      layersPanelActive,
      designPanelActive,
      motionPanelActive,
      inspectorPanelActive,
      inspectorButtonActive:
        STUDIO_INSPECTOR_PANELS_ENABLED && !rightCollapsed && inspectorPanelActive,
      shouldShowSelectedDomBounds:
        inspectorPanelActive && !rightCollapsed && !isPlaying && !isGestureRecording,
    };
  }, [rightPanelTab, rightCollapsed, isPlaying, domEditSelection, isGestureRecording]);
}

// fallow-ignore-next-line complexity
export function useDragOverlay(onImportFiles: (files: FileList) => void) {
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
