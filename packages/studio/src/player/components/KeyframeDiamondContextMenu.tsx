import { memo } from "react";
import { createPortal } from "react-dom";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import type { TimelineElement } from "../store/playerStore";
import type { TimelineKeyframeTarget } from "./timelineKeyframeIdentity";

export interface KeyframeDiamondContextMenuState {
  x: number;
  y: number;
  /** Timeline project session that created this portaled target. */
  sessionEpoch?: number;
  element: TimelineElement;
  elementId: string;
  percentage: number;
  tweenPercentage?: number;
  propertyGroup?: string;
  animationId?: string;
  currentEase?: string;
}

interface KeyframeDiamondContextMenuProps {
  state: KeyframeDiamondContextMenuState;
  onClose: () => void;
  /** Omitted where this node cannot be deleted on its own (see the arc-waypoint
   *  floor in removeMotionPathPointInScript): an entry that silently no-ops is
   *  worse than no entry. */
  onDelete?: (elementId: string, keyframe: TimelineKeyframeTarget) => void;
  onDeleteAll: (element: TimelineElement, animationId?: string) => void;
  /** Retime the keyframe to the current playhead, preserving its value + ease. */
  onMoveToPlayhead?: (element: TimelineElement, keyframe: TimelineKeyframeTarget) => void;
}

export const KeyframeDiamondContextMenu = memo(function KeyframeDiamondContextMenu({
  state,
  onClose,
  onDelete,
  onDeleteAll,
  onMoveToPlayhead,
}: KeyframeDiamondContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  // The clicked diamond's identity, built once: the menu's two mutating entries
  // both act on it, and they must not disagree about which keyframe was clicked.
  const keyframe: TimelineKeyframeTarget = {
    percentage: state.percentage,
    tweenPercentage: state.tweenPercentage,
    propertyGroup: state.propertyGroup,
    animationId: state.animationId,
  };

  const menuWidth = 200;
  // Measured off the rendered rows, so the flip-up test below stays right as
  // optional entries drop out.
  const menuHeight = 10 + (1 + (onMoveToPlayhead ? 1 : 0) + (onDelete ? 1 : 0)) * 30;
  const overflowY = state.y + menuHeight - window.innerHeight;
  const adjustedX = state.x + menuWidth > window.innerWidth ? state.x - menuWidth : state.x;
  const adjustedY = overflowY > 0 ? state.y - overflowY - 8 : state.y;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {onMoveToPlayhead && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 cursor-pointer text-left"
          onClick={() => {
            // Pass clip-% — resolveKeyframeTarget keys the cache lookup on clip-%
            // and returns the tween-% for the mutation. Passing tween-% here would
            // miss the lookup on any tween whose window is shorter than the clip.
            onMoveToPlayhead(state.element, keyframe);
            onClose();
          }}
        >
          Move to Playhead
        </button>
      )}

      {/* Delete */}
      {onDelete && (
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
          onClick={() => {
            onDelete(state.elementId, keyframe);
            onClose();
          }}
        >
          Delete Keyframe
        </button>
      )}

      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onDeleteAll(state.element, state.animationId);
          onClose();
        }}
      >
        Delete All Keyframes
      </button>
    </div>,
    document.body,
  );
});
