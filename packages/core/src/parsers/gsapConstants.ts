/**
 * GSAP property and ease constants.
 *
 * Extracted into a standalone module so browser code can import them
 * without pulling in gsapParser (which depends on recast / @babel/parser).
 */

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

export function classifyPropertyGroup(prop: string): PropertyGroupName {
  return PROP_TO_GROUP.get(prop) ?? "other";
}

export function classifyTweenPropertyGroup(
  properties: Record<string, unknown>,
): PropertyGroupName | undefined {
  const groups = new Set<PropertyGroupName>();
  for (const key of Object.keys(properties)) {
    if (key === "transformOrigin") continue;
    const g = classifyPropertyGroup(key);
    groups.add(g);
  }
  if (groups.size === 1) return groups.values().next().value;
  return undefined;
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
  "expo.in",
  "expo.out",
  "expo.inOut",
  "spring-gentle",
  "spring-bouncy",
  "spring-stiff",
  "spring-wobbly",
  "spring-heavy",
  "steps(1)",
];
