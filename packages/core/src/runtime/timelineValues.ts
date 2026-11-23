export interface DeclaredValue {
  kind: "literal" | "relative" | "expression" | "unknown";
  value: number | string | null;
}
export interface AnimationValues {
  basis: "authored-tween";
  properties: Array<{ property: string; from: DeclaredValue; to: DeclaredValue }>;
  ease: DeclaredValue;
}
const unknown = (): DeclaredValue => ({ kind: "unknown", value: null });
function declared(value: unknown): DeclaredValue {
  if (typeof value === "number" && Number.isFinite(value)) return { kind: "literal", value };
  if (typeof value === "string") {
    const kind = /^[+\-*/]=/.test(value)
      ? "relative"
      : value.includes("random(")
        ? "expression"
        : "literal";
    return { kind, value };
  }
  return unknown();
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function declaredEase(ease: unknown): DeclaredValue {
  return typeof ease === "function"
    ? { kind: "expression", value: "custom function" }
    : declared(ease);
}
/** Authored endpoints, never sampled values or inferred previous-tween state. */
export function animationValues(
  vars: Record<string, unknown>,
  properties: string[],
  keyframesEase?: unknown,
): AnimationValues {
  const startAt = record(vars.startAt);
  const endpoints = (property: string, end: unknown, start: unknown) => ({
    property,
    from: declared(vars.runBackwards ? end : start),
    to: vars.runBackwards ? unknown() : declared(end),
  });
  const segment = declaredEase(vars.ease);
  const whole = keyframesEase === undefined ? undefined : declaredEase(keyframesEase);
  return {
    basis: "authored-tween",
    properties: properties.flatMap((property) => {
      const nested = record(vars[property]);
      const keys = property === "attr" || property === "css" ? Object.keys(nested) : [];
      if (!keys.length) return [endpoints(property, vars[property], startAt[property])];
      const nestedStart = record(startAt[property]);
      return keys.map((key) => endpoints(`${property}.${key}`, nested[key], nestedStart[key]));
    }),
    ease: whole
      ? {
          kind: "expression",
          value: `${whole.value ?? "?"} across keyframes, ${segment.value ?? "?"} per segment`,
        }
      : segment,
  };
}
