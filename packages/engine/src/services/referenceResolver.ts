/**
 * Node-side resolver for relative `data-start` timing references, shared by
 * every parser that reads media timing out of compiled HTML — video frames
 * (`parseVideoElements`), images (`parseImageElements`), and audio
 * (`parseAudioElements`). Keeping the resolution in ONE place is load-bearing:
 * if audio and video disagree on what `data-start="intro"` means, a relative
 * reference that renders a video at the right time silently drops the audio
 * track (they used to — audio parsed `parseFloat("intro") = NaN`).
 *
 * Mirrors the browser runtime's startResolver so `snapshot`/`render` agree.
 * DOM access is via a minimal structural shape so it works against linkedom
 * (Node) without pulling in lib.dom types.
 */

import { parseNumeric, parseStartExpression } from "@hyperframes/core";

/** Minimal structural DOM shape the reference resolver needs. */
export interface RefResolverEl {
  getAttribute(name: string): string | null;
}
interface RefResolverDoc {
  getElementById(id: string): RefResolverEl | null;
  querySelector(selector: string): RefResolverEl | null;
}

/**
 * Find the element a relative `data-start` reference points at — by `id`
 * first, then by `data-composition-id` (a sub-composition can be referenced).
 * The reference-id grammar (see parseStartExpression) is restricted to
 * `[A-Za-z0-9_.:-]`, none of which need escaping inside a quoted attribute
 * selector, so no CSS.escape (absent in linkedom) is required.
 */
function findReferenceTargetEl(doc: RefResolverDoc, refId: string): RefResolverEl | null {
  return doc.getElementById(refId) ?? doc.querySelector(`[data-composition-id="${refId}"]`);
}

/**
 * Resolve an element's absolute start time (seconds) the same way the browser
 * runtime's startResolver does, so `<video data-start="intro">` (a relative
 * reference to another clip's end) renders at the right time instead of
 * producing NaN and compositing blank / dropping audio. Durations come from
 * `data-duration` or `data-end` here; the natural-media-duration fallback isn't
 * known at parse time, so — exactly like the runtime — an unknown-duration
 * reference falls back to the target's start and an unknown target falls back
 * to 0 (never NaN).
 */
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

/**
 * Duration of a referenced clip, from `data-duration` or `data-end - start`.
 * Returns null when only the natural media duration would settle it (unknown
 * at parse time) — the caller then treats the reference as duration-0.
 */
function resolveReferencedDuration(
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
