import type {
  GsapAnimation,
  GsapKeyframesData,
  GsapPercentageKeyframe,
} from "@hyperframes/core/gsap-parser";
import { PROPERTY_DEFAULTS } from "./gsapShared";

export function accumulateCollidingAnimationIds(
  keyframe: { animationId?: string; collidingAnimationIds?: string[] },
  incomingAnimationId: string | undefined,
): void {
  const primaryId = keyframe.animationId;
  if (
    primaryId === undefined ||
    incomingAnimationId === undefined ||
    primaryId === incomingAnimationId
  ) {
    return;
  }
  const collisionIds = keyframe.collidingAnimationIds;
  if (collisionIds?.includes(incomingAnimationId)) return;
  keyframe.collidingAnimationIds = [
    ...(collisionIds === undefined || collisionIds.length === 0 ? [primaryId] : collisionIds),
    incomingAnimationId,
  ];
}

export function deduplicateKeyframes<
  T extends GsapPercentageKeyframe & {
    animationId?: string;
    collidingAnimationIds?: string[];
  },
>(keyframes: T[]): T[] {
  const byPct = new Map<number, T>();
  for (const kf of keyframes) {
    const existing = byPct.get(kf.percentage);
    if (existing) {
      existing.properties = { ...existing.properties, ...kf.properties };
      accumulateCollidingAnimationIds(existing, kf.animationId);
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

  const rawStart: Record<string, number | string> = {};
  const rawEnd: Record<string, number | string> = {};

  if (anim.method === "from") {
    for (const [k, v] of Object.entries(toProps)) {
      rawStart[k] = v;
      rawEnd[k] = PROPERTY_DEFAULTS[k] ?? 0;
    }
  } else if (anim.method === "fromTo" && fromProps) {
    Object.assign(rawStart, fromProps);
    Object.assign(rawEnd, toProps);
  } else {
    for (const [k, v] of Object.entries(toProps)) {
      rawStart[k] = PROPERTY_DEFAULTS[k] ?? 0;
      rawEnd[k] = v;
    }
  }

  // Only numeric props are keyframe-interpolatable — a flat tween of a
  // non-numeric prop (e.g. backgroundColor: "#fff") can't be a 2-keyframe lane.
  const numericKeys = Object.keys(rawEnd).filter(
    (k) => typeof rawStart[k] === "number" && typeof rawEnd[k] === "number",
  );
  if (numericKeys.length === 0) return null;
  const startProps = Object.fromEntries(numericKeys.map((k) => [k, rawStart[k]]));
  const endProps = Object.fromEntries(numericKeys.map((k) => [k, rawEnd[k]]));

  return {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: startProps },
      // Segment ease lives on the destination keyframe (Figma/AE model) so the
      // lane + cache surface it; also kept data-level for useGsapTweenCache.
      { percentage: 100, properties: endProps, ...(anim.ease ? { ease: anim.ease } : {}) },
    ],
    ...(anim.ease ? { ease: anim.ease } : {}),
  };
}
