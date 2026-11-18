/**
 * Menu and ContextMenu on Base UI. Dismissal is plain Base UI (capture-phase listeners survive the overlay's
 * `stopPropagation`); `trigger` is rendered, not wrapped; `container` exists for shadow roots.
 */

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useRef } from "react";
import type { ComponentPropsWithoutRef, ElementType, ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Base UI lets `className` be a function of the part's state. Studio's parts
 * merge a string with `cn`, so the string form is the one they accept.
 */
type StyledProps<T extends ElementType> = Omit<ComponentPropsWithoutRef<T>, "className"> & {
  className?: string;
};

/** Forces the settled open look for a gallery shot; CSS-only, open state stays controlled. */
export type PopupPreviewState = "open";

/** Where the portal puts the popup. `null` keeps it inline, next to its trigger. */
export type PortalContainer = ComponentPropsWithoutRef<typeof BaseMenu.Portal>["container"];

const CONTENTS = { display: "contents" } as const;

/** Base UI reads a `null` container as "not resolved yet" and renders nothing, so give `null` a host by the trigger. */
export function useInlinePortal(container: PortalContainer) {
  const host = useRef<HTMLSpanElement>(null);
  if (container !== null) return { host: null, portal: { container } };
  return {
    host: <span ref={host} style={CONTENTS} />,
    portal: { container: host, style: CONTENTS },
  };
}

/** Matches Tooltip's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Enter and exit shared by menus, popovers, dropdowns, and tooltips.
 * The open duration class differs; the shape does not.
 * `data-starting-style`/`data-ending-style` are Base UI's transition attributes.
 */
export function floatingMotion(openDuration: "duration-open" | "duration-tooltip") {
  return cn(
    "origin-[var(--transform-origin)] outline-hidden",
    "transition-[opacity,scale] ease-out-quint",
    openDuration,
    "data-[ending-style]:duration-close data-[ending-style]:ease-in",
    "data-[starting-style]:[opacity:var(--popup-enter-opacity)]",
    "data-[starting-style]:[scale:var(--popup-enter-scale)]",
    "data-[ending-style]:opacity-0",
  );
}

/**
 * Chrome shared by every floating panel (`Popover` too); callers add their own shadow token.
 */
export const popupSurface = cn(
  "rounded-lg border border-border-input bg-surface",
  floatingMotion("duration-open"),
  "data-[preview-state=open]:opacity-100 data-[preview-state=open]:scale-100",
);

/** Every floating list, menu, popover and tooltip sits on this layer, above panel chrome and modals. */
export const POPUP_LAYER = "z-200";

const menuPopup = cn(popupSurface, "min-w-36 p-1 shadow-menu");

/** One row. `data-highlighted` is set by keyboard and pointer alike, so the seen row is the Enter row. */
export const menuItemBase = cn(
  "flex cursor-default select-none items-center justify-between gap-6 rounded-[calc(var(--radius-lg)-4px)] px-2 py-1.5",
  "text-step-11 whitespace-nowrap text-text-1",
  "outline-hidden transition-colors ease-out-quint duration-hover",
  "data-[highlighted]:bg-hover data-[highlighted]:text-text-0",
  "data-[preview-state=hover]:bg-hover data-[preview-state=hover]:text-text-0",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

const itemDanger = cn(
  "text-danger-ink data-[highlighted]:bg-danger/15 data-[highlighted]:text-danger-ink",
);

export type MenuItemTone = "default" | "danger";

interface PositionedProps {
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Portal target. Pass the shadow root when the trigger lives in one; `null` keeps it inline. */
  container?: PortalContainer;
  /** Names the popup for assistive tech. A menu with no name is unlabelled. */
  "aria-label"?: string;
  className?: string;
  "data-preview-state"?: PopupPreviewState;
}

/** What Base UI hands `onOpenChange`: why it would close, the event, and a way to keep it open. */
type OpenChangeDetails = { reason: string; event: Event; cancel: () => void };

/**
 * The topmost open layer owns Escape. Escape pressed inside a dialog that holds neither this popup nor its trigger (one
 * opened from the popup's own row) keeps the popup open and leaves the key alone, so that dialog closes first; the
 * popup hears the next Escape, once it is on top again.
 */
export function useTopLayerEscape<D extends OpenChangeDetails>(
  onOpenChange: ((open: boolean, details: D) => void) | undefined,
) {
  const own = useRef<{ popup: Element | null; trigger: Element | null }>({
    popup: null,
    trigger: null,
  });
  const change = (open: boolean, details: D) => {
    const { popup, trigger } = own.current;
    if (
      !open &&
      details.reason === "escape-key" &&
      insideLayerAbove([popup, trigger], details.event)
    )
      return details.cancel();
    onOpenChange?.(open, details);
  };
  return {
    popup: (el: Element | null) => void (own.current.popup = el),
    trigger: (el: Element | null) => void (own.current.trigger = el),
    onOpenChange: change,
  };
}

/** Whether `event` started inside an open dialog or modal that holds none of `own`. */
function insideLayerAbove(own: (Element | null)[], event: Event): boolean {
  const from = event.composedPath()[0];
  const layer = from instanceof Element ? from.closest('dialog[open], [aria-modal="true"]') : null;
  return layer !== null && !own.some((el) => el !== null && layer.contains(el));
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
  const inline = useInlinePortal(container);
  const escape = useTopLayerEscape(root.onOpenChange);
  return (
    <BaseMenu.Root {...root} onOpenChange={escape.onOpenChange}>
      <BaseMenu.Trigger ref={escape.trigger} render={trigger} />
      {inline.host}
      <BaseMenu.Portal {...inline.portal}>
        <BaseMenu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={VIEWPORT_MARGIN}
          className={POPUP_LAYER}
        >
          <BaseMenu.Popup
            ref={escape.popup}
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

/** Opened by right click or long press at the pointer, so `side` and `align` are not offered. */
export function ContextMenu({
  trigger,
  children,
  container,
  className,
  "aria-label": ariaLabel,
  "data-preview-state": previewState,
  ...root
}: Omit<ContextMenuProps, "side" | "align" | "sideOffset">) {
  const inline = useInlinePortal(container);
  const escape = useTopLayerEscape(root.onOpenChange);
  return (
    <BaseContextMenu.Root {...root} onOpenChange={escape.onOpenChange}>
      <BaseContextMenu.Trigger ref={escape.trigger} render={trigger} />
      {inline.host}
      <BaseContextMenu.Portal {...inline.portal}>
        <BaseContextMenu.Positioner collisionPadding={VIEWPORT_MARGIN} className={POPUP_LAYER}>
          <BaseContextMenu.Popup
            ref={escape.popup}
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

/** Keyboard shortcut hint, mono and tabular; exported for hints that are not a plain string. */
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

/** One action. `disabled` items are skipped by the arrow keys, not just dimmed. */
export function MenuItem({ shortcut, tone, className, children, ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(menuItemBase, tone === "danger" && itemDanger, className)}
      {...props}
    >
      <span className="truncate">{children}</span>
      {shortcut ? <MenuShortcut>{shortcut}</MenuShortcut> : null}
    </BaseMenu.Item>
  );
}

/** Single-choice group; selection is `aria-checked` on each item, which the dot indicator draws from. */
export function MenuRadioGroup(props: ComponentPropsWithoutRef<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup {...props} />;
}

interface MenuRadioItemProps extends StyledProps<typeof BaseMenu.RadioItem> {
  "data-preview-state"?: "hover";
}

/** One choice in a `MenuRadioGroup`. The dot renders only while it is checked. */
export function MenuRadioItem({ className, children, ...props }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem className={cn(menuItemBase, className)} {...props}>
      <span className="truncate">{children}</span>
      {/* Fixed box so a checked and an unchecked row keep the same width. */}
      <span className="flex size-3 shrink-0 items-center justify-center">
        <BaseMenu.RadioItemIndicator className="size-1.5 rounded-full bg-accent" />
      </span>
    </BaseMenu.RadioItem>
  );
}

/** An on/off row; the tick renders only while `checked`. */
export function MenuCheckboxItem({
  className,
  children,
  ...props
}: StyledProps<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem className={cn(menuItemBase, className)} {...props}>
      <span className="truncate">{children}</span>
      <span className="flex size-3 shrink-0 items-center justify-center text-accent-ink">
        <BaseMenu.CheckboxItemIndicator>✓</BaseMenu.CheckboxItemIndicator>
      </span>
    </BaseMenu.CheckboxItem>
  );
}

/** A hairline between two groups of items. */
export function MenuSeparator({ className, ...props }: StyledProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={cn("my-1 h-px bg-hairline", className)} {...props} />;
}
