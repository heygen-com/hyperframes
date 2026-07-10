/**
 * Pure z-order helpers for the canvas right-click context menu.
 *
 * Layering strategy: z-index + CSS stacking context (position ≠ static).
 * All sibling z-index values are read from the live iframe DOM via
 * element.style.zIndex (inline style, set by the editor) falling back to
 * the computed value. Treat missing / "auto" as 0 for comparison purposes.
 *
 * "Overlapping siblings" = siblings whose bounding rects intersect the
 * target's bounding rect. Forward/backward operate within that set;
 * front/back operate across all siblings.
 *
 * ── Tie-awareness ────────────────────────────────────────────────────────────
 * CSS paint order for elements that share a z-index is DOM document order:
 * the element that comes LATER in the DOM paints ON TOP. The old resolver
 * compared z-index alone, so a target tied with the element visually below it
 * (equal z, target later in DOM) had an empty "below" set and silently
 * no-op'd. This module computes true render order — sort by
 * (zIndex asc, DOM position asc), bottom→top — moves the target one step (or
 * to an end) in that order, then realizes the new order back into z values.
 *
 * The result is a MULTI-element patch: a single-element patch when a
 * strictly-between z value can express the new order given DOM-order
 * tie-breaking, otherwise a minimal renumber of the affected set (emitting
 * patches only for elements whose z actually changes). z is never negative
 * (project convention clamps z ≥ 0).
 */

export type ZOrderAction = "bring-forward" | "send-backward" | "bring-to-front" | "send-to-back";

/** A resolved change: set `element`'s z-index to `zIndex`. */
export interface ZOrderPatch {
  element: HTMLElement;
  zIndex: number;
}

interface RenderEntry {
  element: HTMLElement;
  zIndex: number;
  /** Position within the shared parent's children (DOM document order). */
  domIndex: number;
}

/** Parse a z-index string to a number; treats "auto" / empty as 0. */
export function parseZIndex(value: string | null | undefined): number {
  if (!value || value === "auto") return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Read the effective z-index for an element (inline style preferred). */
export function readEffectiveZIndex(el: HTMLElement): number {
  const inline = el.style.zIndex;
  if (inline && inline !== "auto") return parseZIndex(inline);
  try {
    const win = el.ownerDocument?.defaultView;
    if (win) return parseZIndex(win.getComputedStyle(el).zIndex);
  } catch {
    /* cross-origin / detached */
  }
  return 0;
}

/**
 * Realm-safe HTMLElement check. The target lives in the preview IFRAME's
 * document, but this module runs in the top window, so `child instanceof
 * HTMLElement` (top-window constructor) is ALWAYS false for iframe elements —
 * which silently emptied the sibling list and left every z-order action
 * permanently disabled. Compare against the element's own realm instead, with
 * a nodeType fallback for detached / cross-realm edge cases.
 */
function isElementNode(node: Node): node is HTMLElement {
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.HTMLElement) return true;
  return node.nodeType === 1;
}

/**
 * Collect the target plus every HTMLElement sibling (same parent), tagged with
 * DOM document position. Returns the target's own index within the result.
 */
function getFamily(target: HTMLElement): { entries: RenderEntry[]; targetIndex: number } {
  const parent = target.parentElement;
  if (!parent) return { entries: [], targetIndex: -1 };
  const entries: RenderEntry[] = [];
  let targetIndex = -1;
  let domIndex = 0;
  for (const child of Array.from(parent.children)) {
    if (!isElementNode(child)) continue;
    if (child === target) targetIndex = entries.length;
    entries.push({ element: child, zIndex: readEffectiveZIndex(child), domIndex });
    domIndex += 1;
  }
  return { entries, targetIndex };
}

/** True if two DOM bounding rects intersect (even if touching). */
function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Restrict a family to the target plus siblings whose bounding rect overlaps
 * the target's rect. The target is always retained. If the target's rect is
 * unavailable or empty (headless / happy-dom returns 0×0), all entries are
 * kept — matching the prior behavior.
 */
