/**
 * Tooltip — Base UI's tooltip wearing Studio's tokens, same props as before.
 * The trigger is a `display: contents` wrapper (no layout box) so a disabled
 * control still gets hover; the bubble anchors to the child, which has the box.
 */

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cloneElement, useId, useState, type ReactElement } from "react";

interface TooltipProps {
  label: string;
  /** A single element, wrapped in a box-less span so a disabled one still gets hover. */
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
  const [box, setBox] = useState<HTMLElement | null>(null);
  const tooltipId = useId();

  return (
    <BaseTooltip.Root open={open} onOpenChange={setOpen}>
      <BaseTooltip.Trigger delay={delay} render={<span ref={setBox} className="contents" />}>
        {cloneElement(children, {
          "aria-describedby": open ? tooltipId : children.props["aria-describedby"],
        })}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          anchor={() => box?.firstElementChild ?? null}
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
