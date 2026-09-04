/**
 * Tabs — Base UI's tabs wearing Studio's tokens.
 *
 * Studio has six hand-rolled tab strips today. Three render `aria-pressed`
 * buttons that no arrow key reaches; the sidebar's has a keyboard handler
 * written by hand. This primitive is the one implementation: roving tabindex,
 * arrow keys, Home and End, `aria-controls` wiring, all from the library.
 *
 * `activateOnFocus` is on because that is what the sidebar strip does today
 * (arrow keys move selection, not just focus), and switching a panel is cheap.
 *
 * Each tab carries `data-tab-id` with its value. The sidebar's focus-restore
 * path finds a tab by that attribute, and an attribute the component owns
 * survives a reskin where a class does not.
 */

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "./cn";
import type { PreviewState } from "./Button";

/**
 * Base UI lets `className` be a function of the part's state. Studio's parts
 * merge a string with `cn`, so the string form is the one they accept.
 */
type StyledProps<T extends ElementType> = Omit<ComponentPropsWithoutRef<T>, "className"> & {
  className?: string;
};

/**
 * Groups a tab list with its panels. Uncontrolled by default; pass `value` and
 * `onValueChange` for a strip whose selection lives in a store.
 */
export function Tabs(props: ComponentPropsWithoutRef<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />;
}

/** The strip. Give it an `aria-label`: a tablist with no name is unlabelled. */
export function TabsList({ className, ...props }: StyledProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      activateOnFocus
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-surface-alt p-1", className)}
      {...props}
    />
  );
}

interface TabProps extends StyledProps<typeof BaseTabs.Tab> {
  value: string;
  "data-preview-state"?: PreviewState;
}

/**
 * One tab. The selected look hangs off `aria-selected`, which Base UI sets, so
 * the state that assistive tech reads and the state the eye reads are the same
 * one. The `data-preview-state` classes repeat the hover look for a gallery
 * shot; they change no behaviour.
 */
export function Tab({ value, className, ...props }: TabProps) {
  return (
    <BaseTabs.Tab
      value={value}
      data-tab-id={value}
      className={cn(
        "inline-flex h-ctl-sm cursor-pointer select-none items-center justify-center rounded-sm px-2.5",
        "text-step-11 font-semibold whitespace-nowrap text-text-3",
        "transition-[background-color,color] ease-out-quint duration-hover",
        "hover:text-text-1 data-[preview-state=hover]:text-text-1",
        "aria-selected:bg-hover aria-selected:text-text-0",
        "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        "data-[preview-state=focus]:outline-solid data-[preview-state=focus]:outline-2 data-[preview-state=focus]:outline-offset-1 data-[preview-state=focus]:outline-accent",
        className,
      )}
      {...props}
    />
  );
}

/** The panel for one tab. Base UI wires `aria-labelledby` back to its tab. */
export function TabPanel({ className, ...props }: StyledProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn("outline-hidden", className)} {...props} />;
}