function getOverlappingFamily(target: HTMLElement, entries: RenderEntry[]): RenderEntry[] {
  let targetRect: DOMRect;
  try {
    targetRect = target.getBoundingClientRect();
  } catch {
    return entries;
  }
  if (targetRect.width === 0 && targetRect.height === 0) return entries;
  const tr = {
    left: targetRect.left,
    top: targetRect.top,
    right: targetRect.right,
    bottom: targetRect.bottom,
  };
  return entries.filter((entry) => {
    if (entry.element === target) return true;
    try {
      const r = entry.element.getBoundingClientRect();
      return rectsIntersect(tr, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    } catch {
      return false;
    }
  });
}

/** Sort a family into render order (bottom→top): z asc, then DOM position asc. */
function toRenderOrder(entries: RenderEntry[]): RenderEntry[] {
  return [...entries].sort((a, b) => a.zIndex - b.zIndex || a.domIndex - b.domIndex);
}

/**
 * Realize a desired render order (bottom→top) into z-index patches for the
 * given family, emitting patches ONLY for elements whose z actually changes.
 *
 * Fast path: if the existing z values are all distinct, the render order is
 * fully determined by z alone — a single-element move can be expressed by
 * placing the target's z strictly between its new neighbours (or at an end),
 * so at most one element changes. When ties exist a between value can be
 * impossible, so renumber the family to distinct ascending values
 * (0..n-1, bottom→top) and diff. Follows computeReorderZValues' dupe-driven
 * renumber precedent in player/lib/layerOrdering.ts.
 */
function realizeOrder(
  currentOrder: RenderEntry[],
  desiredOrder: RenderEntry[],
  target: HTMLElement,
): ZOrderPatch[] | null {
  const targetPos = desiredOrder.findIndex((e) => e.element === target);
  if (targetPos === -1) return null;

  const targetZ = readEffectiveZIndex(target);

  // ── Fast path: distinct z values → a single between-value move suffices.
  const zValues = currentOrder.map((e) => e.zIndex);
  const hasDupes = zValues.some((v, i) => zValues.indexOf(v) !== i);
  if (!hasDupes) {
    const below = desiredOrder[targetPos - 1];
    const above = desiredOrder[targetPos + 1];
    // Compute a z that lands the target between `below` and `above` in render
    // order. Equal-z ties break by DOM order, so a plain equality can flip the
    // order unpredictably; require a strict gap and clamp at 0.
    let candidate: number | null = null;
    if (below && above) {
      if (above.zIndex - below.zIndex >= 2) candidate = below.zIndex + 1;
    } else if (below && !above) {
      candidate = below.zIndex + 1; // move to top
    } else if (!below && above) {
      candidate = Math.max(0, above.zIndex - 1); // move to bottom
      if (candidate >= above.zIndex) candidate = null; // no room below → renumber
    }
    if (candidate !== null) {
      if (candidate === targetZ) return null;
      return [{ element: target, zIndex: candidate }];
    }
    // else fall through to renumber
  }

  // ── Renumber path: assign distinct ascending z (bottom→top) and diff.
  const patches: ZOrderPatch[] = [];
  desiredOrder.forEach((entry, i) => {
    if (entry.zIndex !== i) patches.push({ element: entry.element, zIndex: i });
  });
  return patches.length === 0 ? null : patches;
}

/**
 * Resolve the z-order patches for an action.
 *
 * Returns null when the action is a no-op (target already at the relevant
 * end of its set), otherwise the minimal list of {element, zIndex} changes.
 */
export function resolveZOrderChange(
  target: HTMLElement,
  action: ZOrderAction,
): ZOrderPatch[] | null {
  const { entries } = getFamily(target);
  // Family always includes the target; fewer than 2 means no siblings at all.
  if (entries.length < 2) return null;

  const scoped =
    action === "bring-to-front" || action === "send-to-back"
      ? entries
      : getOverlappingFamily(target, entries);
  if (scoped.length < 2) return null;

  const order = toRenderOrder(scoped);
  const pos = order.findIndex((e) => e.element === target);
  if (pos === -1) return null;

  const desired = [...order];
  const [moved] = desired.splice(pos, 1);
  switch (action) {
    case "bring-forward":
      if (pos >= order.length - 1) return null; // already top of set
      desired.splice(pos + 1, 0, moved);
      break;
    case "send-backward":
      if (pos <= 0) return null; // already bottom of set
      desired.splice(pos - 1, 0, moved);
      break;
    case "bring-to-front":
      if (pos >= order.length - 1) return null;
      desired.push(moved);
      break;
    case "send-to-back":
      if (pos <= 0) return null;
      desired.unshift(moved);
      break;
  }

  return realizeOrder(order, desired, target);
}

/**
 * Whether a z-order action is available for the target.
 * "disabled" = the element is already at that limit.
 */
export function isZOrderActionEnabled(target: HTMLElement, action: ZOrderAction): boolean {
  return resolveZOrderChange(target, action) !== null;
}
