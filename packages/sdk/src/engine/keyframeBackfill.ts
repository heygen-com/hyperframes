/**
 * Backfill defaults for add-keyframe ops.
 *
 * When an add-keyframe op introduces a property absent from the other keyframes,
 * the writer needs a rest value to seed those keyframes with so GSAP interpolates
 * instead of snapping. The SDK derives the numeric-default set here so the acorn
 * writer matches the recast writer the server uses.
 *
 * Only props with a real numeric default get a backfill value. Defaulting an
 * unknown or string-valued prop to 0 (e.g. `color: 0`, `filter: 0`) emits invalid
 * GSAP, so such props are SKIPPED — the writer then leaves them out of the other
 * keyframes (GSAP reads the rest value from the DOM), matching recast (which skips
 * any prop whose default is null).
 */

import { GSAP_PROPERTY_DEFAULTS } from "@hyperframes/parsers/gsap-parser";

/** Derive the backfillDefaults for an add-keyframe op (numeric-default props only). */
export function deriveKeyframeBackfillDefaults(
  value: Record<string, number | string>,
): Record<string, number | string> {
  const defaults: Record<string, number | string> = {};
  for (const key of Object.keys(value)) {
    const def = GSAP_PROPERTY_DEFAULTS[key];
    if (def !== undefined) defaults[key] = def;
  }
  return defaults;
}
