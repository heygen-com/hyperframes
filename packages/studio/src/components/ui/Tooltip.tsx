/**
 * Tooltip — Base UI's tooltip wearing Studio's tokens, same props as before.
 * WCAG 4.1.2 (`aria-describedby`) and the `render`-not-wrapper trigger stay ours.
 */

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useId, useState, type ReactElement } from "react";

interface TooltipProps {
  label: string;
  /** A single element. It becomes the trigger; no wrapper is added around it. */
  children: ReactElement;
  /** Hover delay in ms. */
  delay?: number;
  side?: "top" | "bottom" | "left" | "right";
}

/** Matches the old bubble's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

export function Tooltip({ label, children, delay = 400, side = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <BaseTooltip.Root open={open} onOpenChange={setOpen}>
      <BaseTooltip.Trigger
        delay={delay}
        aria-describedby={open ? tooltipId : undefined}
        render={children}
      />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={SIDE_OFFSET}
          collisionPadding={VIEWPORT_MARGIN}
          className="z-200"
        >
          <BaseTooltip.Popup
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none rounded-md border border-border-input bg-surface px-2 py-1 text-step-10 font-medium text-text-1 whitespace-nowrap shadow-menu"
          >
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
