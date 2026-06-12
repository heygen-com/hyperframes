import { useState, type ReactNode } from "react";
import { NLELayout } from "./nle/NLELayout";
import { CaptionOverlay } from "../captions/components/CaptionOverlay";
import { CaptionTimeline } from "../captions/components/CaptionTimeline";
import { DomEditOverlay } from "./editor/DomEditOverlay";
import { SnapToolbar } from "./editor/SnapToolbar";
import { StudioFeedbackBar } from "./StudioFeedbackBar";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import type { BlockedTimelineEditIntent } from "../player/components/timelineEditing";
import {
  STUDIO_INSPECTOR_PANELS_ENABLED,
  STUDIO_PREVIEW_MANUAL_EDITING_ENABLED,
  STUDIO_PREVIEW_SELECTION_ENABLED,
} from "./editor/manualEditingAvailability";
import { useStudioContext } from "../contexts/StudioContext";
import { useDomEditContext } from "../contexts/DomEditContext";
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
  blockPreview,
  gestureOverlay,
}: StudioPreviewAreaProps) {
  const {
    projectId,
    refreshKey,
    activeCompPath,
    setActiveCompPath,
    captionEditMode,
    compositionLoading,
    isPlaying,
    previewIframeRef,
    refreshPreviewDocumentVersion,
    handlePreviewIframeRef,
    timelineVisible,
    toggleTimelineVisibility,
  } = useStudioContext();

  const {
    domEditHoverSelection,
    domEditSelection,
    domEditGroupSelections,
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
    selectedGsapAnimations,
    handleGsapRemoveKeyframe,
    handleGsapUpdateMeta,
    handleGsapAddKeyframe,
    handleGsapConvertToKeyframes,
    handleGsapDeleteAllForElement,
  } = useDomEditContext();

  const [snapPrefs, setSnapPrefs] = useState(() => {
    const p = readStudioUiPreferences();
    return {
      snapEnabled: p.snapEnabled ?? true,
      gridVisible: p.gridVisible ?? false,
      gridSpacing: p.gridSpacing ?? 50,
      snapToGrid: p.snapToGrid ?? false,
    };
  });

  return (
    <div className="flex-1 flex flex-col relative min-w-0">
      <div className="flex-1 min-h-0 relative">
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
          onMoveElement={handleTimelineElementMove}
          onResizeElement={handleTimelineElementResize}
          onBlockedEditAttempt={handleBlockedTimelineEdit}
          onSplitElement={handleTimelineElementSplit}
          onRazorSplit={handleRazorSplit}
          onRazorSplitAll={handleRazorSplitAll}
          onSelectTimelineElement={handleTimelineElementSelect}
          onDeleteAllKeyframes={(elId) => {
            const rawId = elId.includes("#") ? elId.split("#").pop()! : elId;
            handleGsapDeleteAllForElement(`#${rawId}`);
          }}
          onDeleteKeyframe={(_elId, pct) => {
            const cacheKey = domEditSelection?.id ?? "";
            const cached = usePlayerStore.getState().keyframeCache.get(cacheKey);
            const kf = cached?.keyframes.find((k) => Math.abs(k.percentage - pct) < 0.2);
            const group = kf?.propertyGroup;
            const anim =
              (group ? selectedGsapAnimations.find((a) => a.propertyGroup === group) : undefined) ??
              selectedGsapAnimations.find((a) => a.keyframes);
            if (!anim) return;
            handleGsapRemoveKeyframe(anim.id, kf?.tweenPercentage ?? pct);
          }}
          onChangeKeyframeEase={(_elId, _pct, ease) => {
            for (const anim of selectedGsapAnimations) {
              if (anim.keyframes) handleGsapUpdateMeta(anim.id, { ease });
            }
          }}
          // fallow-ignore-next-line complexity
          onMoveKeyframe={(_el, oldPct, newPct) => {
            const cacheKey = domEditSelection?.id ?? "";
            const cached = usePlayerStore.getState().keyframeCache.get(cacheKey);
            const cachedKf = cached?.keyframes.find((k) => Math.abs(k.percentage - oldPct) < 0.2);
            const group = cachedKf?.propertyGroup;
            const anim =
              (group ? selectedGsapAnimations.find((a) => a.propertyGroup === group) : undefined) ??
              selectedGsapAnimations.find((a) => a.keyframes);
            if (!anim?.keyframes) return;
            const tweenOldPct = cachedKf?.tweenPercentage ?? oldPct;
            const kf = anim.keyframes.keyframes.find(
              (k) => Math.abs(k.percentage - tweenOldPct) < 0.2,
            );
            if (!kf) return;
            const tweenStart = anim.resolvedStart ?? 0;
            const tweenDur = anim.duration ?? 1;
            const newAbsTime = _el.start + (newPct / 100) * _el.duration;
            const tweenNewPct =
              tweenDur > 0
                ? Math.max(
                    0,
                    Math.min(100, Math.round(((newAbsTime - tweenStart) / tweenDur) * 1000) / 10),
                  )
                : 0;
            handleGsapRemoveKeyframe(anim.id, tweenOldPct);
            for (const [prop, val] of Object.entries(kf.properties)) {
              handleGsapAddKeyframe(anim.id, tweenNewPct, prop, val);
            }
          }}
          onToggleKeyframeAtPlayhead={(el) => {
            const currentTime = usePlayerStore.getState().currentTime;
            const pct =
              el.duration > 0
                ? Math.max(
                    0,
                    Math.min(100, Math.round(((currentTime - el.start) / el.duration) * 100)),
                  )
                : 0;
            const anim = selectedGsapAnimations.find((a) => a.keyframes);
            if (anim?.keyframes) {
              const existing = anim.keyframes.keyframes.find(
                (k) => Math.abs(k.percentage - pct) <= 1,
              );
              if (existing) {
                handleGsapRemoveKeyframe(anim.id, existing.percentage);
              } else {
                handleGsapAddKeyframe(anim.id, pct, "x", 0);
              }
            } else {
              const flatAnim = selectedGsapAnimations.find((a) => !a.keyframes);
              if (flatAnim) handleGsapConvertToKeyframes(flatAnim.id);
            }
          }}
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
                  allowCanvasMovement={STUDIO_PREVIEW_MANUAL_EDITING_ENABLED && !isGestureRecording}
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
                  gridVisible={snapPrefs.gridVisible}
                  gridSpacing={snapPrefs.gridSpacing}
                  recordingState={recordingState}
                  onToggleRecording={onToggleRecording}
                />
                <SnapToolbar onSnapChange={setSnapPrefs} />
                {gestureOverlay}
              </>
            ) : null
          }
          timelineFooter={
            captionEditMode ? (
              <div className="border-t border-neutral-800/30 flex-shrink-0" style={{ height: 60 }}>
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
      </div>
      <StudioFeedbackBar />
    </div>
  );
}
