import { memo, useCallback, useEffect, useRef } from "react";
import { EASE_LABELS } from "../../components/editor/gsapAnimationConstants";

export interface KeyframeDiamondContextMenuState {
  x: number;
  y: number;
  elementId: string;
  percentage: number;
  currentEase?: string;
}

interface KeyframeDiamondContextMenuProps {
  state: KeyframeDiamondContextMenuState;
  onClose: () => void;
  onDelete: (elementId: string, percentage: number) => void;
  onDeleteAll: (elementId: string) => void;
  onChangeEase: (elementId: string, percentage: number, ease: string) => void;
  onCopyProperties: (elementId: string, percentage: number) => void;
}

const EASE_PRESETS = [
  "none",
  "power1.out",
  "power2.out",
  "power3.out",
  "power1.in",
  "power2.in",
  "power1.inOut",
  "power2.inOut",
  "back.out",
  "elastic.out",
  "bounce.out",
  "expo.out",
] as const;

export const KeyframeDiamondContextMenu = memo(function KeyframeDiamondContextMenu({
  state,
  onClose,
  onDelete,
  onDeleteAll,
  onChangeEase,
  onCopyProperties,
}: KeyframeDiamondContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const easeSubmenuRef = useRef<HTMLDivElement>(null);

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

  const adjustedX = Math.min(state.x, window.innerWidth - 200);
  const adjustedY = Math.min(state.y, window.innerHeight - 300);

  const currentEaseLabel = state.currentEase
    ? (EASE_LABELS[state.currentEase] ?? state.currentEase)
    : "Default";

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {/* Ease submenu */}
      <div className="relative group">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
        >
          <span>
            Ease: <span className="text-neutral-500">{currentEaseLabel}</span>
          </span>
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-neutral-500 ml-2">
            <path d="M3 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <div
          ref={easeSubmenuRef}
          className="absolute left-full top-0 ml-0.5 hidden group-hover:block bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[160px] max-h-[300px] overflow-y-auto"
        >
          {EASE_PRESETS.map((ease) => (
            <button
              key={ease}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-800 cursor-pointer text-left ${
                ease === state.currentEase ? "text-white font-medium" : "text-neutral-300"
              }`}
              onClick={() => {
                onChangeEase(state.elementId, state.percentage, ease);
                onClose();
              }}
            >
              {ease === state.currentEase && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  className="text-green-400 flex-shrink-0"
                >
                  <path d="M1 4l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
              <span className={ease === state.currentEase ? "" : "ml-[16px]"}>
                {EASE_LABELS[ease] ?? ease}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Separator */}
      <div className="my-1 border-t border-neutral-700/60" />

      {/* Delete */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onDelete(state.elementId, state.percentage);
          onClose();
        }}
      >
        Delete Keyframe
      </button>

      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onDeleteAll(state.elementId);
          onClose();
        }}
      >
        Delete All Keyframes
      </button>

      {/* Copy Properties */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onCopyProperties(state.elementId, state.percentage);
          onClose();
        }}
      >
        Copy Properties
      </button>
    </div>
  );
});
