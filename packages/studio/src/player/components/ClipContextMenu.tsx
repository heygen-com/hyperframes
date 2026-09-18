import { memo } from "react";
import { createPortal } from "react-dom";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { canSplitElement } from "../../utils/timelineElementSplit";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useMenuKeyboardNav } from "./menuKeyboardNav";

interface ClipContextMenuProps {
  x: number;
  y: number;
  element: TimelineElement;
  currentTime: number;
  onClose: () => void;
  onSplit: (element: TimelineElement, splitTime: number) => void;
  onDelete: (element: TimelineElement) => void;
  onCopy?: () => boolean;
  onPaste?: () => Promise<void>;
  onDuplicate?: () => Promise<boolean>;
  canPaste?: boolean;
}

// A menu with many independently gated items (Split/Delete/Copy/Paste/Duplicate).
// fallow-ignore-next-line complexity
export const ClipContextMenu = memo(function ClipContextMenu({
  x,
  y,
  element,
  currentTime,
  onClose,
  onSplit,
  onDelete,
  onCopy,
  onPaste,
  onDuplicate,
  canPaste,
}: ClipContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  useMenuKeyboardNav(menuRef);
  // The right-clicked clip's own id: a member of the live multi-selection
  // means Copy/Duplicate act on the whole group, matching onContextMenuClip's
  // selection-preserving behaviour for a right-click inside it.
  const selectionSize = usePlayerStore((s) => {
    const id = element.key ?? element.id;
    return s.selectedElementIds.size > 1 && s.selectedElementIds.has(id)
      ? s.selectedElementIds.size
      : 1;
  });

  const isSplittable = canSplitElement(element) && ["video", "audio", "img"].includes(element.tag);
  const canSplit =
    isSplittable && currentTime > element.start && currentTime < element.start + element.duration;

  const splitLabel = !isSplittable
    ? null
    : canSplit
      ? `Split at ${currentTime.toFixed(2)}s`
      : "Split (move playhead inside clip)";

  const clipboardItemCount = [onCopy, onPaste, onDuplicate].filter(Boolean).length;
  const rowCount = (splitLabel ? 1 : 0) + clipboardItemCount + 1; // + Delete, always present
  const dividerCount = (splitLabel ? 1 : 0) + (clipboardItemCount > 0 ? 1 : 0);
  const menuWidth = 200;
  const menuHeight = rowCount * 30 + dividerCount * 9 + 8;
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = overflowY > 0 ? y - overflowY - 8 : y;

  // Same enabled/disabled menu-item pattern as the sibling TrackGapContextMenu.
  const itemClass = (enabled: boolean) =>
    `w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-none${
      enabled
        ? " focus-visible:bg-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
        : " text-neutral-600 cursor-not-allowed"
    }`;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Clip actions"
      className="fixed z-[200] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {splitLabel && (
        <>
          <button
            type="button"
            role="menuitem"
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-none focus-visible:bg-neutral-800 ${
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

      {(onCopy || onPaste || onDuplicate) && (
        <>
          {onCopy && (
            <button
              type="button"
              role="menuitem"
              className={itemClass(true)}
              onClick={() => {
                onCopy();
                onClose();
              }}
            >
              <span>{selectionSize > 1 ? `Copy ${selectionSize} clips` : "Copy"}</span>
              <span className="text-neutral-500 text-[10px] ml-3">⌘C</span>
            </button>
          )}
          {onPaste && (
            <button
              type="button"
              role="menuitem"
              className={itemClass(!!canPaste)}
              disabled={!canPaste}
              onClick={() => {
                if (!canPaste) return;
                void onPaste();
                onClose();
              }}
            >
              <span>Paste</span>
              <span className="text-neutral-500 text-[10px] ml-3">⌘V</span>
            </button>
          )}
          {onDuplicate && (
            <button
              type="button"
              role="menuitem"
              className={itemClass(true)}
              onClick={() => {
                void onDuplicate();
                onClose();
              }}
            >
              <span>{selectionSize > 1 ? `Duplicate ${selectionSize} clips` : "Duplicate"}</span>
              <span className="text-neutral-500 text-[10px] ml-3">⌘D</span>
            </button>
          )}
          <div className="my-1 border-t border-neutral-700/60" />
        </>
      )}

      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 focus-visible:bg-neutral-800 outline-none cursor-pointer text-left"
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
