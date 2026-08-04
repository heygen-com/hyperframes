import { memo } from "react";
import { createPortal } from "react-dom";
import type { TimelineElement } from "../store/playerStore";
import { canSplitElement } from "../../utils/timelineElementSplit";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";

interface ClipContextMenuProps {
  x: number;
  y: number;
  element: TimelineElement;
  currentTime: number;
  onClose: () => void;
  onSplit: (element: TimelineElement, splitTime: number) => void;
  onDelete: (element: TimelineElement) => void;
}

export const ClipContextMenu = memo(function ClipContextMenu({
  x,
  y,
  element,
  currentTime,
  onClose,
  onSplit,
  onDelete,
}: ClipContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  // Null in standalone player mounts (no studio provider) — the agent entry
  // only exists where there is a project on disk to edit.
  const domEditActions = useDomEditActionsContextOptional();

  const menuWidth = 200;
  const menuHeight = domEditActions ? 110 : 80;
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = overflowY > 0 ? y - overflowY - 8 : y;

  const isSplittable = canSplitElement(element) && ["video", "audio", "img"].includes(element.tag);
  const canSplit =
    isSplittable && currentTime > element.start && currentTime < element.start + element.duration;

  const splitLabel = !isSplittable
    ? null
    : canSplit
      ? `Split at ${currentTime.toFixed(2)}s`
      : "Split (move playhead inside clip)";

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {splitLabel && (
        <>
          <button
            type="button"
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left ${
              canSplit
                ? "text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                : "text-neutral-600 cursor-not-allowed"
            }`}
            disabled={!canSplit}
            onClick={() => {
              if (canSplit) {
                onSplit(element, currentTime);
                onClose();
              }
            }}
          >
            <span>{splitLabel}</span>
            <span className="text-neutral-500 text-[10px] ml-3">S</span>
          </button>
          <div className="my-1 border-t border-neutral-700/60" />
        </>
      )}

      {domEditActions && (
        <>
          <button
            type="button"
            className="w-full flex items-center px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
            onClick={() => {
              // Resolve the clip back to its live DOM element so the agent gets
              // the same rich context a canvas selection produces.
              void domEditActions.buildDomSelectionForTimelineElement(element).then((selection) => {
                if (!selection) return;
                domEditActions.applyDomSelection(selection);
                domEditActions.handleAskAgent();
              });
              onClose();
            }}
          >
            Ask agent
          </button>
          <div className="my-1 border-t border-neutral-700/60" />
        </>
      )}

      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onDelete(element);
          onClose();
        }}
      >
        <span>Delete</span>
        <span className="text-neutral-500 text-[10px] ml-3">⌫</span>
      </button>
    </div>,
    document.body,
  );
});
