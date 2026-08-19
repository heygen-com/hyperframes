/**
 * Sampling and formatting for the property-lane readouts in the track header:
 * what value a property holds at a given tween percentage, and how that value
 * reads to a human. Kept apart from the header's JSX so a formatting change and
 * a layout change never touch the same file.
 */
import gsap from "gsap";
import {
  classifyPropertyGroup,
  type GsapAnimation,
  type PropertyGroupName,
} from "@hyperframes/core/gsap-parser";

export type LaneValues = Record<string, number | string>;

function roundValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** GSAP applies a keyframe's `ease` to the segment ARRIVING at it, so the curve
 *  between two keyframes is named by the later one (with the tween-level
 *  `easeEach`/`ease` as the fallback). Sampling linearly would report a value the
 *  element never has at that time, and stamp that wrong value onto a keyframe
 *  added from the track header. Unknown ease names parse to undefined -> linear. */
function easedProgress(progress: number, animation: GsapAnimation, ease?: string): number {
  const resolved = ease ?? animation.keyframes?.easeEach ?? animation.ease;
  if (!resolved || resolved === "none") return progress;
  return gsap.parseEase(resolved)?.(progress) ?? progress;
}

interface PropertyStop {
  percentage: number;
  value: number | string;
  ease?: string;
}

function propertyStops(animation: GsapAnimation, property: string): PropertyStop[] {
  return (animation.keyframes?.keyframes ?? [])
    .filter((keyframe) => property in keyframe.properties)
    .map((keyframe) => ({
      percentage: keyframe.percentage,
      value: keyframe.properties[property],
      ease: keyframe.ease,
    }));
}

/** A pair only interpolates when both ends are numeric and actually span time;
 *  string values (colors, keywords) and zero-width pairs hold the earlier value.
 *  Returns the numeric ends so the caller needs no cast to use them. */
function interpolableEnds(
  before: PropertyStop,
  after: PropertyStop,
): { from: number; to: number } | null {
  if (typeof before.value !== "number" || typeof after.value !== "number") return null;
  if (before.percentage === after.percentage) return null;
  return { from: before.value, to: after.value };
}

function propertyValueAt(
  animation: GsapAnimation,
  property: string,
  tweenPercentage: number,
): number | string | undefined {
  const stops = propertyStops(animation, property);
  const before = stops.filter((stop) => stop.percentage <= tweenPercentage).at(-1);
  const after = stops.find((stop) => stop.percentage >= tweenPercentage);
  if (!before) return after?.value;
  if (!after) return before.value;
  const ends = interpolableEnds(before, after);
  if (!ends) return before.value;
  const progress = (tweenPercentage - before.percentage) / (after.percentage - before.percentage);
  return ends.from + (ends.to - ends.from) * easedProgress(progress, animation, after.ease);
}

/** Every property of `group` this animation touches, sampled at `tweenPercentage`. */
export function valuesAt(
  animation: GsapAnimation,
  group: PropertyGroupName,
  tweenPercentage: number,
): LaneValues {
  const propertyNames = new Set<string>();
  for (const keyframe of animation.keyframes?.keyframes ?? []) {
    for (const property of Object.keys(keyframe.properties)) {
      if (classifyPropertyGroup(property) === group) propertyNames.add(property);
    }
  }
  const values: LaneValues = {};
  for (const property of propertyNames) {
    const value = propertyValueAt(animation, property, tweenPercentage);
    if (value !== undefined) values[property] = value;
  }
  return values;
}

export function groupLabel(group: PropertyGroupName, properties: LaneValues): string {
  if (group === "visual" && ("opacity" in properties || "autoAlpha" in properties)) {
    return "Opacity";
  }
  if (group !== "other") return `${group[0]?.toUpperCase() ?? ""}${group.slice(1)}`;
  const property = Object.keys(properties)[0];
  return property ? `${property[0]?.toUpperCase() ?? ""}${property.slice(1)}` : "Other";
}

function defaultValueReadout(values: LaneValues): string {
  return Object.values(values)
    .map((value) => (typeof value === "number" ? roundValue(value) : value))
    .join(", ");
}

function positionValueReadout(values: LaneValues): string | null {
  const x = values.x;
  const y = values.y;
  return typeof x === "number" && typeof y === "number"
    ? `${roundValue(x)}, ${roundValue(y)}`
    : null;
}

function rotationValueReadout(values: LaneValues): string | null {
  return typeof values.rotation === "number" ? `${roundValue(values.rotation)}°` : null;
}

function visualValueReadout(values: LaneValues): string | null {
  const opacity = values.opacity ?? values.autoAlpha;
  return typeof opacity === "number"
    ? `${roundValue(Math.abs(opacity) <= 1 ? opacity * 100 : opacity)}%`
    : null;
}

const GROUP_VALUE_READOUTS: Partial<
  Record<PropertyGroupName, (values: LaneValues) => string | null>
> = {
  position: positionValueReadout,
  rotation: rotationValueReadout,
  visual: visualValueReadout,
};

export function valueReadout(group: PropertyGroupName, values: LaneValues): string {
  return GROUP_VALUE_READOUTS[group]?.(values) ?? defaultValueReadout(values);
}
