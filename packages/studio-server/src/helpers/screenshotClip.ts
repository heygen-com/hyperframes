export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Serialised by page.evaluate, so self-contained; fades everything but the element's own branch.
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
  // Opacity, not visibility; the tag keeps the prior inline opacity for clearElementScreenshotIsolation.
  const hidden = "data-hf-thumbnail-hidden";
  for (let node: Element = el; node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      const style = (sibling as HTMLElement).style;
      if (sibling === node || !style || sibling.hasAttribute(hidden)) continue;
      const priority = style.getPropertyPriority("opacity");
      sibling.setAttribute(hidden, `${style.getPropertyValue("opacity")}|${priority}`);
      style.setProperty("opacity", "0", "important");
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

export function clearElementScreenshotIsolation(): void {
  const hidden = "data-hf-thumbnail-hidden";
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${hidden}]`))) {
    const [value = "", priority = ""] = node.getAttribute(hidden)!.split("|");
    if (value) node.style.setProperty("opacity", value, priority);
    else node.style.removeProperty("opacity");
    node.removeAttribute(hidden);
  }
}
