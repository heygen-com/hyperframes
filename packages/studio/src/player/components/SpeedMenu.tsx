import { forwardRef, memo, type ComponentPropsWithoutRef } from "react";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Menu, MenuRadioGroup, MenuRadioItem, Tooltip } from "../../components/ui";

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;

interface SpeedMenuProps {
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  disabled: boolean;
}

/**
 * The trigger is a component rather than a bare element because two Base UI
 * parts want to render it: the Menu's trigger and the Tooltip's. Each merges
 * its props into the element it is given, so the outer one (the Menu) hands
 * this component its props and ref, and this passes them through the Tooltip
 * to the same button. Nesting the two elements directly would leave the Menu
 * cloning a `Tooltip`, which drops every prop on the floor.
 */
const SpeedTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(
  function SpeedTrigger({ children, ...props }, ref) {
    return (
      <Tooltip label="Playback speed">
        <button
          ref={ref}
          type="button"
          aria-label="Playback speed"
          className="h-7 w-8 rounded-md font-mono text-step-10 tabular-nums text-text-3 transition-colors ease-out-quint duration-hover hover:text-text-0 disabled:opacity-30"
          {...props}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);

export const SpeedMenu = memo(function SpeedMenu({
  playbackRate,
  setPlaybackRate,
  disabled,
}: SpeedMenuProps) {
  return (
    <div className="shrink-0">
      <Menu
        side="top"
        align="end"
        aria-label="Playback speed options"
        className="min-w-14"
        trigger={
          <SpeedTrigger disabled={disabled}>
            {playbackRate === 1 ? "1x" : `${playbackRate}x`}
          </SpeedTrigger>
        }
      >
        <MenuRadioGroup
          value={playbackRate}
          onValueChange={(rate) => {
            if (typeof rate !== "number") return;
            trackStudioEvent("playback", { action: "speed_change", rate });
            setPlaybackRate(rate);
          }}
        >
          {SPEED_OPTIONS.map((rate) => (
            <MenuRadioItem key={rate} value={rate} className="font-mono tabular-nums">
              {rate}x
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Menu>
    </div>
  );
});
