function extractIdFromSelector(selector: string): string | null {
  const match = selector.match(/^#([\w-]+)/);
  return match ? match[1] : null;
}

/**
 * Resolve a tween's target selector to the ids of the element(s) it animates.
 * A bare `#id` resolves directly; anything else (a class like `.dot`, a group
 * `.a, .b`, or a descendant selector) is matched against the live preview DOM so
 * class/selector tweens (e.g. `gsap.from(".dot", {stagger})`) attribute to every
 * element they animate. Falls back to a leading `#id` when there's no DOM.
 */
// fallow-ignore-next-line complexity
export function resolveSelectorElementIds(
  selector: string,
  doc: Document | null | undefined,
): string[] {
  const bareId = selector.match(/^#([\w-]+)$/);
  if (bareId) return [bareId[1]];
  if (!doc) {
    const lead = extractIdFromSelector(selector);
    return lead ? [lead] : [];
  }
  const ids = new Set<string>();
  for (const part of selector.split(",")) {
    const sel = part.trim();
    if (!sel) continue;
    try {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        if (el.id) ids.add(el.id);
      }
    } catch {
      const lead = extractIdFromSelector(sel);
      if (lead) ids.add(lead);
    }
  }
  return Array.from(ids);
}

/** The selected element's identity for matching tweens to it. */
export interface GsapElementTarget {
  id?: string | null;
  selector?: string | null;
}

export function resolveTargetElement(
  target: GsapElementTarget,
  iframeRef?: { current: HTMLIFrameElement | null },
): Element | null {
  const doc = iframeRef?.current?.contentDocument;
  if (!doc) return null;
  try {
    return (
      (target.id ? doc.getElementById(target.id) : null) ??
      (target.selector ? doc.querySelector(target.selector) : null)
    );
  } catch {
    return null;
  }
}

/**
 * A tween belongs to the selected element when its target selector addresses
 * that element by id, exact selected selector, group member, or live CSS match.
 */
export function getAnimationsForElement<T extends { targetSelector: string }>(
  animations: T[],
  target: GsapElementTarget,
  element?: Element | null,
): T[] {
  const matchers = new Set<string>();
  if (target.id) matchers.add(`#${target.id}`);
  if (target.selector) matchers.add(target.selector);
  if (matchers.size === 0 && !element) return [];
  return animations.filter((a) =>
    a.targetSelector.split(",").some((part) => {
      const trimmed = part.trim();
      if (!trimmed) return false;
      if (matchers.has(trimmed)) return true;
      const lastSimple = trimmed.split(/\s+/).pop();
      if (lastSimple && matchers.has(lastSimple)) return true;
      if (element) {
        try {
          if (element.matches(trimmed)) return true;
        } catch {
          /* tween selector isn't a valid CSS selector for matches() - skip */
        }
      }
      return false;
    }),
  );
}
