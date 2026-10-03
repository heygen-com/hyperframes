/** The one owner of a context menu's spacing and shape: no padding or margin around rows, and a panel that clips to
 * its rounded corners, so a row's highlight fills its row. menuStyle.test.ts holds every menu panel to it. */
export const menuClasses = {
  /** The panel: fill, border, shadow and radius on one element, clipped to that radius. A submenu inside it is
   * `position: fixed` so the clip does not cut it off. */
  panel:
    "overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg",
  /** A group of rows ending in a divider; an empty group takes no room. */
  group: "empty:hidden border-b border-neutral-700/60",
  /** A line between two rows. */
  divider: "border-t border-neutral-700/60",
  /** A row's size and shape; tone, layout (`flex`, `justify-between`) and focus come from the caller. */
  row: "w-full px-3 py-1.5 text-left text-xs outline-hidden",
  rowEnabled:
    "text-neutral-300 hover:bg-neutral-800 focus-visible:bg-neutral-800 cursor-pointer",
  rowDanger:
    "text-danger-ink hover:bg-danger/25 focus-visible:bg-danger/25 cursor-pointer",
  rowDisabled: "text-neutral-600 cursor-not-allowed",
} as const;
