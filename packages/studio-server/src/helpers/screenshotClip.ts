export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Runs inside the page (serialised by page.evaluate), so it stays self-contained. Everything but
 * the element, its subtree and its ancestors is faded out first, so the clip shows that layer alone.
 */
export function getElementScreenshotClip(
  selector: string,
  selectorIndex?: number,
): ScreenshotClip | undefined {
  // Guard against invalid CSS selectors (e.g. `#0` — a digit-leading id from
  // user HTML that upstream producers forgot to CSS.escape). querySelectorAll
  // throws SyntaxError on those, which bubbles out of page.evaluate and fails
  // the whole thumbnail. Returning undefined here falls back to a full-page
  // screenshot, so the user still sees a thumbnail instead of a broken image.
  let matches: HTMLElement[];
  try {
    matches = Array.from(document.querySelectorAll(selector)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
  } catch {
    return undefined;
  }
  const safeIndex = Math.max(0, Math.min(matches.length - 1, Math.floor(selectorIndex ?? 0)));
  const el = matches[safeIndex] ?? null;
  if (!(el instanceof HTMLElement)) return undefined;
  // Opacity, not visibility: a descendant cannot paint through a faded ancestor.
  for (let node: HTMLElement = el; node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling !== node && (sibling instanceof HTMLElement || sibling instanceof SVGElement))
        sibling.style.setProperty("opacity", "0", "important");
    }
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return undefined;
  const pad = 8;
  const x = Math.max(0, rect.left - pad);
  const y = Math.max(0, rect.top - pad);
  const maxWidth = window.innerWidth - x;
  const maxHeight = window.innerHeight - y;
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width + pad * 2, maxWidth)),
    height: Math.max(1, Math.min(rect.height + pad * 2, maxHeight)),
  };
}
