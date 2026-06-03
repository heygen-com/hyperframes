import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { EASE_LABELS, PERCENT_PROPS, PROP_LABELS, PROP_UNITS } from "./gsapAnimationConstants";

function formatPropValue(prop: string, v: number | string): string {
  const unit = PROP_UNITS[prop] ?? "";
  if (PERCENT_PROPS.has(prop)) return `${Math.round(Number(v) * 100)}${unit}`;
  return `${v}${unit}`;
}

// fallow-ignore-next-line complexity
export function buildTweenSummary(animation: GsapAnimation): string {
  const easeName = animation.ease ?? "none";
  const ease = EASE_LABELS[easeName] ?? easeName;
  const props = Object.entries(animation.properties);
  const target = animation.targetSelector;
  const dur = animation.duration ?? 0;
  const rawPos = animation.position;
  const pos = typeof rawPos === "number" ? parseFloat(rawPos.toFixed(3)) : rawPos;
  const propDescs = props.map(([p, v]) => {
    const label = (PROP_LABELS[p] ?? p).toLowerCase();
    return `${label} to ${formatPropValue(p, v)}`;
  });
  const propText = propDescs.length > 0 ? propDescs.join(", ") : "no properties yet";
  if (animation.method === "set") return `At ${pos}s, instantly set ${target}'s ${propText}.`;
  if (animation.method === "from")
    return `Starting at ${pos}s, over ${dur}s, ${target} enters from ${propText} using a ${ease.toLowerCase()} curve.`;
  if (animation.method === "fromTo") {
    const fromProps = Object.entries(animation.fromProperties ?? {});
    const fromDescs = fromProps.map(([p, v]) => {
      const label = (PROP_LABELS[p] ?? p).toLowerCase();
      return `${label} ${formatPropValue(p, v)}`;
    });
    const fromText = fromDescs.length > 0 ? fromDescs.join(", ") : "—";
    return `Starting at ${pos}s, over ${dur}s, ${target} animates from [${fromText}] to [${propText}] using a ${ease.toLowerCase()} curve.`;
  }
  return `Starting at ${pos}s, over ${dur}s, animate ${target}'s ${propText} using a ${ease.toLowerCase()} curve.`;
}
