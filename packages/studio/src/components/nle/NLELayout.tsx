import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useSyncExternalStore,
  memo,
  type ReactNode,
} from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useTimelinePlayer, PlayerControls, Timeline, usePlayerStore } from "../../player";
import type { TimelineElement } from "../../player";
import type { BlockedTimelineEditIntent } from "../../player/components/timelineEditing";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb } from "./CompositionBreadcrumb";
import { usePreviewBlockDrop } from "./usePreviewBlockDrop";
import { useCompositionStack } from "./useCompositionStack";
import {
  TIMELINE_TOGGLE_SHORTCUT_LABEL,
  getTimelineToggleTitle,
} from "../../utils/timelineDiscovery";

interface NLELayoutProps {
  projectId: string;
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  /** Slot rendered above the timeline tracks (toolbar with split, delete, zoom) */
  timelineToolbar?: ReactNode;
  /** Slot rendered below the timeline tracks */
  timelineFooter?: ReactNode;
  /** Increment to force the preview to reload (e.g., after file writes) */
  refreshKey?: number;
  /** Navigate to a specific composition path (e.g., "compositions/intro.html") */
  activeCompositionPath?: string | null;
  /** Callback to expose the iframe ref (for element picker, etc.) */
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
  /** Callback when the viewed composition changes (drill-down/back) */
  onCompositionChange?: (compositionPath: string | null) => void;
  /** Custom clip content renderer for timeline (thumbnails, waveforms, etc.) */
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  onFileDrop?: (
    files: File[],
    placement?: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  onAssetDrop?: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onBlockDrop?: (
    blockName: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  /** Persist timeline move actions back into source HTML */
  onMoveElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  onResizeElement?: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  onBlockedEditAttempt?: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  onSplitElement?: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
  onDeleteKeyframe?: (elementId: string, percentage: number) => void;
  onDeleteAllKeyframes?: (elementId: string) => void;
  onChangeKeyframeEase?: (elementId: string, percentage: number, ease: string) => void;
  onMoveKeyframe?: (element: TimelineElement, oldPct: number, newPct: number) => void;
  onToggleKeyframeAtPlayhead?: (element: TimelineElement) => void;
  /** Exposes the compIdToSrc map for parent components (e.g., useRenderClipContent) */
  onCompIdToSrcChange?: (map: Map<string, string>) => void;
  /** Whether the timeline panel is visible (default: true) */
  timelineVisible?: boolean;
  /** Callback to toggle timeline visibility */
  onToggleTimeline?: () => void;
  /** Notifies parent when composition loading state changes */
  onCompositionLoadingChange?: (loading: boolean) => void;
}

const MIN_TIMELINE_H = 100;
const DEFAULT_TIMELINE_H = 220;
const MIN_PREVIEW_H = 120;

function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}

function getFullscreenElement() {
  return document.fullscreenElement;
}

export function shouldDisableTimelineWhileCompositionLoading(compositionLoading: boolean): boolean {
  return compositionLoading;
}

// fallow-ignore-next-line complexity
export const NLELayout = memo(function NLELayout({
  projectId,
  portrait,
  previewOverlay,
  timelineToolbar,
  timelineFooter,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
  onCompositionChange,
  renderClipContent,
  onFileDrop,
  onDeleteElement,
  onAssetDrop,
  onBlockDrop,
  onPreviewBlockDrop,
  onMoveElement,
  onResizeElement,
  onBlockedEditAttempt,
  onSplitElement,
  onSelectTimelineElement,
  onDeleteKeyframe,
  onDeleteAllKeyframes,
  onChangeKeyframeEase,
  onMoveKeyframe,
  onToggleKeyframeAtPlayhead,
  onCompIdToSrcChange,
  timelineVisible,
  onToggleTimeline,
  onCompositionLoadingChange: onCompositionLoadingChangeParent,
}: NLELayoutProps) {
  const {
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad: baseOnIframeLoad,
    refreshPlayer,
  } = useTimelinePlayer();

  // Reset timeline state when the project changes
  const prevProjectIdRef = useRef(projectId);
  if (prevProjectIdRef.current !== projectId) {
    prevProjectIdRef.current = projectId;
    usePlayerStore.getState().reset();
  }

  const stageRefForDrop = useRef<HTMLDivElement | null>(null);
  const handleStageRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    stageRefForDrop.current = ref.current;
  }, []);

  const {
    isDragOver: previewDragOver,
    handleDragOver: handlePreviewDragOver,
    handleDragLeave: handlePreviewDragLeave,
    handleDrop: handlePreviewDrop,
  } = usePreviewBlockDrop({
    portrait,
    stageRef: stageRefForDrop as React.RefObject<HTMLDivElement | null>,
    onBlockDrop: onPreviewBlockDrop,
  });

