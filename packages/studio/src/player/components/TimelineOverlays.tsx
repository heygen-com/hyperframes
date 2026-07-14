import type { KeyframeCacheEntry, TimelineElement } from "../store/playerStore";
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

interface ClipContextMenuState {
  x: number;
  y: number;
  element: TimelineElement;
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

// The timeline's floating overlays, rendered as siblings above the scroll area:
// the shortcut hint, the range-edit popover, the keyframe-diamond context menu,
// and the clip context menu.
export function TimelineOverlays({
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

      {kfContextMenu && (
        <KeyframeDiamondContextMenu
          state={kfContextMenu}
          onClose={() => setKfContextMenu(null)}
          onDelete={(elId, pct) => onDeleteKeyframe?.(elId, pct)}
          onDeleteAll={(elId) => onDeleteAllKeyframes?.(elId)}
          onChangeEase={(elId, pct, ease) => onChangeKeyframeEase?.(elId, pct, ease)}
          onMoveToPlayhead={
            onMoveKeyframeToPlayhead
              ? (elId, pct) => onMoveKeyframeToPlayhead(elId, pct)
              : undefined
          }
          onCopyProperties={(elId, pct) => {
            const kfData = keyframeCache.get(elId);
            const kf = kfData?.keyframes.find((k) => k.percentage === pct);
            if (kf) {
              void navigator.clipboard.writeText(JSON.stringify(kf.properties, null, 2));
            }
          }}
        />
      )}

      {clipContextMenu && (
        <ClipContextMenu
          x={clipContextMenu.x}
          y={clipContextMenu.y}
          element={clipContextMenu.element}
          currentTime={currentTime}
          onClose={() => setClipContextMenu(null)}
          onSplit={(el, time) => onSplitElement?.(el, time)}
          onDelete={(el) => {
            pinZoomBeforeEdit();
            onDeleteElement?.(el);
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
