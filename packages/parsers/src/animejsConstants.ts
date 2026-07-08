/**
 * anime.js property and ease constants.
 *
 * `@hyperframes/core/src/animation/easeMap.ts` is the authoritative GSAP→anime
 * mapping, but core already imports `@hyperframes/parsers`; importing core here
 * would create a runtime cycle. Keep this minimal native anime ease family list
 * in sync with that map instead of adding a reverse package dependency.
 */

export const SUPPORTED_ANIMEJS_PROPS = [
  "translateX",
  "translateY",
  "translateZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "scale",
  "scaleX",
  "scaleY",
  "skew",
  "skewX",
  "skewY",
  "opacity",
  "visibility",
  "width",
  "height",
  "color",
  "backgroundColor",
  "borderColor",
  "borderRadius",
  "fontSize",
  "letterSpacing",
  "filter",
  "clipPath",
  "innerText",
];

export type AnimeJsPropertyGroupName =
  | "position"
  | "scale"
  | "size"
  | "rotation"
  | "visual"
  | "other";

export const ANIMEJS_PROPERTY_GROUPS: Record<AnimeJsPropertyGroupName, ReadonlySet<string>> = {
  position: new Set(["translateX", "translateY", "translateZ"]),
  scale: new Set(["scale", "scaleX", "scaleY"]),
  size: new Set(["width", "height"]),
  rotation: new Set(["rotate", "rotateX", "rotateY", "rotateZ", "skew", "skewX", "skewY"]),
  visual: new Set(["opacity", "visibility", "filter"]),
  other: new Set<string>(),
};

const ANIMEJS_PROP_TO_GROUP = new Map<string, AnimeJsPropertyGroupName>();
for (const group of Object.keys(ANIMEJS_PROPERTY_GROUPS)) {
  const typedGroup = groupNameFromString(group);
  if (!typedGroup) continue;
  for (const prop of ANIMEJS_PROPERTY_GROUPS[typedGroup])
    ANIMEJS_PROP_TO_GROUP.set(prop, typedGroup);
}

function groupNameFromString(value: string): AnimeJsPropertyGroupName | null {
  if (
    value === "position" ||
    value === "scale" ||
    value === "size" ||
    value === "rotation" ||
    value === "visual" ||
    value === "other"
  )
    return value;
  return null;
}

export function classifyAnimeJsPropertyGroup(prop: string): AnimeJsPropertyGroupName {
  return ANIMEJS_PROP_TO_GROUP.get(prop) ?? "other";
}

export function classifyAnimeJsTweenPropertyGroup(
  properties: Record<string, unknown>,
): AnimeJsPropertyGroupName | undefined {
  const groups = new Set<AnimeJsPropertyGroupName>();
  for (const key of Object.keys(properties)) {
    if (key === "duration" || key === "ease" || key === "delay") continue;
    groups.add(classifyAnimeJsPropertyGroup(key));
  }
  if (groups.size === 1) return groups.values().next().value;
  return undefined;
}

export const RECOGNIZED_ANIMEJS_EASE_FAMILIES = [
  "linear",
  "steps",
  "Quad",
  "Cubic",
  "Quart",
  "Quint",
  "Back",
  "Elastic",
  "Bounce",
  "Expo",
  "Sine",
  "Circ",
];

const DIRECTIONS = ["in", "out", "inOut"];
const DIRECTIONAL_FAMILIES = [
  "Quad",
  "Cubic",
  "Quart",
  "Quint",
  "Back",
  "Elastic",
  "Bounce",
  "Expo",
  "Sine",
  "Circ",
];

export const SUPPORTED_ANIMEJS_EASES = [
  "linear",
  "steps(1)",
  ...DIRECTIONAL_FAMILIES.flatMap((family) =>
    DIRECTIONS.map((direction) => `${direction}${family}`),
  ),
];
