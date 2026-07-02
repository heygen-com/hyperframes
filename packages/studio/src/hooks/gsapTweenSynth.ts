import type {
  GsapAnimation,
  GsapKeyframesData,
  GsapPercentageKeyframe,
} from "@hyperframes/core/gsap-parser";
import { PROPERTY_DEFAULTS } from "./gsapShared";

export function deduplicateKeyframes(
  keyframes: GsapPercentageKeyframe[],
): GsapPercentageKeyframe[] {
  const byPct = new Map<number, GsapPercentageKeyframe>();
  for (const kf of keyframes) {
    const existing = byPct.get(kf.percentage);
    if (existing) {
      existing.properties = { ...existing.properties, ...kf.properties };
      if (kf.ease) existing.ease = kf.ease;
    } else {
      byPct.set(kf.percentage, { ...kf, properties: { ...kf.properties } });
    }
  }
  return Array.from(byPct.values()).sort((a, b) => a.percentage - b.percentage);
}

// fallow-ignore-next-line complexity
export function synthesizeFlatTweenKeyframes(anim: GsapAnimation): GsapKeyframesData | null {
  // Both parsers store extras as raw source text (`__raw:${code}`) so
  // non-editable config like `stagger: {...}` survives verbatim — a literal
  // `immediateRender: true` prints as exactly this string, not a boolean.
  const hasImmediateRenderHold = anim.extras?.immediateRender === "__raw:true";
  if (anim.method === "set" || (anim.duration === 0 && hasImmediateRenderHold)) {
    // A `set` — or a `to()`/`from()` collapsed to a zero-duration
    // immediateRender hold (what removeAllKeyframesFromScript collapses a
    // keyframed tween to) — is a STATIC HOLD: a value applied at one point,
    // not an animated keyframe. It must NOT synthesize a keyframe, or the
    // timeline + panel show a phantom diamond for a value that doesn't
    // animate. This aligns the AST path with the runtime scan, which already
    // skips every zero-duration set.
    return null;
  }
  const toProps = anim.properties;
  const fromProps = anim.fromProperties;
  if (!toProps || Object.keys(toProps).length === 0) return null;

  const startProps: Record<string, number | string> = {};
  const endProps: Record<string, number | string> = {};

  if (anim.method === "from") {
    for (const [k, v] of Object.entries(toProps)) {
      startProps[k] = v;
      endProps[k] = PROPERTY_DEFAULTS[k] ?? 0;
    }
  } else if (anim.method === "fromTo" && fromProps) {
    Object.assign(startProps, fromProps);
    Object.assign(endProps, toProps);
  } else {
    for (const [k, v] of Object.entries(toProps)) {
      startProps[k] = PROPERTY_DEFAULTS[k] ?? 0;
      endProps[k] = v;
    }
  }

  return {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: startProps },
      { percentage: 100, properties: endProps },
    ],
    ...(anim.ease ? { ease: anim.ease } : {}),
  };
}
