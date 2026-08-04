/**
 * The floating chrome shared by everything that draws over the canvas: the
 * agent composer, the run tray, both context menus, the ask handle.
 *
 * They are class strings rather than components because each surface owns its
 * own layout and positioning — what they share is the material (depth from a
 * layered shadow, a hairline ring for legibility over unknown content) and the
 * row treatment inside it. Copying those strings around is how the menus and
 * the tray drifted apart in the first place.
 */

/** Depth from shadow, not a border; the ring only keeps the edge legible. */
export const FLOATING_SURFACE =
  "bg-neutral-950/95 ring-1 ring-white/10 backdrop-blur-md " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]";

/** Same material, smaller drop — for handles and chips, not panels. */
export const FLOATING_CHIP =
  "bg-neutral-950/95 ring-1 ring-white/10 backdrop-blur-md " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.5),0_8px_20px_-8px_rgba(0,0,0,0.7)]";

/**
 * A row inside a floating surface. Radii stay concentric with a `p-1` container
 * (12px outer, 4px padding, 8px row), and the fill covers the whole row instead
 * of leaving gutters at its edges.
 */
export const MENU_ROW =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs " +
  "transition-colors duration-150 ease-out";

export const MENU_ROW_ENABLED = "cursor-pointer text-neutral-200 hover:bg-neutral-800/80";
export const MENU_ROW_DISABLED = "cursor-not-allowed text-neutral-600";
export const MENU_ROW_DANGER =
  "cursor-pointer text-red-400 transition-colors duration-150 ease-out hover:bg-red-500/10";

/** Full-bleed hairline between row groups. */
export const MENU_DIVIDER = "-mx-1 my-1 h-px bg-white/10";

/** Small ghost control that only earns attention on hover. */
export const GHOST_ICON_BUTTON =
  "rounded-md p-0.5 text-neutral-600 transition-colors duration-150 ease-out " +
  "hover:bg-neutral-800/70 hover:text-neutral-200 active:scale-[0.96] " +
  "disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-neutral-600";
