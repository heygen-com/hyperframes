import type { GsapAnimation } from "@hyperframes/parsers/gsap-parser";
import { EASE_LABELS, PERCENT_PROPS, PROP_LABELS, PROP_UNITS } from "./gsapAnimationConstants";
import { keyframedTweenEases } from "../../utils/gsapKeyframeEases";

function formatPropValue(prop: string, v: number | string): string {
  const unit = PROP_UNITS[prop] ?? "";
  if (PERCENT_PROPS.has(prop)) return `${Math.round(Number(v) * 100)}${unit}`;
  return `${v}${unit}`;
}

const easeLabel = (ease: string) =>
  ease.startsWith("custom(") ? "custom" : (EASE_LABELS[ease] ?? ease);

function keyframedTweenSummary(
  animation: GsapAnimation,
  pos: number | string,
  dur: number,
): string {
  const steps = animation.keyframes?.keyframes ?? [];
  const props = [...new Set(steps.flatMap((kf) => Object.keys(kf.properties)))];
  const propText = props.map((p) => (PROP_LABELS[p] ?? p).toLowerCase()).join(", ");
  const eases = keyframedTweenEases(animation);
  const segmentEases = new Set(steps.slice(1).map((kf) => eases.segment(kf)));
  const segmentText =
    segmentEases.size === 1
      ? `, each segment eased ${easeLabel([...segmentEases][0]!)}`
      : segmentEases.size > 1
        ? ", with per-keyframe easing"
        : "";
  const runText = eases.run && eases.run !== "none" ? `, across a ${easeLabel(eases.run)} run` : "";
  const count = `${steps.length} keyframe${steps.length === 1 ? "" : "s"}`;
  return `Starting at ${pos}s, over ${dur}s, animate ${animation.targetSelector}'s ${propText || "no properties yet"} through ${count}${segmentText}${runText}.`;
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
  if (animation.keyframes) return keyframedTweenSummary(animation, pos, dur);
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
