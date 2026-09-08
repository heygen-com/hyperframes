import { memo } from "react";
import type { TimelineElement } from "../store/playerStore";
import { canSplitElement } from "../../utils/timelineElementSplit";
import { ContextMenu, MenuItem, MenuSeparator } from "../../components/ui";

interface ClipContextMenuProps {
  x: number;
  y: number;
  element: TimelineElement;
  currentTime: number;
  onClose: () => void;
  onSplit: (element: TimelineElement, splitTime: number) => void;
  onDelete: (element: TimelineElement) => void;
}

/**
 * Right-click actions for a timeline clip.
 *
 * The clip is painted on a canvas, so there is no element to hang a trigger
 * off: Timeline captures the pointer position and this opens at it. The portal,
 * the edge clamping, the arrow keys and the outside-press dismiss all come from
 * the shared `ContextMenu` now.
 */
export const ClipContextMenu = memo(function ClipContextMenu({
  x,
  y,
  element,
  currentTime,
  onClose,
  onSplit,
  onDelete,
}: ClipContextMenuProps) {
  const isSplittable = canSplitElement(element) && ["video", "audio", "img"].includes(element.tag);
  const canSplit =
    isSplittable && currentTime > element.start && currentTime < element.start + element.duration;

  const splitLabel = !isSplittable
    ? null
    : canSplit
      ? `Split at ${currentTime.toFixed(2)}s`
      : "Split (move playhead inside clip)";

  return (
    <ContextMenu
      anchor={{ x, y }}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-label="Clip actions"
    >
      {splitLabel && (
        <>
          <MenuItem shortcut="S" disabled={!canSplit} onClick={() => onSplit(element, currentTime)}>
            {splitLabel}
          </MenuItem>
          <MenuSeparator />
        </>
      )}

      <MenuItem tone="danger" shortcut="⌫" onClick={() => onDelete(element)}>
        Delete
      </MenuItem>
    </ContextMenu>
  );
});
