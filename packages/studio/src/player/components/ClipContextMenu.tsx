import { memo, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { canSplitElement } from "../../utils/timelineElementSplit";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useMenuKeyboardNav } from "./menuKeyboardNav";
import type { TimelineClipMenuItem } from "./TimelineTypes";
import { ClipMenuToolItems } from "./clipMenuToolItems";
import { ClipMenuAudioItems } from "./clipMenuAudioItems";
import { ClipMenuLinkItems } from "./clipMenuLinkItems";

const MENU_MARGIN = 8;
// Empty groups collapse; every non-empty group before the always-present Delete group ends in a divider.
const GROUP_CLASS = "empty:hidden mb-1 pb-1 border-b border-neutral-700/60";

function useMeasuredHeight(ref: RefObject<HTMLDivElement | null>, anchorKey: string): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setHeight(node.offsetHeight);
    // Items that read the live preview can appear after mount; follow them.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, anchorKey]);
  return height;
}

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
  hostItems?: readonly TimelineClipMenuItem[] | undefined;
}

// Same enabled/disabled menu-item pattern as the sibling TrackGapContextMenu.
const itemClass = (enabled: boolean) =>
  `w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-none${
    enabled
      ? " focus-visible:bg-neutral-800 text-neutral-300 hover:bg-neutral-800 cursor-pointer"
      : " text-neutral-600 cursor-not-allowed"
  }`;

/** The host's items, above Studio's. A pick closes the menu; focus the item moves stays where it went. */
function HostItems({
  items,
  onClose,
}: {
  items: readonly TimelineClipMenuItem[];
  onClose: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={itemClass(!item.disabled)}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span className="flex items-center gap-2">
            {item.icon}
            {item.label}
          </span>
          {item.shortcut && (
            <span className="text-neutral-500 text-[10px] ml-3">{item.shortcut}</span>
          )}
        </button>
      ))}
    </>
  );
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
  hostItems = [],
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

  const menuWidth = 200;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const menuHeight = useMeasuredHeight(menuRef, `${x},${y},${element.key ?? element.id}`);
  const overflowY = y + menuHeight - window.innerHeight;
  const adjustedY = overflowY > 0 ? Math.max(MENU_MARGIN, y - overflowY - MENU_MARGIN) : y;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Clip actions"
      className="fixed z-200 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {hostItems.length > 0 && (
        <div role="group" aria-label="Host" className={GROUP_CLASS}>
          <HostItems items={hostItems} onClose={onClose} />
        </div>
      )}
      <div role="group" aria-label="Time" className={GROUP_CLASS}>
        {splitLabel && (
          <button
            type="button"
            role="menuitem"
            className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left outline-hidden focus-visible:bg-neutral-800 ${
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
        )}
        {splitLabel && (
          <ClipMenuToolItems
            group="time"
            element={element}
            currentTime={currentTime}
            onClose={onClose}
          />
        )}
      </div>

      <div role="group" aria-label="Sound" className={GROUP_CLASS}>
        <ClipMenuAudioItems part="normalize" element={element} onClose={onClose} />
        <ClipMenuToolItems
          group="sound"
          element={element}
          currentTime={currentTime}
          onClose={onClose}
        />
        <ClipMenuLinkItems part="link" element={element} onClose={onClose} />
        <ClipMenuAudioItems part="duck" element={element} onClose={onClose} />
      </div>

      <div role="group" aria-label="Picture" className={GROUP_CLASS}>
        <ClipMenuToolItems
          group="picture"
          element={element}
          currentTime={currentTime}
          onClose={onClose}
        />
      </div>

      <div role="group" aria-label="Clipboard" className={GROUP_CLASS}>
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
      </div>

      <div role="group" aria-label="Delete">
        <button
          type="button"
          role="menuitem"
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-danger-ink hover:bg-neutral-800 focus-visible:bg-neutral-800 outline-hidden cursor-pointer text-left"
          onClick={() => {
            onDelete(element);
            onClose();
          }}
        >
          <span>Delete</span>
          <span className="text-neutral-500 text-[10px] ml-3">⌫</span>
        </button>
        <ClipMenuLinkItems part="delete" element={element} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
});
