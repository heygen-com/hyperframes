/**
 * GSAP keyframe overrides — applies per-tween value overrides from a sidecar
 * JSON file (`gsap-overrides.json`) after the timeline is built.
 *
 * This is how the Studio persists edits to *dynamic* tweens (values from
 * variables / data that can't be unrolled to literals): rather than rewriting
 * source, the edit is recorded as an override keyed by a stable identity
 * (element selector + tween ordinal) and re-applied here at load — in both the
 * Studio preview and headless render, so exports reflect the edit. The override
 * stores explicit values, so application needs no live data and stays
 * deterministic. Mirrors the caption-overrides mechanism.
 */

export interface KeyframeOverride {
  /** Element selector the tween targets, e.g. "#product". */
  selector: string;
  /** Ordinal among the element's tweens, sorted by start time (stable identity). */
  tweenIndex?: number;
  /** Tween vars to override (positions/transform/style values). */
  vars?: Record<string, number | string>;
}

interface GsapTween {
  vars: Record<string, unknown>;
  startTime(): number;
  invalidate?: () => GsapTween;
}

interface GsapStatic {
  getTweensOf: (target: string) => GsapTween[];
}

/**
 * The tween(s) an override applies to: a specific ordinal (by start time) when
 * `tweenIndex` is set, otherwise every tween of the selector.
 */
export function selectOverrideTweens(tweens: GsapTween[], override: KeyframeOverride): GsapTween[] {
  const sorted = [...tweens].sort((a, b) => a.startTime() - b.startTime());
  if (override.tweenIndex === undefined) return sorted;
  const tween = sorted[override.tweenIndex];
  return tween ? [tween] : [];
}

/** Apply one override's vars to its target tweens, invalidating so GSAP re-reads them. */
export function applyOverrideToTweens(tweens: GsapTween[], override: KeyframeOverride): number {
  if (!override.vars) return 0;
  let applied = 0;
  for (const tween of selectOverrideTweens(tweens, override)) {
    Object.assign(tween.vars, override.vars);
    tween.invalidate?.();
    applied++;
  }
  return applied;
}

/** Fetch `gsap-overrides.json` and apply each override to the live timeline. */
export function applyKeyframeOverrides(): void {
  const gsap = (window as unknown as { gsap?: GsapStatic }).gsap;
  if (!gsap?.getTweensOf) return;

  void fetch("gsap-overrides.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data: KeyframeOverride[] | null) => {
      if (!Array.isArray(data)) return;
      for (const override of data) {
        if (!override?.selector || !override.vars) continue;
        applyOverrideToTweens(gsap.getTweensOf(override.selector), override);
      }
    })
    .catch(() => {});
}
