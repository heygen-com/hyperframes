import { useState } from "react";
import { ContextMenu, MenuItem, MenuSeparator } from "../../components/ui";
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
  /** Focus this keyframe's ease segment in the inspector. Omitted when the
   *  keyframe carries no tween identity to focus. */
  onEditEase?: (elementId: string, keyframe: TimelineKeyframeTarget) => void;
  /** Copy the keyframe's properties to the clipboard; resolves false on failure. */
  onCopyProperties?: (
    elementId: string,
    keyframe: TimelineKeyframeTarget,
  ) => Promise<boolean> | boolean | void;
  /** Retime the keyframe to the current playhead, preserving its value + ease. */
  onMoveToPlayhead?: (element: TimelineElement, keyframe: TimelineKeyframeTarget) => void;
}

/**
 * Right-click actions for a keyframe diamond. Opened at the stored pointer
 * position: diamonds are painted on the timeline canvas, so there is no element
 * to trigger from.
 */
export function KeyframeDiamondContextMenu({
  state,
  onClose,
  onDelete,
  onDeleteAll,
  onEditEase,
  onCopyProperties,
  onMoveToPlayhead,
}: KeyframeDiamondContextMenuProps) {
  // The clicked diamond's identity, built once: the menu's mutating entries
  // all act on it, and they must not disagree about which keyframe was clicked.
  const keyframe: TimelineKeyframeTarget = {
    percentage: state.percentage,
    tweenPercentage: state.tweenPercentage,
    propertyGroup: state.propertyGroup,
    animationId: state.animationId,
  };
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopyProperties = async () => {
    if (!onCopyProperties) return;
    const result = await onCopyProperties(state.elementId, keyframe);
    if (result === false) {
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 1500);
      return;
    }
    setCopyStatus("copied");
    setTimeout(onClose, 700);
  };

  return (
    <ContextMenu
      anchor={{ x: state.x, y: state.y }}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-label="Keyframe actions"
    >
      {onMoveToPlayhead && (
        <MenuItem
          onClick={() => {
            // Pass clip-% — resolveKeyframeTarget keys the cache lookup on clip-%
            // and returns the tween-% for the mutation. Passing tween-% here would
            // miss the lookup on any tween whose window is shorter than the clip.
            onMoveToPlayhead(state.element, keyframe);
          }}
        >
          Move to Playhead
        </MenuItem>
      )}

      {onEditEase && (
        <MenuItem
          shortcut={state.currentEase ?? "default"}
          onClick={() => onEditEase(state.elementId, keyframe)}
        >
          Edit Ease…
        </MenuItem>
      )}

      {onCopyProperties && (
        // The row reports the outcome in its own label, so it stays open past
        // the click and closes itself once the result has been read.
        <MenuItem
          closeOnClick={false}
          onClick={() => {
            void handleCopyProperties();
          }}
        >
          {copyStatus === "copied"
            ? "Copied!"
            : copyStatus === "failed"
              ? "Copy failed — check permissions"
              : "Copy Properties"}
        </MenuItem>
      )}

      {onDelete && (
        <MenuItem tone="danger" onClick={() => onDelete(state.elementId, keyframe)}>
          Delete Keyframe
        </MenuItem>
      )}

      {/* Deleting every keyframe sat adjacent to the single delete and styled
          identically. Separate and mark it so the two cannot be misread. */}
      <MenuSeparator />

      <MenuItem tone="danger" onClick={() => onDeleteAll(state.element, state.animationId)}>
        Delete All Keyframes
      </MenuItem>
    </ContextMenu>
  );
}
