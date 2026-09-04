/**
 * Tooltip — Base UI's tooltip wearing Studio's tokens.
 *
 * The props are the ones Studio's own tooltip had (`label`, `delay`, `side`),
 * so the call sites did not change. What changed underneath is who owns the
 * hard parts: the portal, the viewport flip and the shift away from a collision
 * edge are the library's now, not a hand-rolled clamp against an approximated
 * bubble height.
 *
 * Two accessibility details stay ours, because Base UI 1.7.0 does not add them:
 *
 *  - WCAG 4.1.2: the popup carries `role="tooltip"` and an id, and the trigger
 *    points at that id with `aria-describedby` while it is open. That is why
 *    the open state is controlled here rather than left to the library.
 *  - WCAG 1.4.13: Escape dismisses. This one Base UI does provide, through its
 *    dismiss interaction, and `Tooltip.test.tsx` holds it to that.
 *
 * The trigger renders the caller's own element (Base UI's `render` prop) rather
 * than wrapping it. A wrapper would need a box to be positioned against, and
 * the old `display: contents` wrapper had none.
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
