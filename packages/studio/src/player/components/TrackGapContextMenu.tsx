import { memo } from "react";
import { ContextMenu, MenuItem } from "../../components/ui";

interface TrackGapContextMenuProps {
  x: number;
  y: number;
  /** Width (seconds) of the gap under the pointer, or null when no clip exists to the right. */
  gapWidth: number | null;
  /** "Close gap" actionable: a gap exists AND every clip that must shift is movable. */
  canCloseGap: boolean;
  /** "Close all gaps" actionable: the lane has gaps AND every shifting clip is movable. */
  canCloseAllGaps: boolean;
  /** The lane has at least one gap (distinguishes the two disabled reasons). */
  hasAnyGaps: boolean;
  onClose: () => void;
  onCloseGap: () => void;
  onCloseAllGaps: () => void;
  /** Hover state for the gap-strip highlight overlay (null = nothing hovered).
   *  Only reported for ACTIONABLE rows — a disabled row closes nothing, so
   *  highlighting from it would promise an action that can't happen. */
  onHoverAction: (action: "close-gap" | "close-all" | null) => void;
}

/**
 * Context menu for right-clicking EMPTY space on a timeline lane
 * (CapCut/Premiere-style). Offers "Close gap" (collapse the clicked gap by
 * shifting the following clips on that lane left) and "Close all gaps"
 * (compact the whole lane contiguous from 0). Both rows are ALWAYS present —
 * an inapplicable action dims with a tooltip explaining why, rather than
 * vanishing into a one-item menu. Hovering an actionable row highlights the
 * gap strip(s) it would close (via onHoverAction → TimelineCanvas overlay).
 *
 * The highlight is cleared per row rather than on the popup: leaving a row
 * fires before entering the next one, so a move between rows still ends on the
 * row the pointer landed on, and a move out of the menu ends on null.
 */
export const TrackGapContextMenu = memo(function TrackGapContextMenu({
  x,
  y,
  gapWidth,
  canCloseGap,
  canCloseAllGaps,
  hasAnyGaps,
  onClose,
  onCloseGap,
  onCloseAllGaps,
  onHoverAction,
}: TrackGapContextMenuProps) {
  // Disabled reasons: no gap under the pointer beats the lock reason — a
  // pointer not on a gap has nothing to close regardless of movability.
  const closeGapTitle = canCloseGap
    ? undefined
    : gapWidth == null
      ? "No gap here"
      : "A clip on this track can't be moved";
  const closeAllTitle = canCloseAllGaps
    ? undefined
    : hasAnyGaps
      ? "A clip on this track can't be moved"
      : "No gaps on this track";

  return (
    <ContextMenu
      anchor={{ x, y }}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      aria-label="Track gap actions"
    >
      <MenuItem
        shortcut={gapWidth == null ? undefined : `${gapWidth.toFixed(2)}s`}
        disabled={!canCloseGap}
        title={closeGapTitle}
        onPointerEnter={() => onHoverAction(canCloseGap ? "close-gap" : null)}
        onPointerLeave={() => onHoverAction(null)}
        onClick={onCloseGap}
      >
        Close gap
      </MenuItem>
      <MenuItem
        disabled={!canCloseAllGaps}
        title={closeAllTitle}
        onPointerEnter={() => onHoverAction(canCloseAllGaps ? "close-all" : null)}
        onPointerLeave={() => onHoverAction(null)}
        onClick={onCloseAllGaps}
      >
        Close all gaps
      </MenuItem>
    </ContextMenu>
  );
});
