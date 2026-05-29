import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { EASE_LABELS, PROP_LABELS, PROP_UNITS } from "./gsapAnimationConstants";

// fallow-ignore-next-line complexity
export function buildTweenSummary(animation: GsapAnimation): string {
  const easeName = animation.ease ?? "none";
  const ease = EASE_LABELS[easeName] ?? easeName;
  const props = Object.entries(animation.properties);
  const target = animation.targetSelector;
  const dur = animation.duration ?? 0;
  const pos = animation.position;
  const propDescs = props.map(([p, v]) => {
    const label = (PROP_LABELS[p] ?? p).toLowerCase();
    const unit = PROP_UNITS[p] ?? "";
    return `${label} to ${v}${unit}`;
  });
  const propText = propDescs.length > 0 ? propDescs.join(", ") : "no properties yet";
  if (animation.method === "set") return `At ${pos}s, instantly set ${target}'s ${propText}.`;
  if (animation.method === "from")
    return `Starting at ${pos}s, over ${dur}s, ${target} enters from ${propText} using a ${ease.toLowerCase()} curve.`;
  if (animation.method === "fromTo") {
    const fromProps = Object.entries(animation.fromProperties ?? {});
    const fromDescs = fromProps.map(([p, v]) => {
      const label = (PROP_LABELS[p] ?? p).toLowerCase();
      const unit = PROP_UNITS[p] ?? "";
      return `${label} ${v}${unit}`;
    });
    const fromText = fromDescs.length > 0 ? fromDescs.join(", ") : "—";
    return `Starting at ${pos}s, over ${dur}s, ${target} animates from [${fromText}] to [${propText}] using a ${ease.toLowerCase()} curve.`;
  }
  return `Starting at ${pos}s, over ${dur}s, animate ${target}'s ${propText} using a ${ease.toLowerCase()} curve.`;
}
