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
 */

interface SiblingZEntry {
  element: HTMLElement;
  zIndex: number;
}

/** Parse a z-index string to a number; treats "auto" / empty as 0. */
export function parseZIndex(value: string | null | undefined): number {
  if (!value || value === "auto") return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Read the effective z-index for an element (inline style preferred). */
function readEffectiveZIndex(el: HTMLElement): number {
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

/** Collect all HTMLElement siblings (same parent) except the target itself. */
function getSiblingEntries(target: HTMLElement): SiblingZEntry[] {
  const parent = target.parentElement;
  if (!parent) return [];
  const entries: SiblingZEntry[] = [];
  for (const child of Array.from(parent.children)) {
    if (child === target) continue;
    if (!isElementNode(child)) continue;
    entries.push({ element: child, zIndex: readEffectiveZIndex(child) });
  }
  return entries;
}

/** True if two DOM bounding rects intersect (even if touching). */
function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Siblings whose bounding rect overlaps the target's rect. */
function getOverlappingSiblings(target: HTMLElement, all: SiblingZEntry[]): SiblingZEntry[] {
  let targetRect: DOMRect;
  try {
    targetRect = target.getBoundingClientRect();
  } catch {
    return all;
  }
  if (targetRect.width === 0 && targetRect.height === 0) return all;
  const tr = {
    left: targetRect.left,
    top: targetRect.top,
    right: targetRect.right,
    bottom: targetRect.bottom,
  };
  return all.filter((entry) => {
    try {
      const r = entry.element.getBoundingClientRect();
      return rectsIntersect(tr, {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    } catch {
      return false;
    }
  });
}

/**
 * Resolve the new z-index for a z-order action.
 *
 * Returns null when the action is a no-op (already at limit).
 */
export function resolveZOrderChange(
  target: HTMLElement,
  action: "bring-forward" | "send-backward" | "bring-to-front" | "send-to-back",
): number | null {
  const allSiblings = getSiblingEntries(target);
  const targetZ = readEffectiveZIndex(target);

  if (action === "bring-to-front" || action === "send-to-back") {
    const pool = allSiblings;
    if (pool.length === 0) return null;
    const maxZ = Math.max(...pool.map((e) => e.zIndex));
    const minZ = Math.min(...pool.map((e) => e.zIndex));
    if (action === "bring-to-front") {
      const next = maxZ + 1;
      return next === targetZ ? null : next;
    } else {
      const next = Math.max(0, minZ - 1);
      return next === targetZ ? null : next;
    }
  }

  // forward / backward — relative to overlapping siblings only
  const overlapping = getOverlappingSiblings(target, allSiblings);
  if (overlapping.length === 0) return null;

  if (action === "bring-forward") {
    // find the minimum z-index strictly above us
    const above = overlapping.filter((e) => e.zIndex > targetZ);
    if (above.length === 0) return null; // already on top
    const nextZ = Math.min(...above.map((e) => e.zIndex));
    return nextZ + 1;
  } else {
    // send-backward
    const below = overlapping.filter((e) => e.zIndex < targetZ);
    if (below.length === 0) return null; // already at bottom
    const nextZ = Math.max(...below.map((e) => e.zIndex));
    return Math.max(0, nextZ - 1);
  }
}

/**
 * Whether a z-order action is available for the target.
 * "disabled" = the element is already at that limit.
 */
export function isZOrderActionEnabled(
  target: HTMLElement,
  action: "bring-forward" | "send-backward" | "bring-to-front" | "send-to-back",
): boolean {
  return resolveZOrderChange(target, action) !== null;
}
