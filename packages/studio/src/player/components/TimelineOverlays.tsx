import { useEffect } from "react";
import type { TimelineElement } from "../store/playerStore";
import { EditPopover } from "./EditModal";
import { KeyframeDiamondContextMenu } from "./KeyframeDiamondContextMenu";
import { ClipContextMenu } from "./ClipContextMenu";
import { TrackGapContextMenu } from "./TrackGapContextMenu";
import { TimelineShortcutHint } from "./TimelineShortcutHint";
import { copyTextToClipboard } from "../../utils/clipboard";
import { trackStudioSegmentEaseEdit } from "../../telemetry/events";
import { useTimelineContext } from "./TimelineProvider";

interface TimelineContextTargetInput {
  capturedElement: TimelineElement;
  targetSessionEpoch: number | undefined;
  sessionEpoch: number;
  selectedElementId: string | null;
  elements: readonly TimelineElement[];
}

/** The captured project session and current selection jointly own a context target. */
export function resolveTimelineContextElement({
  capturedElement,
  targetSessionEpoch,
  sessionEpoch,
  selectedElementId,
  elements,
}: TimelineContextTargetInput): TimelineElement | null {
  const identity = capturedElement.key ?? capturedElement.id;
  if (targetSessionEpoch !== sessionEpoch) return null;
  if (selectedElementId !== identity) return null;
  return elements.find((element) => (element.key ?? element.id) === identity) ?? null;
}

