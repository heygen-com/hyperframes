import { useState, useCallback, memo, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tooltip } from "../../components/ui";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

interface SpeedMenuProps {
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  disabled: boolean;
}

export const SpeedMenu = memo(function SpeedMenu({
  playbackRate,
  setPlaybackRate,
  disabled,
}: SpeedMenuProps) {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const closeMenu = useCallback(() => setShowSpeedMenu(false), []);
  // Ref on the container (trigger + menu) so trigger clicks toggle instead of
  // close-then-reopen; Escape also dismisses.
  const speedMenuContainerRef = useContextMenuDismiss(closeMenu);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    if (!speedMenuRef.current || !(speedMenuContainerRef.current instanceof HTMLElement)) return;
    const trigger = speedMenuContainerRef.current.getBoundingClientRect();
    const menu = speedMenuRef.current.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const top = trigger.top - menu.height - gap >= edge ? trigger.top - menu.height - gap : trigger.bottom + gap;
    const left = Math.min(Math.max(edge, trigger.right - menu.width), window.innerWidth - menu.width - edge);
    setMenuPosition({ top, left });
  }, [speedMenuContainerRef]);

  useLayoutEffect(() => {
    if (!showSpeedMenu) {
      setMenuPosition(null);
      return;
    }
    const reposition = updateMenuPosition;
    updateMenuPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [showSpeedMenu, updateMenuPosition]);

  return (
    <div ref={speedMenuContainerRef} className="relative shrink-0">
      <Tooltip label="Playback speed">
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={showSpeedMenu}
          aria-label="Playback speed"
          className="h-7 w-8 rounded-md font-mono text-[10px] tabular-nums text-neutral-400 transition-colors hover:text-neutral-200 disabled:opacity-30"
        >
          {playbackRate === 1 ? "1x" : `${playbackRate}x`}
        </button>
      </Tooltip>
      {showSpeedMenu && createPortal(
        <div
          ref={speedMenuRef}
          role="menu"
          aria-label="Playback speed options"
          className="fixed z-[1000] max-h-[calc(100vh-16px)] min-w-[56px] overflow-y-auto overflow-x-hidden rounded-lg shadow-xl"
          style={{
            top: menuPosition?.top ?? 0,
            left: menuPosition?.left ?? 0,
            visibility: menuPosition ? "visible" : "hidden",
            background: "#161618",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {SPEED_OPTIONS.map((rate) => {
            const isCurrent = rate === playbackRate;
            return (
              <button
                key={rate}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  trackStudioEvent("playback", { action: "speed_change", rate });
                  setPlaybackRate(rate);
                  setShowSpeedMenu(false);
                }}
                className={`block w-full px-3 py-1.5 text-[11px] text-left font-mono tabular-nums transition-colors outline-hidden focus-visible:bg-white/4 ${
                  isCurrent ? "text-neutral-50 bg-white/6" : "text-neutral-500 hover:bg-white/4"
                }`}
              >
                {rate}x
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
});
