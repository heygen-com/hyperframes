import { parseNumeric, parseStartExpression } from "@hyperframes/core";

function findReferenceTargetEl(doc: Document, refId: string): Element | null {
  return doc.getElementById(refId) ?? doc.querySelector(`[data-composition-id="${refId}"]`);
}

export function resolveStart(
  doc: Document,
  el: Element,
  startCache: Map<Element, number>,
  visiting: Set<Element>,
): number {
  const cached = startCache.get(el);
  if (cached !== undefined) return cached;
  if (visiting.has(el)) return 0;
  visiting.add(el);

  try {
    const expression = parseStartExpression(el.getAttribute("data-start"));
    if (!expression) {
      startCache.set(el, 0);
      return 0;
    }

    if (expression.kind === "absolute") {
      const value = Math.max(0, expression.value);
      startCache.set(el, value);
      return value;
    }

    const target = findReferenceTargetEl(doc, expression.refId);
    if (!target) {
      startCache.set(el, 0);
      return 0;
    }

    const targetStart = resolveStart(doc, target, startCache, visiting);
    const targetDuration = resolveReferencedDuration(doc, target, startCache, visiting);
    const resolved =
      targetDuration != null && targetDuration > 0
        ? Math.max(0, targetStart + targetDuration + expression.offset)
        : Math.max(0, targetStart + expression.offset);
    startCache.set(el, resolved);
    return resolved;
  } finally {
    visiting.delete(el);
  }
}

export function resolveReferencedDuration(
  doc: Document,
  el: Element,
  startCache: Map<Element, number>,
  visiting: Set<Element>,
): number | null {
  const durationAttr = parseNumeric(el.getAttribute("data-duration"));
  if (durationAttr != null && durationAttr > 0) return durationAttr;
  const endAttr = parseNumeric(el.getAttribute("data-end"));
  if (endAttr != null) {
    const start = resolveStart(doc, el, startCache, visiting);
    const delta = endAttr - start;
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  return null;
}
