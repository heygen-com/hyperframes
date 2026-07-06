import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useMenuKeyboardNav } from "./menuKeyboardNav";
import { STUDIO_GSAP_EASE_OPTIONS } from "../../components/editor/studioMotionTypes";

export interface KeyframeDiamondContextMenuState {
  x: number;
  y: number;
  elementId: string;
  percentage: number;
  tweenPercentage?: number;
  currentEase?: string;
}

interface KeyframeDiamondContextMenuProps {
  state: KeyframeDiamondContextMenuState;
  onClose: () => void;
  onDelete: (elementId: string, percentage: number) => void;
  onDeleteAll: (elementId: string) => void;
  onChangeEase?: (elementId: string, percentage: number, ease: string) => void;
  /** Copy the keyframe's properties to the clipboard; resolves false on failure. */
  onCopyProperties?: (elementId: string, percentage: number) => Promise<boolean> | boolean | void;
  /** Retime the keyframe to the current playhead, preserving its value + ease. */
  onMoveToPlayhead?: (elementId: string, fromPercentage: number) => void;
}

const ITEM_CLS =
  "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:bg-neutral-800 outline-none cursor-pointer text-left";

export const KeyframeDiamondContextMenu = memo(function KeyframeDiamondContextMenu({
  state,
  onClose,
  onDelete,
  onDeleteAll,
  onChangeEase,
  onCopyProperties,
  onMoveToPlayhead,
}: KeyframeDiamondContextMenuProps) {
  const menuRef = useContextMenuDismiss(onClose);
  useMenuKeyboardNav(menuRef);
  const [showEaseList, setShowEaseList] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const menuWidth = 200;
  // Rough estimate for edge flipping; the real height is clamped by maxHeight.
  const menuHeight = showEaseList ? 320 : 190;
  const overflowY = state.y + menuHeight - window.innerHeight;
  const adjustedX = state.x + menuWidth > window.innerWidth ? state.x - menuWidth : state.x;
  const adjustedY = Math.max(8, overflowY > 0 ? state.y - overflowY - 8 : state.y);

  const handleCopyProperties = async () => {
    if (!onCopyProperties) return;
    const result = await onCopyProperties(state.elementId, state.percentage);
    if (result === false) {
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 1500);
      return;
    }
    setCopyStatus("copied");
    setTimeout(onClose, 700);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Keyframe actions"
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px] overflow-y-auto"
      style={{ left: adjustedX, top: adjustedY, maxHeight: `calc(100vh - ${adjustedY + 8}px)` }}
    >
      {onMoveToPlayhead && (
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLS}
          onClick={() => {
            // Pass clip-% — resolveKeyframeTarget keys the cache lookup on clip-%
            // and returns the tween-% for the mutation. Passing tween-% here would
            // miss the lookup on any tween whose window is shorter than the clip.
            onMoveToPlayhead(state.elementId, state.percentage);
            onClose();
          }}
        >
          Move to Playhead
        </button>
      )}

      {onCopyProperties && (
        <button
          type="button"
          role="menuitem"
          className={ITEM_CLS}
          onClick={() => {
            void handleCopyProperties();
          }}
        >
          {copyStatus === "copied"
            ? "Copied!"
            : copyStatus === "failed"
              ? "Copy failed — check permissions"
              : "Copy Properties"}
        </button>
      )}

      {onChangeEase && (
        <>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={showEaseList}
            className={`${ITEM_CLS} justify-between`}
            onClick={() => setShowEaseList((v) => !v)}
          >
            <span>Change Ease</span>
            <span className="text-neutral-500 text-[10px]">
              {state.currentEase ?? "power1.out"} {showEaseList ? "▾" : "▸"}
            </span>
          </button>
          {showEaseList && (
            <div className="max-h-40 overflow-y-auto border-y border-neutral-800">
              {STUDIO_GSAP_EASE_OPTIONS.map((ease) => {
                const isCurrent = ease === state.currentEase;
                return (
                  <button
                    key={ease}
                    type="button"
                    role="menuitem"
                    className={`${ITEM_CLS} pl-5 font-mono text-[11px] ${isCurrent ? "text-studio-accent" : ""}`}
                    onClick={() => {
                      onChangeEase(state.elementId, state.percentage, ease);
                      onClose();
                    }}
                  >
                    <span className="w-3 inline-block">{isCurrent ? "✓" : ""}</span>
                    {ease}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="my-1 border-t border-neutral-700/60" role="separator" />

      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 focus-visible:bg-neutral-800 outline-none cursor-pointer text-left"
        onClick={() => {
          onDelete(state.elementId, state.percentage);
          onClose();
        }}
      >
        Delete Keyframe
      </button>

      <div className="my-1 border-t border-neutral-700/60" role="separator" />

      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/40 focus-visible:bg-red-950/40 outline-none cursor-pointer text-left"
        onClick={() => {
          onDeleteAll(state.elementId);
          onClose();
        }}
      >
        <span>Delete All Keyframes</span>
        <span className="text-[9px] text-red-400/60 uppercase tracking-wide">all</span>
      </button>
    </div>,
    document.body,
  );
});
