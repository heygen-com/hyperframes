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

// Numeric rest values for editable transform/style props. Props absent here have
// no safe static default and are intentionally omitted from the backfill set.
//
// KEEP IN SYNC WITH packages/studio/src/hooks/gsapShared.ts:PROPERTY_DEFAULTS —
// the studio (recast) and SDK (acorn) paths must derive the same defaults or
// SDK-written keyframes drift from server-written ones (the exact bug this fixes).
// TODO: lift the canonical table into @hyperframes/core and import from both.
const KEYFRAME_PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

/** Derive the backfillDefaults for an add-keyframe op (numeric-default props only). */
export function deriveKeyframeBackfillDefaults(
  value: Record<string, number | string>,
): Record<string, number | string> {
  const defaults: Record<string, number | string> = {};
  for (const key of Object.keys(value)) {
    const def = KEYFRAME_PROPERTY_DEFAULTS[key];
    if (def !== undefined) defaults[key] = def;
  }
  return defaults;
}
