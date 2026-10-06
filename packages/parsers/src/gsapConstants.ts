/**
 * GSAP property and ease constants.
 *
 * Extracted into a standalone module so browser code can import them
 * without pulling in gsapParser (which depends on recast / @babel/parser).
 */

import type { GsapAnimation } from "./gsapSerialize.js";

export const GSAP_DEFAULT_DURATION = 0.5;

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

/** Keys stored on dedicated GsapAnimation fields (not in properties/extras). */
export const BUILTIN_VAR_KEYS: ReadonlySet<string> = new Set(["duration", "ease", "delay"]);
export const DROPPED_VAR_KEYS: ReadonlySet<string> = new Set([
  "onComplete",
  "onStart",
  "onUpdate",
  "onRepeat",
]);
/** Keys that go in `extras`: non-editable GSAP config that must survive round-trips. */
export const EXTRAS_KEYS: ReadonlySet<string> = new Set([
  "stagger",
  "yoyo",
  "repeat",
  "repeatDelay",
  "snap",
  "overwrite",
  "immediateRender",
]);

export function isTweenConfigKey(key: string): boolean {
  return BUILTIN_VAR_KEYS.has(key) || DROPPED_VAR_KEYS.has(key) || EXTRAS_KEYS.has(key);
}

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

export interface HoldScope {
  touched: (animation: GsapAnimation) => boolean;
  held: (selector: string) => ReadonlyMap<string, unknown>;
}

const tweenSignature = (a: GsapAnimation) =>
  JSON.stringify([a.targetSelector, a.method, a.position, a.duration, a.properties, a.keyframes]);

/** The tweens an edit touched (not in `previous`; all without it), and what the script's holds already pin. */
export function holdScope(
  before: readonly GsapAnimation[],
  previous: readonly GsapAnimation[] | null,
): HoldScope {
  const kept = new Set(previous?.map(tweenSignature));
  const held = new Map<string, Map<string, unknown>>();
  for (const a of before.filter((b) => b.method === "set" && b.properties?.data === "hf-hold")) {
    const props = held.get(a.targetSelector) ?? new Map<string, unknown>();
    for (const [property, value] of Object.entries(a.properties)) props.set(property, value);
    held.set(a.targetSelector, props);
  }
  return {
    touched: (a) => previous === null || !kept.has(tweenSignature(a)),
    held: (selector) => held.get(selector) ?? new Map(),
  };
}

/**
 * What a Studio hold pins from t=0, only for a tween this edit touched or a hold already pins: the 0% position props
 * before a later start, and the position and size of a lone key (GSAP renders none), minus earlier tweens.
 */
export function keyframeHoldForAnimation(
  animation: GsapAnimation,
  animations: readonly GsapAnimation[],
  scope: HoldScope,
): Record<string, number> | null {
  if (!animation.keyframes) return null;
  const start = knownStart(animation);
  const lone = animation.keyframes.keyframes.length === 1;
  if (start === undefined || (!(start > 0.001) && !lone)) return null;
  const atStart = animation.keyframes.keyframes.find((keyframe) => keyframe.percentage === 0);
  if (!atStart) return null;
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
  const touched = scope.touched(animation);
  const pinned = scope.held(animation.targetSelector);
  // An untouched tween keeps only the hold it made: one with its own first value.
  const kept = (property: string, value: unknown) =>
    touched ? pinned.has(property) : pinned.get(property) === value;
  const startsLate = start > 0.001;
  const pins = (group: PropertyGroupName, property: string, value: unknown) =>
    (group === "position" || group === "size") &&
    (((lone || (group === "position" && startsLate)) && touched) || kept(property, value));
  const hold: Record<string, number> = {};
  for (const [property, value] of Object.entries(atStart.properties)) {
    if (!pins(classifyPropertyGroup(property), property, value) || typeof value !== "number")
      continue;
    if (earlier.some((other) => writesProperty(other, property))) continue;
    hold[property] = value;
  }
  return Object.keys(hold).length > 0 ? hold : null;
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
