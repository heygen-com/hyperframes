// Static resolver for relative `data-start` references (`data-start="intro"`), mirroring the runtime's
// startResolver so lint, render and `timeline` agree on when a referenced clip starts.

import { parseNumeric, parseStartExpression } from "./compositionContract.js";

/** Minimal structural DOM shape the reference resolver needs. */
export interface RefResolverEl {
  getAttribute(name: string): string | null;
}
export interface RefResolverDoc {
  getElementById(id: string): RefResolverEl | null;
  querySelector(selector: string): RefResolverEl | null;
}

// By `id`, then `data-composition-id`. The reference grammar allows only `[A-Za-z0-9_.:-]`, so no CSS.escape.
function findReferenceTargetEl(doc: RefResolverDoc, refId: string): RefResolverEl | null {
  return doc.getElementById(refId) ?? doc.querySelector(`[data-composition-id="${refId}"]`);
}

// Natural media length is unknown here, so as in the runtime an unknown-length target
// resolves to its start and an unknown target to 0, never NaN.
export function resolveReferencedStart(
  doc: RefResolverDoc,
  el: RefResolverEl,
  startCache: Map<RefResolverEl, number>,
  visiting: Set<RefResolverEl>,
): number {
  const cached = startCache.get(el);
  if (cached !== undefined) return cached;
  if (visiting.has(el)) return 0; // cycle guard (A -> B -> A)
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
    const targetStart = resolveReferencedStart(doc, target, startCache, visiting);
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

/** From `data-duration` or `data-end - start`; null when only the media's own length would settle it. */
export function resolveReferencedDuration(
  doc: RefResolverDoc,
  el: RefResolverEl,
  startCache: Map<RefResolverEl, number>,
  visiting: Set<RefResolverEl>,
): number | null {
  const durationAttr = parseNumeric(el.getAttribute("data-duration"));
  if (durationAttr != null && durationAttr > 0) return durationAttr;
  const endAttr = parseNumeric(el.getAttribute("data-end"));
  if (endAttr != null) {
    const start = resolveReferencedStart(doc, el, startCache, visiting);
    const delta = endAttr - start;
    if (Number.isFinite(delta) && delta > 0) return delta;
  }
  return null;
}
