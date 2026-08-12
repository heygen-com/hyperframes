/**
 * Panel reconciliation for the Studio shell.
 *
 * The shell is `[sidebar | preview | inspector]` over a full-width timeline.
 * Only the preview is flexible (`flex-1 min-w-0`), so without an explicit floor
 * it absorbs every squeeze: at a 560px window the old 240/320 panel floors alone
 * overflowed the viewport and the preview rendered at 2px, on a *fresh* load.
 * The same held vertically once the window was resized after mount.
 *
 * Every caller (mount, resize, drag, keyboard nudge, preference restore) routes
 * through {@link fitPanelWidths} / {@link fitTimelineHeight} so exactly one place
 * decides who yields. The rule is: the preview gets its floor first, panels
 * shrink toward their minimums, then collapse to rails.
 */

/** Smallest preview box worth editing in. Chosen, not derived — see the plan. */
export const MIN_PREVIEW_W = 360;
export const MIN_PREVIEW_H = 200;

const MIN_LEFT = 200;
const MIN_RIGHT = 280;
/**
 * Collapsed sidebar rail, as a layout FOOTPRINT: the `w-10` box (40) plus the
 * `mr-0.5` gap (2) it contributes to the flex row. Measured in the browser at a
 * 760px window: rail box 40, margin-right 2, preview starts at x=43.
 */
export const RAIL_W = 42;
export const MIN_TIMELINE_H = 100;

/** The two 3px resize seams between the three top-row panels. */
const PANEL_SEAM_W = 6;

/** No single panel may claim more than this share of the window. */
const PANEL_MAX_RATIO = 0.4;

/*
 * Thresholds below are DERIVED from the minimums above, not chosen:
 *
 *   MIN_LEFT 200 + MIN_RIGHT 280 + MIN_PREVIEW_W 360 + PANEL_SEAM_W 6 = 846
 *     -> below ~860 the sidebar can no longer fit at its minimum.
 *   RAIL_W  40 + MIN_RIGHT 280 + MIN_PREVIEW_W 360 + PANEL_SEAM_W 6 = 686
 *     -> below ~700 the inspector can no longer fit either.
 *
 * Change a minimum and move the matching threshold with it.
 */
const RAIL_LEFT_BELOW = 860;
const RAIL_RIGHT_BELOW = 700;

/**
 * True when the window is narrow enough to force at least one panel to a rail.
 * The sidebar threshold is the wider of the two, so it is the whole condition.
 */
export function railsEngaged(viewportWidth: number): boolean {
  return viewportWidth < RAIL_LEFT_BELOW;
}

export interface PanelWidths {
  left: number;
  right: number;
}

export interface FittedPanelWidths extends PanelWidths {
  preview: number;
  /**
   * Width-driven collapse. Derived per render; NEVER persisted and never written
   * back to the user's own collapse preference — `leftCollapsed` lives in
   * localStorage and `rightCollapsed` is synced into the shareable Studio URL,
   * so a ten-second window drag must not rewrite either.
   */
  autoCollapseLeft: boolean;
  autoCollapseRight: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The width each panel wants on a given viewport, before reconciliation.
 * Upper bounds (384 / 424) are unchanged from the original implementation, which
 * is what keeps windows at or above 1280px byte-identical to before.
 */
export function defaultPanelWidths(viewportWidth: number): PanelWidths {
  return {
    left: Math.max(MIN_LEFT, Math.min(384, Math.round(viewportWidth * 0.257))),
    right: Math.max(MIN_RIGHT, Math.min(424, Math.round(viewportWidth * 0.284))),
  };
}

/**
 * Resolve preferred panel widths against the viewport, reserving the preview.
 *
 * Order of yielding: window-relative cap, then the inspector shrinks toward its
 * minimum, then the sidebar, then rails. A viewport of 0 (element not measured
 * yet) returns the preferences untouched so a pre-measurement frame cannot
 * clobber a real preference.
 */
// fallow-ignore-next-line complexity
export function fitPanelWidths(
  viewportWidth: number,
  preferred: PanelWidths,
  /**
   * Sides the user explicitly reopened while the window was narrow. A side
   * listed here keeps its real width instead of the rail: without this the
   * panel would render expanded at 42px and squash its own content.
   */
  reopened: { left: boolean; right: boolean } = { left: false, right: false },
): FittedPanelWidths {
  const vw = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  if (vw <= 0) {
    return { ...preferred, preview: 0, autoCollapseLeft: false, autoCollapseRight: false };
  }

  const autoCollapseLeft = vw < RAIL_LEFT_BELOW && !reopened.left;
  const autoCollapseRight = vw < RAIL_RIGHT_BELOW && !reopened.right;
  const cap = Math.floor(vw * PANEL_MAX_RATIO);

  // A railed panel's floor is its rail width; an open panel's floor is its
  // minimum usable width. Without this split the squeeze fallback below would
  // drive an *expanded* sidebar down to 40px and render its content unusable.
  const leftFloor = autoCollapseLeft ? RAIL_W : MIN_LEFT;
  const rightFloor = autoCollapseRight ? 0 : MIN_RIGHT;

  let left = autoCollapseLeft ? RAIL_W : clamp(preferred.left, MIN_LEFT, Math.max(MIN_LEFT, cap));
  let right = autoCollapseRight ? 0 : clamp(preferred.right, MIN_RIGHT, Math.max(MIN_RIGHT, cap));

  const budget = vw - MIN_PREVIEW_W - PANEL_SEAM_W;
  if (left + right > budget) right = Math.max(rightFloor, budget - left);
  if (left + right > budget) left = Math.max(leftFloor, budget - right);

  return {
    left,
    right,
    preview: Math.max(0, vw - left - right - PANEL_SEAM_W),
    autoCollapseLeft,
    autoCollapseRight,
  };
}

/**
 * Resolve a preferred timeline height against the shell's measured height.
 *
 * Subsumes the clamping that used to be inlined in TimelineResizeDivider's
 * pointer and keyboard handlers and duplicated (mount-only) in NLEContext.
 */
export function fitTimelineHeight(containerHeight: number, preferred: number): number {
  const h = Number.isFinite(containerHeight) ? containerHeight : 0;
  const wanted = Number.isFinite(preferred) ? preferred : MIN_TIMELINE_H;
  if (h <= 0) return Math.max(MIN_TIMELINE_H, wanted);
  return clamp(wanted, MIN_TIMELINE_H, Math.max(MIN_TIMELINE_H, h - MIN_PREVIEW_H));
}
