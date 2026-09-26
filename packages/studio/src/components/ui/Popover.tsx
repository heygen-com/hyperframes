/**
 * Popover: `Menu`'s floating chrome (`popupSurface`) without item semantics, so arrow keys
 * stay with whatever is focused inside (rename inputs, forms). Only the shadow differs.
 */

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { popupSurface, type PopupPreviewState } from "./Menu";

type PortalContainer = ComponentPropsWithoutRef<typeof BasePopover.Portal>["container"];

/** Matches Menu's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

interface PopoverProps extends Omit<ComponentPropsWithoutRef<typeof BasePopover.Root>, "children"> {
  /** A single element. It becomes the trigger; no wrapper is added around it. */
  trigger: ReactElement;
  /** Arbitrary content. The popover owns none of its keys. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Portal target. Pass the shadow root when the trigger lives in one. */
  container?: PortalContainer;
  /** Names the popup for assistive tech. */
  "aria-label"?: string;
  /**
   * What to focus on open. Defaults to Base UI's behaviour (the first tabbable
   * element), which is what a rename field wants.
   */
  initialFocus?: ComponentPropsWithoutRef<typeof BasePopover.Popup>["initialFocus"];
  className?: string;
  "data-preview-state"?: PopupPreviewState;
}

export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "center",
  sideOffset = SIDE_OFFSET,
  container,
  className,
  initialFocus,
  "aria-label": ariaLabel,
  "data-preview-state": previewState,
  ...root
}: PopoverProps) {
  return (
    <BasePopover.Root {...root}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={VIEWPORT_MARGIN}
          className="z-200"
        >
          <BasePopover.Popup
            aria-label={ariaLabel}
            initialFocus={initialFocus}
            data-preview-state={previewState}
            className={cn(popupSurface, "p-3 text-step-11 text-text-1 shadow-popover", className)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
