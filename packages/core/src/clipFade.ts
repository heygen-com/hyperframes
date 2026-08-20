/**
 * Clip fades: `data-fade-in` / `data-fade-out` on any timed element.
 *
 * A fade is declared, not animated. The author writes how long it lasts and the
 * runtime attenuates the clip over that stretch of its own window — so a fade
 * survives a trim, a move, and a re-render, and there is no tween to keep in
 * sync with the clip's timing.
 *
 * Visual clips fade on opacity. Audio is deliberately NOT covered here: a fade
 * on a sound is volume automation, it already has `data-automation` to live in,
 * and putting it there keeps it editable as breakpoints rather than as one
 * number.
 */

export const HF_FADE_IN_ATTR = "data-fade-in";
export const HF_FADE_OUT_ATTR = "data-fade-out";
export const HF_FADE_CURVE_ATTR = "data-fade-curve";

/**
 * How far a fade may bend away from a straight ramp, either way.
 *
 * The limit is what keeps the shape a fade rather than a hold: at 1 the curve
 * already spends most of its length near one extreme, and going further buys
 * nothing an editor can see.
 */
export const FADE_CURVE_LIMIT = 1;

/** A bend outside the range, or not a number at all, resolves to straight. */
export function clampFadeCurve(curve: number): number {
  if (!Number.isFinite(curve)) return 0;
  return Math.max(-FADE_CURVE_LIMIT, Math.min(FADE_CURVE_LIMIT, curve));
}

export interface HfClipFade {
  /** Seconds of fade at the clip's head. */
  fadeIn: number;
  /** Seconds of fade at the clip's tail. */
  fadeOut: number;
  /** How the head ramp bends. See {@link fadeEase}. */
  curveIn: number;
  /** How the tail ramp bends, which is nobody's business but the tail's. */
  curveOut: number;
}

/**
 * Ease a 0..1 progress through a bend.
 *
 * `curve` is one number rather than a set of named shapes, because the shape is
 * something you drag: Studio lets you pull the fade line itself and the curve
 * has to follow the pointer to anywhere in between, not snap to the nearest of
 * three presets.
 *
 * 0 is a straight ramp. A negative bend sags the line, so the fade starts
 * slowly and finishes fast. A positive bend bulges it, so the fade starts fast
 * and finishes slowly. Under it all is an exponent, `k = 2^(-2 · curve)`, which
 * makes -0.5 exactly `p²` and +0.5 exactly `√p` and the two directions mirror
 * images of each other.
 */
export function fadeEase(progress: number, curve: number): number {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  const bend = clampFadeCurve(curve);
  if (bend === 0) return p;
  return Math.pow(p, Math.pow(2, -2 * bend));
}

/**
 * The bend whose curve passes through `level` at the halfway point, which is
 * how a drag on the fade line resolves to a number: the curve follows the
 * pointer instead of the pointer nudging an abstract parameter.
 */
export function fadeCurveThroughMidpoint(level: number): number {
  const clamped = Math.max(1e-4, Math.min(1 - 1e-4, level));
  // level = 0.5^k  ⇒  k = ln(level) / ln(0.5),  and  k = 2^(-2·bend).
  const k = Math.log(clamped) / Math.log(0.5);
  return clampFadeCurve(-Math.log2(k) / 2);
}

function parseSeconds(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The bends, from one attribute that takes one value or two.
 *
 * `data-fade-curve="-0.5"` bends both ramps the same way; `"-0.5 0.3"` bends
 * the head then the tail. The one-or-many shorthand is the same bargain CSS
 * strikes with `border-radius`, and it is worth striking here because the two
 * ramps are usually alike and occasionally must not be: a fade in that creeps
 * out of black and a fade out that drops away is a normal thing to ask for, and
 * a single shared number cannot say it.
 */
function parseCurves(raw: string | null | undefined): { in: number; out: number } {
  if (raw == null) return { in: 0, out: 0 };
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => clampFadeCurve(Number.parseFloat(part)));
  const head = parts[0] ?? 0;
  return { in: head, out: parts.length > 1 ? (parts[1] ?? head) : head };
}

