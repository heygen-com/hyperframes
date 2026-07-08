import { resolveEase } from "../animation/easeMap";
import type { MappedEase, MotionEase, ResolvedMotionEase } from "./types";

// Full motion.dev named-ease coverage → nearest GSAP equivalent. Anything
// outside this table falls back to "none" (linear) — documented in the
// /figma skill's motion section so the fallback is never a surprise.
const NAMED_EASE: Record<string, string> = {
  linear: "none",
  ease: "power1.inOut",
  easein: "power2.in",
  easeout: "power2.out",
  easeinout: "power2.inOut",
  easeinandout: "power2.inOut",
  backin: "back.in",
  backout: "back.out",
  backinout: "back.inOut",
  backinandout: "back.inOut",
  circin: "circ.in",
  circout: "circ.out",
  circinout: "circ.inOut",
  expoin: "expo.in",
  expoout: "expo.out",
  expoinout: "expo.inOut",
  bouncein: "bounce.in",
  bounceout: "bounce.out",
  bounceinout: "bounce.inOut",
  elasticin: "elastic.in",
  elasticout: "elastic.out",
  elasticinout: "elastic.inOut",
  anticipate: "back.in",
  spring: "elastic.out",
  hold: "steps(1)",
};

function isBezier4(ease: unknown[]): ease is [number, number, number, number] {
  return ease.length === 4 && ease.every((n) => typeof n === "number" && Number.isFinite(n));
}

export function mapEase(ease: MotionEase): MappedEase {
  if (Array.isArray(ease)) {
    // Runtime-validate the 4-tuple: a malformed payload (3 numbers, NaN)
    // would otherwise emit a broken CustomEase path that fails at load.
    if (isBezier4(ease)) return { kind: "bezier", bezier: ease };
    return { kind: "named", ease: "none" };
  }
  const key = ease.toLowerCase().replace(/[_\s-]/g, "");
  return { kind: "named", ease: NAMED_EASE[key] ?? "none" };
}

function formatEaseNumber(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function cubicBezierExpression(bezier: [number, number, number, number]): string {
  const [x1, y1, x2, y2] = bezier;
  return `anime.cubicBezier(${formatEaseNumber(x1)}, ${formatEaseNumber(
    y1,
  )}, ${formatEaseNumber(x2)}, ${formatEaseNumber(y2)})`;
}

export function resolveMotionEase(ease: MotionEase): ResolvedMotionEase {
  const mapped = mapEase(ease);
  if (mapped.kind === "named") {
    return { kind: "named", ease: resolveEase(mapped.ease).animeEase };
  }

  return { kind: "custom", ease: cubicBezierExpression(mapped.bezier) };
}
