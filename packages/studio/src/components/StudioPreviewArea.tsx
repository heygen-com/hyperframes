import { useState, useMemo, useCallback, type ReactNode } from "react";
import { NLELayout } from "./nle/NLELayout";
import { CaptionOverlay } from "../captions/components/CaptionOverlay";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { DomEditOverlay } from "./editor/DomEditOverlay";
import { MotionPathOverlay } from "./editor/MotionPathOverlay";
import { useCompositionDimensions } from "../hooks/useCompositionDimensions";
import { SnapToolbar } from "./editor/SnapToolbar";
import { StudioFeedbackBar } from "./StudioFeedbackBar";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import type { BlockedTimelineEditIntent } from "../player/components/timelineEditing";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_KEYFRAMES_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "./editor/manualEditingAvailability";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useDomEditActionsContext, useDomEditSelectionContext } from "../contexts/DomEditContext";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { resolveClipTimingBasis } from "../hooks/useGsapTweenCache";
import { resolveKeyframeRetime } from "./editor/keyframeRetime";
import { TimelineEditProvider } from "../contexts/TimelineEditContext";
import type { BlockPreviewInfo } from "./sidebar/BlocksTab";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import type { GestureRecordingState } from "./editor/GestureRecordControl";

export interface StudioPreviewAreaProps {
  timelineToolbar: ReactNode;
  renderClipContent: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  // Timeline editing
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void> | void;
  handleTimelineAssetDrop: (
    assetPath: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineBlockDrop?: (
    blockName: string,
    placement: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handlePreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
  handleTimelineFileDrop: (
    files: File[],
    placement?: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineElementMove: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "track">,
  ) => Promise<void> | void;
  handleTimelineElementResize: (
    element: TimelineElement,
    updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
  ) => Promise<void> | void;
  handleToggleTrackHidden: (track: number, hidden: boolean) => Promise<void> | void;
  handleBlockedTimelineEdit: (element: TimelineElement, intent: BlockedTimelineEditIntent) => void;
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  handleRazorSplit: (element: TimelineElement, splitTime: number) => Promise<void> | void;
  handleRazorSplitAll: (splitTime: number) => Promise<void> | void;
  setCompIdToSrc: (map: Map<string, string>) => void;
  setCompositionLoading: (loading: boolean) => void;
  shouldShowSelectedDomBounds: boolean;
  blockPreview?: BlockPreviewInfo | null;
  isGestureRecording?: boolean;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  cropMode?: boolean;
  onCropModeChange?: (active: boolean) => void;
  gestureOverlay?: ReactNode;
}

// fallow-ignore-next-line complexity
export function StudioPreviewArea({
  timelineToolbar,
  renderClipContent,
  handleTimelineElementDelete,
  handleTimelineAssetDrop,
  handleTimelineBlockDrop,
  handlePreviewBlockDrop,
  handleTimelineFileDrop,
  handleTimelineElementMove,
  handleTimelineElementResize,
  handleToggleTrackHidden,
  handleBlockedTimelineEdit,
  handleTimelineElementSplit,
  handleRazorSplit,
  handleRazorSplitAll,
  setCompIdToSrc,
  setCompositionLoading,
  shouldShowSelectedDomBounds,
  isGestureRecording,
  recordingState,
  onToggleRecording,
  cropMode,
  onCropModeChange,
  blockPreview,
  gestureOverlay,
}: StudioPreviewAreaProps) {
  const {
    projectId,
    activeCompPath,
    setActiveCompPath,
    previewIframeRef,
    handlePreviewIframeRef,
    timelineVisible,
    toggleTimelineVisibility,
  } = useStudioShellContext();
  const {
    refreshKey,
    captionEditMode,
    compositionLoading,
    isPlaying,
    refreshPreviewDocumentVersion,
  } = useStudioPlaybackContext();
  const compositionDimensions = useCompositionDimensions();

  const {
    domEditHoverSelection,
    domEditSelection,
    domEditGroupSelections,
    selectedGsapAnimations,
  } = useDomEditSelectionContext();
  const {
    handleTimelineElementSelect,
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomStyleCommit,
    handleGsapRemoveKeyframe,
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapUpdateMeta,
    handleGsapAddKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    buildDomSelectionForTimelineElement,
    applyMarqueeSelection,
  } = useDomEditActionsContext();

  // fallow-ignore-next-line complexity
  const [snapPrefs, setSnapPrefs] = useState(() => {
    const p = readStudioUiPreferences();
    return {
      snapEnabled: p.snapEnabled ?? true,
      gridVisible: p.gridVisible ?? false,
      gridSpacing: p.gridSpacing ?? 50,
      snapToGrid: p.snapToGrid ?? false,
    };
  });

  // Resolve a timeline-diamond callback's clip-% to the keyframe's anim id + its
  // tween-relative percentage (shared by the delete/move keyframe callbacks): the
  // diamond reports a clip-% but the script ops key on the tween-%. Prefers the
  // anim in the keyframe's property group, falling back to the first keyframed one.
  const resolveKeyframeTarget = useCallback(
    // fallow-ignore-next-line complexity
    (pct: number): { animId: string; tweenPct: number } | null => {
      const cached = usePlayerStore.getState().keyframeCache.get(domEditSelection?.id ?? "");
      const kf = cached?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.2);
      const group = kf?.propertyGroup;
      const anim =
        (group ? selectedGsapAnimations.find((a) => a.propertyGroup === group) : undefined) ??
        selectedGsapAnimations.find((a) => a.keyframes);
      return anim ? { animId: anim.id, tweenPct: kf?.tweenPercentage ?? pct } : null;
    },
    [domEditSelection?.id, selectedGsapAnimations],
  );

  // fallow-ignore-next-line complexity
  const timelineEditCallbacks = useMemo(
    () => ({
      onMoveElement: handleTimelineElementMove,
      onResizeElement: handleTimelineElementResize,
      onToggleTrackHidden: handleToggleTrackHidden,
      onBlockedEditAttempt: handleBlockedTimelineEdit,
      onSplitElement: handleTimelineElementSplit,
      onRazorSplit: handleRazorSplit,
      onRazorSplitAll: handleRazorSplitAll,
      onDeleteAllKeyframes: () => {
        // Hold the element where it is (collapse keyframes to a static set) rather
        // than deleting the whole animation — deleting strands a stale GSAP base
        // that the next drag adds to, flinging the element off-screen.
        const anim = selectedGsapAnimations.find((a) => a.keyframes);
        if (!anim) return;
        handleGsapRemoveAllKeyframes(anim.id);
      },
      onDeleteKeyframe: (_elId: string, pct: number) => {
        const target = resolveKeyframeTarget(pct);
        if (target) handleGsapRemoveKeyframe(target.animId, target.tweenPct);
      },
      // Retime the keyframe to the playhead, preserving its value + ease.
      onMoveKeyframeToPlayhead: (_elId: string, pct: number) => {
        const target = resolveKeyframeTarget(pct);
        if (target) handleGsapMoveKeyframeToPlayhead(target.animId, target.tweenPct);
      },
      // Drag-to-retime. The diamond reports clip-%s; resolveKeyframeTarget gives
      // the dragged keyframe's anim + tween-%. We convert the clip-% drop to an
      // absolute time (via the clip's timing basis) and let resolveKeyframeRetime
      // decide: a drop inside the tween window is a plain move (re-key tween-%); a
      // drop past the boundary (last keyframe past the end, first before the start)
      // resizes the tween — position/duration grow so the dragged keyframe lands at
      // the drop while every other keyframe keeps its absolute time (value+ease too).
      // fallow-ignore-next-line complexity
      onMoveKeyframe: (_elId: string, fromClipPct: number, toClipPct: number) => {
        const target = resolveKeyframeTarget(fromClipPct);
        const sel = domEditSelection;
        if (!target || !sel) return;
        const anim = selectedGsapAnimations.find((a) => a.id === target.animId);
        const tweenStart = anim ? resolveTweenStart(anim) : null;
        if (!anim || tweenStart === null) return;
        const tweenDuration = anim.duration ?? resolveTweenDuration(anim);
        const sourceFile = sel.sourceFile || activeCompPath || "index.html";
        const { elements, domClipChildren } = usePlayerStore.getState();
        const { elStart, elDuration } = resolveClipTimingBasis(
          sel.id ?? "",
          sourceFile,
          elements,
          domClipChildren,
        );
        const dropAbsTime = elStart + (toClipPct / 100) * elDuration;
        const decision = resolveKeyframeRetime({
          keyframes: anim.keyframes?.keyframes ?? [],
          draggedTweenPct: target.tweenPct,
          tweenStart,
          tweenDuration,
          dropAbsTime,
        });
        if (decision.kind === "move" && decision.toTweenPct != null) {
          handleGsapMoveKeyframe(target.animId, target.tweenPct, decision.toTweenPct);
        } else if (
          decision.kind === "resize" &&
          decision.pctRemap &&
          decision.position != null &&
          decision.duration != null
        ) {
          handleGsapResizeKeyframedTween(
            target.animId,
            decision.position,
            decision.duration,
            decision.pctRemap,
          );
        }
      },
      onChangeKeyframeEase: (_elId: string, _pct: number, ease: string) => {
        for (const anim of selectedGsapAnimations) {
          if (anim.keyframes) handleGsapUpdateMeta(anim.id, { ease });
        }
      },
      // fallow-ignore-next-line complexity
      onToggleKeyframeAtPlayhead: (el: TimelineElement) => {
        const currentTime = usePlayerStore.getState().currentTime;
        const pct =
          el.duration > 0
            ? Math.max(0, Math.min(100, Math.round(((currentTime - el.start) / el.duration) * 100)))
            : 0;
        const anim = selectedGsapAnimations.find((a) => a.keyframes);
        if (anim?.keyframes) {
          const existing = anim.keyframes.keyframes.find((k) => Math.abs(k.percentage - pct) <= 1);
          if (existing) {
            handleGsapRemoveKeyframe(anim.id, existing.percentage);
          } else {
            handleGsapAddKeyframe(anim.id, pct, "x", 0);
          }
        } else {
          const flatAnim = selectedGsapAnimations.find((a) => !a.keyframes);
          if (flatAnim) handleGsapConvertToKeyframes(flatAnim.id);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      handleTimelineElementMove,
      handleTimelineElementResize,
      handleToggleTrackHidden,
      handleBlockedTimelineEdit,
      handleTimelineElementSplit,
      handleRazorSplit,
      handleRazorSplitAll,
      handleGsapRemoveAllKeyframes,
      resolveKeyframeTarget,
      selectedGsapAnimations,
      handleGsapRemoveKeyframe,
      handleGsapMoveKeyframeToPlayhead,
      handleGsapMoveKeyframe,
      handleGsapResizeKeyframedTween,
      handleGsapUpdateMeta,
      handleGsapAddKeyframe,
      handleGsapConvertToKeyframes,
      buildDomSelectionForTimelineElement,
      projectId,
      activeCompPath,
      domEditSelection,
    ],
  );

  return (
    <div className="flex-1 flex flex-col relative min-w-0">
      <div className="flex-1 min-h-0 relative">
        <TimelineEditProvider value={timelineEditCallbacks}>
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onDeleteElement={handleTimelineElementDelete}
            onAssetDrop={handleTimelineAssetDrop}
            onBlockDrop={handleTimelineBlockDrop}
            onPreviewBlockDrop={handlePreviewBlockDrop}
            onFileDrop={handleTimelineFileDrop}
            onSelectTimelineElement={handleTimelineElementSelect}
            onCompIdToSrcChange={setCompIdToSrc}
            onCompositionLoadingChange={setCompositionLoading}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              // Guard against no-op updates to prevent circular refresh cascades
              // between activeCompPath → compositionStack → onCompositionChange.
              if (compPath !== activeCompPath) {
                setActiveCompPath(compPath);
                refreshPreviewDocumentVersion();
              }
            }}
            onIframeRef={handlePreviewIframeRef}
            previewOverlay={
              blockPreview ? (
                <div className="absolute inset-0 z-30 bg-black pointer-events-none">
                  {blockPreview.videoUrl ? (
                    <video
                      src={blockPreview.videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  ) : blockPreview.posterUrl ? (
                    <img
                      src={blockPreview.posterUrl}
                      alt={blockPreview.title}
                      className="w-full h-full object-contain"
                    />
                  ) : null}
                </div>
              ) : captionEditMode ? (
                <CaptionOverlay iframeRef={previewIframeRef} />
              ) : STUDIO_INSPECTOR_PANELS_ENABLED ? (
                <>
                  <DomEditOverlay
                    iframeRef={previewIframeRef}
                    activeCompositionPath={activeCompPath}
                    hoverSelection={
                      STUDIO_PREVIEW_SELECTION_ENABLED &&
                      !captionEditMode &&
                      !compositionLoading &&
                      !isPlaying
                        ? domEditHoverSelection
                        : null
                    }
                    selection={shouldShowSelectedDomBounds ? domEditSelection : null}
                    groupSelections={shouldShowSelectedDomBounds ? domEditGroupSelections : []}
                    allowCanvasMovement={
                      STUDIO_PREVIEW_MANUAL_EDITING_ENABLED && !isGestureRecording
                    }
                    onCanvasMouseDown={handlePreviewCanvasMouseDown}
                    onCanvasPointerMove={handlePreviewCanvasPointerMove}
                    onCanvasPointerLeave={handlePreviewCanvasPointerLeave}
                    onSelectionChange={applyDomSelection}
                    onBlockedMove={handleBlockedDomMove}
                    onManualDragStart={handleDomManualDragStart}
                    onPathOffsetCommit={handleDomPathOffsetCommit}
                    onGroupPathOffsetCommit={handleDomGroupPathOffsetCommit}
                    onBoxSizeCommit={handleDomBoxSizeCommit}
                    onRotationCommit={handleDomRotationCommit}
                    onStyleCommit={handleDomStyleCommit}
                    cropMode={cropMode}
                    onCropModeChange={onCropModeChange}
                    gridVisible={snapPrefs.gridVisible}
                    gridSpacing={snapPrefs.gridSpacing}
                    recordingState={recordingState}
                    onToggleRecording={onToggleRecording}
                    onMarqueeSelect={applyMarqueeSelection}
                  />
                  <SnapToolbar onSnapChange={setSnapPrefs} />
                  {STUDIO_KEYFRAMES_ENABLED && (
                    <MotionPathOverlay
                      iframeRef={previewIframeRef}
                      selection={shouldShowSelectedDomBounds ? domEditSelection : null}
                      compositionSize={compositionDimensions}
                      isPlaying={isPlaying}
                    />
                  )}
                  {gestureOverlay}
                </>
              ) : null
            }
            timelineFooter={
              captionEditMode ? (
                <div
                  className="border-t border-neutral-800/30 flex-shrink-0"
                  style={{ height: 60 }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                      Captions
                    </span>
                  </div>
                  <CaptionTimeline pixelsPerSecond={100} />
                </div>
              ) : undefined
            }
            timelineVisible={timelineVisible}
            onToggleTimeline={toggleTimelineVisibility}
          />
        </TimelineEditProvider>
      </div>
      <StudioFeedbackBar />
    </div>
  );
}