/** Two decimals is finer than a pointer can place a curve, and it keeps the
 *  attribute short enough to read. */
const roundCurve = (value: number): number => Math.round(value * 100) / 100;

/**
 * The attribute two bends should be written as, or null when both are straight
 * and the attribute is better left off entirely. Collapses to one value when
 * the ramps agree, which is the common case and the shorter markup.
 */
export function formatFadeCurve(curveIn: number, curveOut: number): string | null {
  const head = roundCurve(clampFadeCurve(curveIn));
  const tail = roundCurve(clampFadeCurve(curveOut));
  if (head === 0 && tail === 0) return null;
  return head === tail ? String(head) : `${head} ${tail}`;
}

/**
 * Whether the element declares a fade at all, without parsing one.
 *
 * The runtime asks this of every timed element on every frame and almost none
 * of them answer yes, so the common path stays two attribute lookups.
 */
export function hasClipFadeAttributes(hasAttribute: (name: string) => boolean): boolean {
  return hasAttribute(HF_FADE_IN_ATTR) || hasAttribute(HF_FADE_OUT_ATTR);
}

/**
 * Read a clip's fade from its attributes, or null when it declares none.
 *
 * Takes an attribute reader rather than an element so the same parse runs
 * against a DOM node in the runtime, a parsed node in the linter, and a plain
 * record in a test.
 */
export function parseClipFade(getAttribute: (name: string) => string | null): HfClipFade | null {
  const fadeIn = parseSeconds(getAttribute(HF_FADE_IN_ATTR));
  const fadeOut = parseSeconds(getAttribute(HF_FADE_OUT_ATTR));
  if (fadeIn <= 0 && fadeOut <= 0) return null;
  const curves = parseCurves(getAttribute(HF_FADE_CURVE_ATTR));
  return { fadeIn, fadeOut, curveIn: curves.in, curveOut: curves.out };
}

/**
 * The clip's level at `elapsed` seconds into a window `duration` long: 1 at
 * full, 0 at silence/transparent.
 *
 * Fades that would overlap share the window in proportion rather than fighting
 * over it, so a clip trimmed shorter than its own fades still resolves to a
 * clean in-and-out instead of jumping. An unbounded window (a clip with no
 * duration) can only fade in — there is no end to fade out of.
 */
export function clipFadeLevelAt(fade: HfClipFade, elapsed: number, duration: number): number {
  if (elapsed <= 0 && fade.fadeIn > 0) return 0;
  const finite = Number.isFinite(duration) && duration > 0;
  let { fadeIn, fadeOut } = fade;
  if (finite && fadeIn + fadeOut > duration) {
    const total = fadeIn + fadeOut;
    fadeIn = (fadeIn / total) * duration;
    fadeOut = (fadeOut / total) * duration;
  }
  if (!finite) fadeOut = 0;

  let level = 1;
  if (fadeIn > 0 && elapsed < fadeIn) {
    level = Math.min(level, fadeEase(elapsed / fadeIn, fade.curveIn));
  }
  if (fadeOut > 0) {
    const remaining = duration - elapsed;
    if (remaining < fadeOut) {
      level = Math.min(level, fadeEase(Math.max(0, remaining) / fadeOut, fade.curveOut));
    }
  }
  return level <= 0 ? 0 : level >= 1 ? 1 : level;
}

/**
 * The CSS `filter` a faded clip should carry, composed onto whatever filter the
 * author wrote. `filter`, not `opacity`: opacity is the property animation
 * engines drive, and a runtime that writes it every frame fights them for it —
 * `filter: opacity()` multiplies with whatever they set instead.
 *
 * Returns the authored filter unchanged at full level, so a clip outside its
 * fades carries exactly what its author gave it and nothing else.
 */
export function clipFadeFilter(authoredFilter: string, level: number): string {
  const authored = authoredFilter.trim();
  if (level >= 1) return authored;
  const opacity = `opacity(${Math.max(0, level).toFixed(4)})`;
  return authored ? `${authored} ${opacity}` : opacity;
}
