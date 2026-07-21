import { useEffect, type MutableRefObject } from "react";
import type { KeyframeCacheEntry, TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineRangeSelection } from "./timelineEditing";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import { EditPopover } from "./EditModal";
import {
  KeyframeDiamondContextMenu,
  type KeyframeDiamondContextMenuState,
} from "./KeyframeDiamondContextMenu";
import { ClipContextMenu } from "./ClipContextMenu";
import { TrackGapContextMenu } from "./TrackGapContextMenu";
import { TimelineShortcutHint } from "./TimelineShortcutHint";

export interface ClipContextMenuState {
  x: number;
  y: number;
  element: TimelineElement;
  sessionEpoch: number;
}

/** Resolved model for the empty-lane-space (track gap) context menu. */
interface TrackGapContextMenuState {
  x: number;
  y: number;
  gapWidth: number | null;
  canCloseGap: boolean;
  canCloseAllGaps: boolean;
  hasAnyGaps: boolean;
}

interface TimelineOverlaysProps {
  elements: readonly TimelineElement[];
  elementsRef: MutableRefObject<readonly TimelineElement[]>;
  theme: TimelineTheme;
  showShortcutHint: boolean;
  showPopover: boolean;
  rangeSelection: TimelineRangeSelection | null;
  setShowPopover: (value: boolean) => void;
  setRangeSelection: (value: TimelineRangeSelection | null) => void;
  kfContextMenu: KeyframeDiamondContextMenuState | null;
  setKfContextMenu: (value: KeyframeDiamondContextMenuState | null) => void;
  onDeleteKeyframe: TimelineEditCallbacks["onDeleteKeyframe"];
  onDeleteAllKeyframes: TimelineEditCallbacks["onDeleteAllKeyframes"];
  onChangeKeyframeEase: TimelineEditCallbacks["onChangeKeyframeEase"];
  onMoveKeyframeToPlayhead: TimelineEditCallbacks["onMoveKeyframeToPlayhead"];
  keyframeCache: Map<string, KeyframeCacheEntry>;
  clipContextMenu: ClipContextMenuState | null;
  setClipContextMenu: (value: ClipContextMenuState | null) => void;
  currentTime: number;
  onSplitElement: TimelineEditCallbacks["onSplitElement"];
  pinZoomBeforeEdit: () => void;
  onDeleteElement?: (element: TimelineElement) => Promise<void> | void;
  gapContextMenu: TrackGapContextMenuState | null;
  onDismissGapContextMenu: () => void;
  onCloseTrackGap: () => void;
  onCloseAllTrackGaps: () => void;
  onHoverGapAction: (action: "close-gap" | "close-all" | null) => void;
}

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

function readTimelineContextElement(
  capturedElement: TimelineElement,
  targetSessionEpoch: number | undefined,
  elements: readonly TimelineElement[],
): TimelineElement | null {
  const state = usePlayerStore.getState();
  return resolveTimelineContextElement({
    capturedElement,
    targetSessionEpoch,
    sessionEpoch: state.timelineSessionEpoch,
    selectedElementId: state.selectedElementId,
    elements,
  });
}

// The timeline's floating overlays, rendered as siblings above the scroll area:
// the shortcut hint, the range-edit popover, the keyframe-diamond context menu,
// and the clip context menu.
export function TimelineOverlays({
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
  onChangeKeyframeEase,
  onMoveKeyframeToPlayhead,
  keyframeCache,
  clipContextMenu,
  setClipContextMenu,
  currentTime,
  onSplitElement,
  pinZoomBeforeEdit,
  onDeleteElement,
  gapContextMenu,
  onDismissGapContextMenu,
  onCloseTrackGap,
  onCloseAllTrackGaps,
  onHoverGapAction,
}: TimelineOverlaysProps) {
  const selectedElementId = usePlayerStore((state) => state.selectedElementId);
  const sessionEpoch = usePlayerStore((state) => state.timelineSessionEpoch);
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
    readTimelineContextElement(element, targetSessionEpoch, elementsRef.current);

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
          onChangeEase={(elId, pct, ease) => {
            if (!readCurrentElement(keyframeElement, kfTargetSessionEpoch)) return;
            onChangeKeyframeEase?.(elId, pct, ease);
          }}
          onMoveToPlayhead={
            onMoveKeyframeToPlayhead
              ? (_element, ...args) => {
                  const element = readCurrentElement(keyframeElement, kfTargetSessionEpoch);
                  if (element) onMoveKeyframeToPlayhead(element, ...args);
                }
              : undefined
          }
          onCopyProperties={(elId, pct) => {
            if (!readCurrentElement(keyframeElement, kfTargetSessionEpoch)) return;
            const kfData = keyframeCache.get(elId);
            const kf = kfData?.keyframes.find((k) => k.percentage === pct);
            if (kf) {
              void navigator.clipboard.writeText(JSON.stringify(kf.properties, null, 2));
            }
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
