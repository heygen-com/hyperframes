import { useState, useCallback, memo } from "react";
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
  const closeMenu = useCallback(() => setShowSpeedMenu(false), []);
  // Ref on the container (trigger + menu) so trigger clicks toggle instead of
  // close-then-reopen; Escape also dismisses.
  const speedMenuContainerRef = useContextMenuDismiss(closeMenu);

  return (
    <div ref={speedMenuContainerRef} className="relative flex-shrink-0">
      <Tooltip label="Playback speed">
        <button
          type="button"
          onClick={() => setShowSpeedMenu((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={showSpeedMenu}
          aria-label="Playback speed"
          className="w-10 px-2 py-1 rounded-md text-[10px] font-mono tabular-nums transition-colors disabled:opacity-40"
          style={{ color: "#71717A", background: "rgba(255,255,255,0.04)" }}
        >
          {playbackRate === 1 ? "1x" : `${playbackRate}x`}
        </button>
      </Tooltip>
      {showSpeedMenu && (
        <div
          role="menu"
          aria-label="Playback speed options"
          className="absolute bottom-full right-0 mb-1.5 rounded-lg shadow-xl z-50 min-w-[56px] overflow-hidden"
          style={{ background: "#161618", border: "1px solid rgba(255,255,255,0.08)" }}
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
                className={`block w-full px-3 py-1.5 text-[11px] text-left font-mono tabular-nums transition-colors outline-none focus-visible:bg-white/[0.04] ${
                  isCurrent
                    ? "text-neutral-50 bg-white/[0.06]"
                    : "text-neutral-500 hover:bg-white/[0.04]"
                }`}
              >
                {rate}x
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
