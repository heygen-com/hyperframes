/**
 * Menu and ContextMenu — Base UI's menus wearing Studio's tokens.
 *
 * Studio has six hand-rolled menus today. Each one re-decides the same things:
 * a surface colour, a radius, a shadow, which key moves the highlight, whether
 * a right-click opens at the pointer, and how an outside press dismisses it.
 * This file decides them once.
 *
 * Three things are worth knowing before reading the code:
 *
 *  - **Dismissal is plain Base UI, with no wrapper.** Studio's canvas overlay
 *    calls `stopPropagation()` on its own bubble-phase pointer handlers, which
 *    is why `useContextMenuDismiss` had to listen in the capture phase. Base UI
 *    registers its outside-press listeners on `document` with capture set, so
 *    an upstream bubble-phase stop cannot starve them. U3 proved that over the
 *    real overlay; `Menu.test.tsx` re-asserts it on this component.
 *
 *  - **`trigger` is rendered, not wrapped.** Both menus take the caller's own
 *    element through Base UI's `render` prop, the way `Tooltip` does. A wrapper
 *    would need a box of its own to position against, and a `display: contents`
 *    wrapper has none.
 *
 *  - **`container` exists for shadow roots.** Studio mounts surfaces inside
 *    shadow roots; a portal that always lands on `<body>` would drop the popup
 *    out of the host's stylesheet.
 *
 * The open motion names `duration-open`, the token that zeroes itself under
 * `prefers-reduced-motion` (see `theme.css`), so a menu cannot use the token
 * and forget the reduced-motion case.
 */

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentPropsWithoutRef, ElementType, ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Base UI lets `className` be a function of the part's state. Studio's parts
 * merge a string with `cn`, so the string form is the one they accept.
 */
type StyledProps<T extends ElementType> = Omit<ComponentPropsWithoutRef<T>, "className"> & {
  className?: string;
};

/**
 * Forces the settled open look for a gallery shot, so a screenshot cannot catch
 * the popup mid-transition. CSS-only: the open state itself stays controlled by
 * the caller or by Base UI.
 */
export type PopupPreviewState = "open";

/** Where the portal puts the popup. `null` keeps it inline, next to its trigger. */
type PortalContainer = ComponentPropsWithoutRef<typeof BaseMenu.Portal>["container"];

/** Matches Tooltip's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

/**
 * The chrome every floating panel in Studio shares: surface, radius, hairline
 * ring, and the open motion. `Popover` wears this too, which is what makes a
 * context menu and a settings panel read as the same system. Each caller adds
 * its own shadow token (`shadow-menu` or `shadow-popover`).
 *
 * `data-starting-style` and `data-ending-style` are Base UI's transition
 * attributes; the popup is mounted with them set, so a plain CSS transition is
 * enough and no animation library is involved.
 */
export const popupSurface = cn(
  "rounded-lg border border-border-input bg-surface",
  "origin-[var(--transform-origin)] outline-hidden",
  "transition-[opacity,transform] ease-out-quint duration-open",
  "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
  "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
  "data-[preview-state=open]:opacity-100 data-[preview-state=open]:scale-100",
);

/** The popup's own layer: menus sit above panel chrome and below a modal. */
const POPUP_LAYER = "z-200";

const menuPopup = cn(popupSurface, "min-w-36 p-1 shadow-menu");

/**
 * One row. The highlight hangs off `data-highlighted`, which Base UI sets from
 * keyboard and pointer alike, so the row the eye sees and the row Enter
 * activates cannot disagree.
 */
