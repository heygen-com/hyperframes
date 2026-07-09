import type { AnimeJsAnimation, AnimeJsPropertyValue } from "@hyperframes/core/animejs-parser";
import type { GsapAnimation, GsapKeyframesData, GsapMethod } from "@hyperframes/core/gsap-parser";

export type EditableAnimationEngine = "gsap" | "animejs";

export interface EditableAnimationMetadata {
  engine: EditableAnimationEngine;
  propertyKeyframePercentages?: Record<string, Record<number, number>>;
}

export type EditableAnimation = GsapAnimation & {
  engine?: EditableAnimationEngine;
  anime?: EditableAnimationMetadata;
};

function editableMethod(method: AnimeJsAnimation["method"]): GsapMethod | null {
  if (method === "set") return "set";
  if (method === "add" || method === "animate") return "to";
  return null;
}

function primitiveToEditable(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function propertyValueToEditable(value: AnimeJsPropertyValue): number | string | null {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const primitive = primitiveToEditable(value[i]);
      if (primitive !== null) return primitive;
    }
    return null;
  }
  if (typeof value === "string" && value.startsWith("__raw:")) return null;
  return primitiveToEditable(value);
}

function editableProperties(
  properties: Record<string, AnimeJsPropertyValue>,
): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const [property, value] of Object.entries(properties)) {
    if (property === "duration" || property === "ease" || property === "delay") continue;
    const editable = propertyValueToEditable(value);
    if (editable !== null) result[property] = editable;
  }
  return result;
}

function seconds(value: number | string | undefined): number | string | undefined {
  return typeof value === "number" ? value / 1000 : value;
}

// fallow-ignore-next-line complexity
function propertyKeyframesToGsap(anim: AnimeJsAnimation): {
  keyframes?: GsapKeyframesData;
  percentages?: Record<string, Record<number, number>>;
} {
  if (!anim.propertyKeyframes) return {};
  const totalDuration = typeof anim.duration === "number" && anim.duration > 0 ? anim.duration : 1;
  const byPercentage = new Map<number, Record<string, number | string>>();
  const percentages: Record<string, Record<number, number>> = {};

  for (const [property, keyframes] of Object.entries(anim.propertyKeyframes)) {
    let elapsed = 0;
    percentages[property] = {};
    for (let index = 0; index < keyframes.length; index++) {
      const keyframe = keyframes[index];
      if (!keyframe) continue;
      elapsed += keyframe.duration ?? 0;
      const percentage = Math.round((elapsed / totalDuration) * 1000) / 10;
      percentages[property][percentage] = index;
      const value = propertyValueToEditable(keyframe.to ?? keyframe.from ?? "");
      if (value === null) continue;
      const existing = byPercentage.get(percentage) ?? {};
      existing[property] = value;
      byPercentage.set(percentage, existing);
    }
  }

  const keyframes = Array.from(byPercentage.entries())
    .sort(([a], [b]) => a - b)
    .map(([percentage, properties]) => ({ percentage, properties }));
  return keyframes.length > 0
    ? { keyframes: { format: "percentage", keyframes, easeEach: anim.ease }, percentages }
    : { percentages };
}

export function adaptAnimeAnimation(anim: AnimeJsAnimation): EditableAnimation | null {
  const method = editableMethod(anim.method);
  if (!method) return null;
  const convertedKeyframes = propertyKeyframesToGsap(anim);
  const duration = seconds(anim.duration);
  const position = seconds(anim.position) ?? 0;
  const resolvedStart = seconds(anim.resolvedStart);
  return {
    id: anim.id,
    targetSelector: anim.targetSelector,
    method,
    position,
    properties: editableProperties(anim.properties),
    ...(typeof duration === "number" ? { duration } : {}),
    ...(typeof anim.ease === "string" ? { ease: anim.ease } : {}),
    ...(convertedKeyframes.keyframes ? { keyframes: convertedKeyframes.keyframes } : {}),
    ...(typeof resolvedStart === "number" ? { resolvedStart } : {}),
    ...(anim.implicitPosition !== undefined ? { implicitPosition: anim.implicitPosition } : {}),
    ...(anim.propertyGroup ? { propertyGroup: anim.propertyGroup } : {}),
    ...(anim.provenance ? { provenance: anim.provenance } : {}),
    engine: "animejs",
    anime: { engine: "animejs", propertyKeyframePercentages: convertedKeyframes.percentages },
  };
}

export function isAnimeEditableAnimation(anim: GsapAnimation): anim is EditableAnimation {
  return "engine" in anim && anim.engine === "animejs";
}

export function normalizeAnimationPropertyForCollision(property: string): string {
  if (property === "translateX") return "x";
  if (property === "translateY") return "y";
  if (property === "translateZ") return "z";
  if (property === "rotate" || property === "rotateZ") return "rotation";
  return property;
}

export function valueForAnimePropertyUpdate(
  existing: AnimeJsPropertyValue | undefined,
  next: number | string,
): AnimeJsPropertyValue {
  if (Array.isArray(existing) && existing.length >= 2) {
    const first = existing[0];
    return first === undefined ? next : [first, next];
  }
  return next;
}
