import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TimelineElement } from "../player";
import type { CompositionDimensions } from "../components/renders/RenderQueue";

export interface StudioContextValue {
  projectId: string;
  activeCompPath: string | null;
  setActiveCompPath: (path: string | null) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  captionEditMode: boolean;
  compositionLoading: boolean;
  refreshKey: number;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
  timelineElements: TimelineElement[];
  isPlaying: boolean;
  editHistory: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | undefined;
    redoLabel: string | undefined;
  };
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  renderQueue: {
    jobs: unknown[];
    isRendering: boolean;
    deleteRender: (jobId: string) => void;
    clearCompleted: () => void;
    startRender: (options: unknown) => Promise<void>;
  };
  compositionDimensions: CompositionDimensions | null;
  waitForPendingDomEditSaves: () => Promise<void>;
  handlePreviewIframeRef: (iframe: HTMLIFrameElement | null) => void;
  refreshPreviewDocumentVersion: () => void;
  timelineVisible: boolean;
  toggleTimelineVisibility: () => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudioContext(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudioContext must be used within StudioProvider");
  return ctx;
}

export function StudioProvider({
  value,
  children,
}: {
  value: StudioContextValue;
  children: ReactNode;
}) {
  const {
    projectId,
    activeCompPath,
    setActiveCompPath,
    showToast,
    previewIframeRef,
    captionEditMode,
    compositionLoading,
    refreshKey,
    setRefreshKey,
    timelineElements,
    isPlaying,
    editHistory,
    handleUndo,
    handleRedo,
    renderQueue,
    compositionDimensions,
    waitForPendingDomEditSaves,
    handlePreviewIframeRef,
    refreshPreviewDocumentVersion,
    timelineVisible,
    toggleTimelineVisibility,
  } = value;

  const stable = useMemo<StudioContextValue>(
    () => ({
      projectId,
      activeCompPath,
      setActiveCompPath,
      showToast,
      previewIframeRef,
      captionEditMode,
      compositionLoading,
      refreshKey,
      setRefreshKey,
      timelineElements,
      isPlaying,
      editHistory,
      handleUndo,
      handleRedo,
      renderQueue,
      compositionDimensions,
      waitForPendingDomEditSaves,
      handlePreviewIframeRef,
      refreshPreviewDocumentVersion,
      timelineVisible,
      toggleTimelineVisibility,
    }),
    // Representative subset of deps that actually change — stable callbacks
    // (showToast, setActiveCompPath, etc.) are included for correctness but
    // won't trigger re-renders on their own.
    [
      projectId,
      activeCompPath,
      captionEditMode,
      compositionLoading,
      refreshKey,
      isPlaying,
      compositionDimensions,
      timelineVisible,
      editHistory,
      timelineElements,
      renderQueue,
      setActiveCompPath,
      showToast,
      previewIframeRef,
      setRefreshKey,
      handleUndo,
      handleRedo,
      waitForPendingDomEditSaves,
      handlePreviewIframeRef,
      refreshPreviewDocumentVersion,
      toggleTimelineVisibility,
    ],
  );
  return <StudioContext value={stable}>{children}</StudioContext>;
}
