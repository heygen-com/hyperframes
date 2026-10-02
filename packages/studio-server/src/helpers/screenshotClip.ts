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
  // Opacity, not visibility: a descendant cannot paint through a faded ancestor. A tagged rule, not
  // inline style, so clearElementScreenshotIsolation can undo it on a page that is reused.
  const hidden = "data-hf-thumbnail-hidden";
  if (!document.getElementById(hidden)) {
    const style = document.createElement("style");
    style.id = hidden;
    style.textContent = `[${hidden}] { opacity: 0 !important; }`;
    document.head.append(style);
  }
  for (let node: Element = el; node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling !== node) sibling.setAttribute(hidden, "");
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

/** Undoes getElementScreenshotClip's fading. Self-contained for page.evaluate as well. */
export function clearElementScreenshotIsolation(): void {
  for (const node of Array.from(document.querySelectorAll("[data-hf-thumbnail-hidden]"))) {
    node.removeAttribute("data-hf-thumbnail-hidden");
  }
}
