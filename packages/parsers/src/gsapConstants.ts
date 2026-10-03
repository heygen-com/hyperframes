/**
 * GSAP property and ease constants.
 *
 * Extracted into a standalone module so browser code can import them
 * without pulling in gsapParser (which depends on recast / @babel/parser).
 */

import type { GsapAnimation } from "./gsapSerialize.js";

export const SUPPORTED_PROPS = [
  // 2D Transforms
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "skewX",
  "skewY",
  // 3D Transforms
  "z",
  "rotationX",
  "rotationY",
  "rotationZ",
  "perspective",
  "transformPerspective",
  "transformOrigin",
  // Visibility
  "opacity",
  "visibility",
  "autoAlpha",
  // Dimensions
  "width",
  "height",
  // Colors
  "color",
  "backgroundColor",
  "borderColor",
  // Box model
  "borderRadius",
  // Typography
  "fontSize",
  "letterSpacing",
  // Filter & Clipping
  "filter",
  "clipPath",
  // DOM content (number counters, text roll-ups)
  "innerText",
];

// ── Property Groups ─────────────────────────────────────────────────────────
// Each group maps to an independent GSAP tween so editing one property
// (e.g. drag → x/y) never contaminates another (e.g. scale, rotation).

export type PropertyGroupName = "position" | "scale" | "size" | "rotation" | "visual" | "other";

export const PROPERTY_GROUPS: Record<PropertyGroupName, ReadonlySet<string>> = {
  position: new Set(["x", "y", "xPercent", "yPercent"]),
  scale: new Set(["scale", "scaleX", "scaleY"]),
  size: new Set(["width", "height"]),
  rotation: new Set(["rotation", "skewX", "skewY"]),
  visual: new Set(["opacity", "autoAlpha"]),
  other: new Set<string>(),
};

const PROP_TO_GROUP = new Map<string, PropertyGroupName>();
for (const [group, props] of Object.entries(PROPERTY_GROUPS) as [
  PropertyGroupName,
  ReadonlySet<string>,
][]) {
  for (const p of props) PROP_TO_GROUP.set(p, group);
}

type PositionWrite = Pick<
  GsapAnimation,
  "propertyGroup" | "properties" | "fromProperties" | "keyframes"
>;

function writesProperty(animation: PositionWrite, property: string): boolean {
  return (
    property in animation.properties ||
    (!!animation.fromProperties && property in animation.fromProperties) ||
    !!animation.keyframes?.keyframes.some((k) => property in k.properties)
  );
}

/** A position write that sets x or y. An xPercent/yPercent centring set never duplicates one. */
export function isXYPositionWrite(a: PositionWrite): boolean {
  return a.propertyGroup === "position" && (writesProperty(a, "x") || writesProperty(a, "y"));
}

export function classifyPropertyGroup(prop: string): PropertyGroupName {
  return PROP_TO_GROUP.get(prop) ?? "other";
}

export function classifyTweenPropertyGroup(
  properties: Record<string, unknown>,
): PropertyGroupName | undefined {
  const groups = new Set<PropertyGroupName>();
  for (const key of Object.keys(properties)) {
    // transformOrigin is a modifier; `_auto` is Studio's internal endpoint marker;
    // `data` is GSAP-reserved (carries the Studio hold-set tag). None is an animated
    // property, so none should affect the group.
    if (key === "transformOrigin" || key === "_auto" || key === "data") continue;
    const g = classifyPropertyGroup(key);
    groups.add(g);
  }
  if (groups.size === 1) return groups.values().next().value;
  return undefined;
}

function knownStart(animation: GsapAnimation): number | undefined {
  if (animation.resolvedStart !== undefined) return animation.resolvedStart;
  return typeof animation.position === "number" ? animation.position : undefined;
}

/**
 * What a Studio hold pins from t=0 before a later keyframed tween: its first keyframe's position props,
 * minus those an earlier timeline tween on the target writes (a global `gsap.set` is a base value).
 */
export function positionHoldForAnimation(
  animation: GsapAnimation,
  animations: readonly GsapAnimation[],
): Record<string, number> | null {
  if (!animation.keyframes) return null;
  const start = knownStart(animation) ?? 0;
  if (!(start > 0.001)) return null;
  const first = [...animation.keyframes.keyframes].sort(
    (left, right) => left.percentage - right.percentage,
  )[0];
  if (!first) return null;
  // A tween whose start the parser could not resolve (a label, say) is not known to come first.
  const earlier = animations.filter((other) => {
    const otherStart = knownStart(other);
    return (
      other !== animation &&
      !other.global &&
      other.targetSelector === animation.targetSelector &&
      otherStart !== undefined &&
      otherStart < start - 0.001
    );
  });
  const position: Record<string, number> = {};
  for (const [property, value] of Object.entries(first.properties)) {
    if (classifyPropertyGroup(property) !== "position" || typeof value !== "number") continue;
    if (earlier.some((other) => writesProperty(other, property))) continue;
    position[property] = value;
  }
  return Object.keys(position).length > 0 ? position : null;
}

export const SUPPORTED_EASES = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "power4.in",
  "power4.out",
  "power4.inOut",
  "back.in",
  "back.out",
  "back.inOut",
  "elastic.in",
  "elastic.out",
  "elastic.inOut",
  "bounce.in",
  "bounce.out",
  "bounce.inOut",
  "circ.inOut",
  "expo.in",
  "expo.out",
  "expo.inOut",
  "elastic.out(1,0.3)",
  "elastic.inOut(1,0.3)",
  "spring-gentle",
  "spring-bouncy",
  "spring-stiff",
  "spring-wobbly",
  "spring-heavy",
  "hold",
  "steps(1)",
];