  // Lightweight reload: change iframe src instead of destroying the Player.
  // refreshPlayer() saves the seek position and appends a cache-busting _t
  // param — the Player instance stays alive so the adapter is available for
  // saveSeekPosition() to read the current time before the reload.
  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === prevRefreshKeyRef.current) return;
    prevRefreshKeyRef.current = refreshKey;
    refreshPlayer();
  }, [refreshKey, refreshPlayer]);

  const onIframeLoad = useCallback(() => {
    baseOnIframeLoad();
    onIframeRef?.(iframeRef.current);
  }, [baseOnIframeLoad, iframeRef, onIframeRef]);

  const {
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown: drillDown,
    masterSeekRef,
    compIdToSrc,
    setCompIdToSrc,
  } = useCompositionStack({
    projectId,
    activeCompositionPath,
    onCompositionChange,
  });

  // Wrap handleDrillDown to also scan the iframe DOM for data-composition-src
  const iframeRef_ = iframeRef;
  const handleDrillDown = useCallback(
    (element: TimelineElement) => {
      if (!element.compositionSrc) return;
      // Check compIdToSrc map first; then scan iframe DOM; then fall through to drillDown
      const compId = element.id;
      let resolvedPath = compIdToSrc.get(compId);
      if (!resolvedPath) {
        try {
          const doc = iframeRef_.current?.contentDocument;
          if (doc) {
            const host = doc.querySelector(
              `[data-composition-id="${compId}"][data-composition-src]`,
            );
            if (host) {
              resolvedPath = host.getAttribute("data-composition-src") || undefined;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      // Delegate with the resolved compositionSrc (may be same as original)
      drillDown({
        id: compId,
        compositionSrc: resolvedPath ?? element.compositionSrc,
      });
    },
    [compIdToSrc, drillDown, iframeRef_],
  );

  // Composition ID → file path map from raw index.html
  const compIdToSrcRef = useRef(compIdToSrc);
  compIdToSrcRef.current = compIdToSrc;

  useMountEffect(() => {
    fetch(`/api/projects/${projectId}/files/index.html`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        const html = data.content || "";
        const map = new Map<string, string>();
        const re =
          /data-composition-id=["']([^"']+)["'][^>]*data-composition-src=["']([^"']+)["']|data-composition-src=["']([^"']+)["'][^>]*data-composition-id=["']([^"']+)["']/g;
        let match;
        while ((match = re.exec(html)) !== null) {
          const id = match[1] || match[4];
          const src = match[2] || match[3];
          if (id && src) map.set(id, src);
        }
        setCompIdToSrc(map);
        onCompIdToSrcChange?.(map);
      })
      .catch(() => {});
  });

  // Patch elements with compositionSrc whenever elements or compIdToSrc change.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (compIdToSrc.size === 0) return;
    const patchElements = (elements: TimelineElement[]): TimelineElement[] | null => {
      const map = compIdToSrcRef.current;
      if (map.size === 0) return null;
      let patched = false;
      const updated = elements.map((el) => {
        if (el.compositionSrc) return el;
        const src = map.get(el.id) ?? map.get(el.id.replace(/-(host|comp|layer)$/, ""));
        if (src) {
          patched = true;
          return { ...el, compositionSrc: src };
        }
        return el;
      });
      return patched ? updated : null;
    };
    const patched = patchElements(usePlayerStore.getState().elements);
    if (patched) usePlayerStore.getState().setElements(patched);
    let patching = false;
    return usePlayerStore.subscribe((state, prev) => {
      if (patching) return;
      if (state.elements === prev.elements || state.elements.length === 0) return;
      if (state.elements.every((el) => el.compositionSrc)) return;
      patching = true;
      const result = patchElements(state.elements);
      if (result) state.setElements(result);
      patching = false;
    });
  }, [compIdToSrc]);

  // Resizable timeline height
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE_H);
  const hasLoadedOnceRef = useRef(false);
  const [compositionLoading, setCompositionLoadingRaw] = useState(true);
  const setCompositionLoading = useCallback((loading: boolean) => {
    if (!loading) hasLoadedOnceRef.current = true;
    if (loading && hasLoadedOnceRef.current) return;
    setCompositionLoadingRaw(loading);
  }, []);
  const timelineDisabled = shouldDisableTimelineWhileCompositionLoading(compositionLoading);

  useEffect(() => {
    onCompositionLoadingChangeParent?.(compositionLoading);
  }, [compositionLoading, onCompositionLoadingChangeParent]);

  const fullscreenElement = useSyncExternalStore(subscribeFullscreen, getFullscreenElement);
  const isTimelineVisible = timelineVisible ?? true;
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFullscreen = fullscreenElement === containerRef.current && fullscreenElement != null;

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current.requestFullscreen();
    }
  }, []);

  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;

  const onIframeRefStable = useRef(onIframeRef);
  onIframeRefStable.current = onIframeRef;
  useEffect(() => {
    onIframeRefStable.current?.(iframeRef.current);
  }, [compositionStack.length, refreshKey, iframeRef]);

  // Resize divider handlers
  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (timelineDisabled) return;
      e.preventDefault();
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [timelineDisabled],
  );

  const handleDividerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (timelineDisabled) return;
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const containerH = rect.height;
      const newTimelineH = Math.max(
        MIN_TIMELINE_H,
        Math.min(containerH - MIN_PREVIEW_H, containerH - mouseY),
      );
      setTimelineH(newTimelineH);
    },
    [timelineDisabled],
  );

  const handleDividerPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Keyboard: Escape to pop composition level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && compositionStack.length > 1) {
        updateCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compositionStack.length],
  );

  // Suppress TS unused-var warning for masterSeekRef (used inside useCompositionStack)
  void masterSeekRef;

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full min-h-0 bg-neutral-950"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-studio-fullscreen-target=""
    >
      {/* Preview + player controls */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="flex-1 min-h-0 relative overflow-hidden"
          data-preview-pan-surface="true"
          onDragOver={handlePreviewDragOver}
          onDragLeave={handlePreviewDragLeave}
          onDrop={handlePreviewDrop}
        >
          <NLEPreview
            projectId={projectId}
            iframeRef={iframeRef}
            onIframeLoad={onIframeLoad}
            onCompositionLoadingChange={setCompositionLoading}
            portrait={portrait}
            directUrl={directUrl}
            suppressLoadingOverlay={hasLoadedOnceRef.current}
            onStageRef={handleStageRef}
          />
          {previewDragOver && (
            <div className="absolute inset-2 z-40 rounded-lg border-2 border-dashed border-studio-accent/50 bg-studio-accent/[0.04] pointer-events-none" />
          )}
          {!isFullscreen && previewOverlay}
        </div>
        <div className="bg-neutral-950 border-t border-neutral-800/50 flex-shrink-0">
          {!isFullscreen && compositionStack.length > 1 && (
            <CompositionBreadcrumb
              stack={compositionStack}
              onNavigate={handleNavigateComposition}
            />
          )}
          <PlayerControls
            onTogglePlay={togglePlay}
            onSeek={seek}
            disabled={timelineDisabled}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>

      {!isFullscreen && isTimelineVisible ? (
        <>
          {/* Resize divider */}
          <div
            className="group h-2 flex-shrink-0 cursor-row-resize flex items-center justify-center z-10"
            style={{ touchAction: "none" }}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
          >
            <div className="h-px w-full bg-white/10 transition-colors group-hover:bg-white/16 group-active:bg-white/22" />
          </div>

          {/* Timeline section */}
          <div
            className="relative flex flex-col flex-shrink-0"
            style={{ height: timelineH }}
            aria-disabled={timelineDisabled || undefined}
          >
            <div
              className="flex flex-col flex-1 min-h-0 overflow-hidden bg-neutral-950"
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-clip]")) return;
                if (timelineDisabled) return;
                if (compositionStack.length > 1) {
                  updateCompositionStack((prev) => prev.slice(0, -1));
                }
              }}
            >
              <div className="flex-shrink-0">{timelineToolbar}</div>
              <Timeline
                onSeek={seek}
                onDrillDown={handleDrillDown}
                renderClipContent={renderClipContent}
                onFileDrop={onFileDrop}
                onDeleteElement={onDeleteElement}
                onAssetDrop={onAssetDrop}
                onBlockDrop={onBlockDrop}
                onMoveElement={onMoveElement}
                onResizeElement={onResizeElement}
                onBlockedEditAttempt={onBlockedEditAttempt}
                onSplitElement={onSplitElement}
                onSelectElement={onSelectTimelineElement}
                onDeleteKeyframe={onDeleteKeyframe}
                onDeleteAllKeyframes={onDeleteAllKeyframes}
                onChangeKeyframeEase={onChangeKeyframeEase}
                onMoveKeyframe={onMoveKeyframe}
                onToggleKeyframeAtPlayhead={onToggleKeyframeAtPlayhead}
              />
            </div>
            {timelineFooter && <div className="flex-shrink-0">{timelineFooter}</div>}
            {timelineDisabled && (
              <div
                className="absolute inset-0 z-30 cursor-not-allowed bg-black/18"
                data-testid="timeline-loading-disabled-overlay"
                aria-hidden="true"
                onPointerDown={(event) => event.preventDefault()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
              />
            )}
          </div>
        </>
      ) : !isFullscreen && onToggleTimeline ? (
        <div className="flex-shrink-0 border-t border-neutral-800/50 bg-neutral-950/96">
          <div className="flex h-10 items-center justify-between px-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
              Timeline
            </div>
            <button
              type="button"
              onClick={onToggleTimeline}
              className="flex h-7 items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-100"
              title={getTimelineToggleTitle(false)}
              aria-label="Show timeline editor"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="13" width="18" height="8" rx="1" />
                <path d="M7 9h10" />
                <path d="M8 5h8" />
              </svg>
              <span>Show</span>
              <span className="hidden rounded bg-white/5 px-1 py-0.5 font-mono text-[9px] text-neutral-500 sm:inline">
                {TIMELINE_TOGGLE_SHORTCUT_LABEL}
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
