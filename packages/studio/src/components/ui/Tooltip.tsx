/**
 * Tooltip — Base UI's tooltip wearing Studio's tokens, same props as before.
 * The trigger is a box-owning wrapper, because browsers send no hover to a
 * disabled control and disabled controls must still explain themselves.
 */

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cloneElement, useId, useState, type ReactElement } from "react";

interface TooltipProps {
  label: string;
  /** A single element, wrapped so a disabled one still receives hover. */
  children: ReactElement<{ "aria-describedby"?: string }>;
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
      <BaseTooltip.Trigger delay={delay} render={<span className="inline-flex" />}>
        {cloneElement(children, {
          "aria-describedby": open ? tooltipId : children.props["aria-describedby"],
        })}
      </BaseTooltip.Trigger>
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
