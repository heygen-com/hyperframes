import { memo } from "react";
import { createPortal } from "react-dom";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";

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
}

/**
 * Context menu for right-clicking EMPTY space on a timeline lane
 * (CapCut/Premiere-style). Offers "Close gap" (collapse the clicked gap by
 * shifting the following clips on that lane left) and "Close all gaps"
 * (compact the whole lane contiguous from 0). Styling mirrors ClipContextMenu.
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
}: TrackGapContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);

  const menuWidth = 200;
  const menuHeight = 68;
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = overflowY > 0 ? y - overflowY - 8 : y;

  const itemClass = (enabled: boolean) =>
    `w-full flex items-center justify-between px-3 py-1.5 text-xs text-left ${
      enabled
        ? "text-neutral-300 hover:bg-neutral-800 cursor-pointer"
        : "text-neutral-600 cursor-not-allowed"
    }`;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {/* "Close gap" is only offered when a gap exists under the pointer; it
          stays visible-but-disabled when a shifting clip is locked, so the
          refusal is discoverable rather than a silently missing item. */}
      {gapWidth != null && (
        <button
          type="button"
          className={itemClass(canCloseGap)}
          disabled={!canCloseGap}
          title={canCloseGap ? undefined : "A clip on this track can't be moved"}
          onClick={() => {
            if (!canCloseGap) return;
            onCloseGap();
            onClose();
          }}
        >
          <span>Close gap</span>
          <span className="text-neutral-500 text-[10px] ml-3">{gapWidth.toFixed(2)}s</span>
        </button>
      )}
      <button
        type="button"
        className={itemClass(canCloseAllGaps)}
        disabled={!canCloseAllGaps}
        title={
          canCloseAllGaps
            ? undefined
            : hasAnyGaps
              ? "A clip on this track can't be moved"
              : "No gaps on this track"
        }
        onClick={() => {
          if (!canCloseAllGaps) return;
          onCloseAllGaps();
          onClose();
        }}
      >
        <span>Close all gaps</span>
      </button>
    </div>,
    document.body,
  );
});