// The timeline's floating overlays, rendered as siblings above the scroll area:
// the shortcut hint, the range-edit popover, the keyframe-diamond context menu,
// and the clip context menu.
export function TimelineOverlays() {
  const { state, actions } = useTimelineContext();
  const overlayProps = state.overlays;
  const {
    elements,
    elementsRef,
    theme,
    showShortcutHint,
    showPopover,
    rangeSelection,
    setShowPopover,
    setRangeSelection,
    kfContextMenu,
    setKfContextMenu,
    onDeleteKeyframe,
    onDeleteAllKeyframes,
    onMoveKeyframeToPlayhead,
    clipContextMenu,
    setClipContextMenu,
    currentTime,
    onSplitElement,
    pinZoomBeforeEdit,
    onDeleteElement,
    onCopyClip,
    onPasteClip,
    onDuplicateClip,
    canPasteClip,
    gapContextMenu,
    onDismissGapContextMenu,
    onCloseTrackGap,
    onCloseAllTrackGaps,
    onHoverGapAction,
  } = overlayProps;
  const { selectedElementId, sessionEpoch, keyframeCache } = state;
  const kfTargetSessionEpoch = kfContextMenu?.sessionEpoch;
  const clipTargetSessionEpoch = clipContextMenu?.sessionEpoch;
  const keyframeElement = kfContextMenu
    ? resolveTimelineContextElement({
        capturedElement: kfContextMenu.element,
        targetSessionEpoch: kfTargetSessionEpoch,
        sessionEpoch,
        selectedElementId,
        elements,
      })
    : null;
  const clipElement = clipContextMenu
    ? resolveTimelineContextElement({
        capturedElement: clipContextMenu.element,
        targetSessionEpoch: clipTargetSessionEpoch,
        sessionEpoch,
        selectedElementId,
        elements,
      })
    : null;
  const readCurrentElement = (element: TimelineElement, targetSessionEpoch: number | undefined) =>
    resolveTimelineContextElement({
      capturedElement: element,
      targetSessionEpoch,
      sessionEpoch,
      selectedElementId,
      elements: elementsRef.current,
    });

  useEffect(() => {
    if (kfContextMenu && !keyframeElement) setKfContextMenu(null);
  }, [keyframeElement, kfContextMenu, setKfContextMenu]);

  useEffect(() => {
    if (clipContextMenu && !clipElement) setClipContextMenu(null);
  }, [clipContextMenu, clipElement, setClipContextMenu]);

  return (
    <>
      {showShortcutHint && !showPopover && !rangeSelection && (
        <TimelineShortcutHint theme={theme} />
      )}

      {showPopover && rangeSelection && (
        <EditPopover
          rangeStart={rangeSelection.start}
          rangeEnd={rangeSelection.end}
          anchorX={rangeSelection.anchorX}
          anchorY={rangeSelection.anchorY}
          onClose={() => {
            setShowPopover(false);
            setRangeSelection(null);
          }}
        />
      )}

      {kfContextMenu && keyframeElement && (
        <KeyframeDiamondContextMenu
          state={{ ...kfContextMenu, element: keyframeElement }}
          onClose={() => setKfContextMenu(null)}
          onDelete={(...args) => {
            if (!readCurrentElement(keyframeElement, kfTargetSessionEpoch)) return;
            onDeleteKeyframe?.(...args);
          }}
          onDeleteAll={(_element, animationId) => {
            const element = readCurrentElement(keyframeElement, kfTargetSessionEpoch);
            if (element) onDeleteAllKeyframes?.(element, animationId);
          }}
          onMoveToPlayhead={
            onMoveKeyframeToPlayhead
              ? (_element, ...args) => {
                  const element = readCurrentElement(keyframeElement, kfTargetSessionEpoch);
                  if (element) onMoveKeyframeToPlayhead(element, ...args);
                }
              : undefined
          }
          // Routed to the same focused-ease-segment path a segment click takes,
          // so the menu advertises the editor that exists rather than growing a
          // second one. Offered only for a keyframe that names a tween to focus.
          onEditEase={
            kfContextMenu.animationId !== undefined && kfContextMenu.tweenPercentage !== undefined
              ? (elementId, keyframe) => {
                  if (
                    keyframe.animationId === undefined ||
                    keyframe.tweenPercentage === undefined
                  ) {
                    return;
                  }
                  actions.setFocusedEaseSegment({
                    animationId: keyframe.animationId,
                    collidingAnimationTargets: keyframe.collidingAnimationTargets,
                    tweenPercentage: keyframe.tweenPercentage,
                    elementId,
                  });
                  trackStudioSegmentEaseEdit({ action: "open" });
                }
              : undefined
          }
          onCopyProperties={(elementId, keyframe) => {
            const entry = keyframeCache.get(elementId);
            // Tolerance match on clip-%, the same basis the cache is keyed on —
            // an exact float compare misses a keyframe the menu just opened over.
            const kf = entry?.keyframes.find(
              (item) => Math.abs(item.percentage - keyframe.percentage) < 0.5,
            );
            if (!kf) return false;
            return copyTextToClipboard(JSON.stringify(kf.properties, null, 2));
          }}
        />
      )}

      {clipContextMenu && clipElement && (
        <ClipContextMenu
          x={clipContextMenu.x}
          y={clipContextMenu.y}
          element={clipElement}
          currentTime={currentTime}
          onClose={() => setClipContextMenu(null)}
          onSplit={(_element, time) => {
            const element = readCurrentElement(clipElement, clipTargetSessionEpoch);
            if (element) onSplitElement?.(element, time);
          }}
          onDelete={() => {
            const element = readCurrentElement(clipElement, clipTargetSessionEpoch);
            if (!element) return;
            pinZoomBeforeEdit();
            onDeleteElement?.(element);
          }}
          onCopy={onCopyClip}
          onPaste={onPasteClip}
          onDuplicate={onDuplicateClip}
          canPaste={canPasteClip?.() ?? false}
        />
      )}

      {gapContextMenu && (
        <TrackGapContextMenu
          x={gapContextMenu.x}
          y={gapContextMenu.y}
          gapWidth={gapContextMenu.gapWidth}
          canCloseGap={gapContextMenu.canCloseGap}
          canCloseAllGaps={gapContextMenu.canCloseAllGaps}
          hasAnyGaps={gapContextMenu.hasAnyGaps}
          onClose={onDismissGapContextMenu}
          onCloseGap={onCloseTrackGap}
          onCloseAllGaps={onCloseAllTrackGaps}
          onHoverAction={onHoverGapAction}
        />
      )}
    </>
  );
}
