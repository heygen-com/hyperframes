import { memo, useCallback, useEffect, useRef } from "react";
import type { TimelineElement } from "../store/playerStore";

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
  const menuRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(
    (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [dismiss]);

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  const isSplittable = ["video", "audio", "img"].includes(element.tag);
  const canSplit =
    isSplittable && currentTime > element.start && currentTime < element.start + element.duration;

  const splitLabel = !isSplittable
    ? null
    : canSplit
      ? `Split at ${currentTime.toFixed(2)}s`
      : "Split (move playhead inside clip)";

  return (
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
    </div>
  );
});