const itemBase = cn(
  "flex cursor-default select-none items-center justify-between gap-6 rounded-sm px-2 py-1.5",
  "text-step-11 whitespace-nowrap text-text-1",
  "outline-hidden transition-colors ease-out-quint duration-hover",
  "data-[highlighted]:bg-hover data-[highlighted]:text-text-0",
  "data-[preview-state=hover]:bg-hover data-[preview-state=hover]:text-text-0",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

const itemDanger = cn("text-danger data-[highlighted]:bg-danger/15 data-[highlighted]:text-danger");

export type MenuItemTone = "default" | "danger";

interface PositionedProps {
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Portal target. Pass the shadow root when the trigger lives in one. */
  container?: PortalContainer;
  /** Names the popup for assistive tech. A menu with no name is unlabelled. */
  "aria-label"?: string;
  className?: string;
  "data-preview-state"?: PopupPreviewState;
}

interface MenuProps
  extends PositionedProps, Omit<ComponentPropsWithoutRef<typeof BaseMenu.Root>, "children"> {
  /** A single element. It becomes the trigger; no wrapper is added around it. */
  trigger: ReactElement;
  /** The items: `MenuItem`, `MenuRadioGroup`, `MenuSeparator`. */
  children: ReactNode;
}

/**
 * A menu opened by its trigger. Uncontrolled by default; pass `open` and
 * `onOpenChange` for a menu whose state lives in a store.
 */
export function Menu({
  trigger,
  children,
  side = "bottom",
  align = "start",
  sideOffset = SIDE_OFFSET,
  container,
  className,
  "aria-label": ariaLabel,
  "data-preview-state": previewState,
  ...root
}: MenuProps) {
  return (
    <BaseMenu.Root {...root}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal container={container}>
        <BaseMenu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={VIEWPORT_MARGIN}
          className={POPUP_LAYER}
        >
          <BaseMenu.Popup
            aria-label={ariaLabel}
            data-preview-state={previewState}
            className={cn(menuPopup, className)}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

interface ContextMenuProps
  extends PositionedProps, Omit<ComponentPropsWithoutRef<typeof BaseContextMenu.Root>, "children"> {
  /**
   * The right-clickable area, as the caller's own element. Its children are
   * kept: the trigger renders that element rather than wrapping it.
   */
  trigger: ReactElement;
  children: ReactNode;
}

/**
 * A menu opened by right click or long press, at the pointer. `side` and
 * `align` are not offered: the anchor is the pointer, so there is nothing to
 * sit beside.
 */
export function ContextMenu({
  trigger,
  children,
  container,
  className,
  "aria-label": ariaLabel,
  "data-preview-state": previewState,
  ...root
}: Omit<ContextMenuProps, "side" | "align" | "sideOffset">) {
  return (
    <BaseContextMenu.Root {...root}>
      <BaseContextMenu.Trigger render={trigger} />
      <BaseContextMenu.Portal container={container}>
        <BaseContextMenu.Positioner collisionPadding={VIEWPORT_MARGIN} className={POPUP_LAYER}>
          <BaseContextMenu.Popup
            aria-label={ariaLabel}
            data-preview-state={previewState}
            className={cn(menuPopup, className)}
          >
            {children}
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}

/**
 * A keyboard shortcut hint. Mono and tabular so a column of them lines up, and
 * dimmer than the label because it is a reminder, not an action.
 *
 * `MenuItem`'s `shortcut` prop renders this, and it is exported for the one
 * case the prop cannot cover: an item whose hint is not a plain string.
 */
export function MenuShortcut({ className, ...props }: StyledProps<"span">) {
  return (
    <span
      className={cn("shrink-0 font-mono text-step-10 tabular-nums text-text-4", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

interface MenuItemProps extends StyledProps<typeof BaseMenu.Item> {
  /** Rendered as a dim mono hint on the trailing edge. Decorative. */
  shortcut?: string;
  /** `danger` for a destructive action (Delete, Remove). */
  tone?: MenuItemTone;
  "data-preview-state"?: "hover";
}

/**
 * One action. A `disabled` item still takes the highlight from the arrow keys
 * and cannot be activated, which is Base UI's behaviour and the ARIA menu
 * pattern's: an item a keyboard user can never land on is an item they never
 * learn exists. Verified over a real browser through the gallery.
 */
export function MenuItem({
  shortcut,
  tone = "default",
  className,
  children,
  ...props
}: MenuItemProps) {
  return (
    <BaseMenu.Item className={cn(itemBase, tone === "danger" && itemDanger, className)} {...props}>
      <span className="truncate">{children}</span>
      {shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
    </BaseMenu.Item>
  );
}

/**
 * A single-choice group (SpeedMenu's playback rates). Selection is reported as
 * `aria-checked` on each item, which is the state assistive tech reads and the
 * one the dot indicator is drawn from.
 */
export function MenuRadioGroup(props: ComponentPropsWithoutRef<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup {...props} />;
}

interface MenuRadioItemProps extends StyledProps<typeof BaseMenu.RadioItem> {
  "data-preview-state"?: "hover";
}

/** One choice in a `MenuRadioGroup`. The dot renders only while it is checked. */
export function MenuRadioItem({ className, children, ...props }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem className={cn(itemBase, className)} {...props}>
      <span className="truncate">{children}</span>
      {/* Fixed box so a checked and an unchecked row keep the same width. */}
      <span className="flex size-3 shrink-0 items-center justify-center">
        <BaseMenu.RadioItemIndicator className="size-1.5 rounded-full bg-accent" />
      </span>
    </BaseMenu.RadioItem>
  );
}

/** A hairline between two groups of items. */
export function MenuSeparator({ className, ...props }: StyledProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={cn("my-1 h-px bg-hairline", className)} {...props} />;
}
