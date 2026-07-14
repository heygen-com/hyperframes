import { evaluateSpringEase, parseSpringBounce } from "../parsers/springEase";
import { resolveWiggleEase } from "./wiggleEase";

type RuntimeEase = (progress: number) => number;

type ConfigurableEase = RuntimeEase & { config?: (...params: unknown[]) => RuntimeEase };

type GsapEaseApi = {
  parseEase?: (ease: string | RuntimeEase, ...args: unknown[]) => RuntimeEase | null;
  registerEase?: (name: string, ease: RuntimeEase) => void;
};

const BISECTION_STEPS = 24;
const HOLD_EASE: RuntimeEase = (progress) => (progress >= 1 ? 1 : 0);
const NUMBER_SOURCE = String.raw`([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)`;
const CUSTOM_CUBIC_PATH = new RegExp(
  String.raw`^\s*M\s*0\s*,\s*0\s+C\s*${NUMBER_SOURCE}\s*,\s*${NUMBER_SOURCE}\s+${NUMBER_SOURCE}\s*,\s*${NUMBER_SOURCE}\s+1\s*,\s*1\s*$`,
  "i",
);

function cubicCoordinate(t: number, point1: number, point2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * point1 + 3 * inverse * t * t * point2 + t * t * t;
}

function evaluateCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  let low = 0;
  let high = 1;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const t = (low + high) / 2;
    if (cubicCoordinate(t, x1, x2) < progress) low = t;
    else high = t;
  }
  return cubicCoordinate((low + high) / 2, y1, y2);
}

function createCubicBezierEase(path: string): RuntimeEase | null {
  const match = CUSTOM_CUBIC_PATH.exec(path);
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (Math.min(x1, x2) < 0 || Math.max(x1, x2) > 1) return null;
  return (progress) => evaluateCubicBezier(progress, x1, y1, x2, y2);
}

function resolveSpringEase(
  ease: string,
  springEaseCache: Map<number, RuntimeEase>,
): RuntimeEase | null {
  if (!ease.startsWith("spring(")) return null;
  const bounce = parseSpringBounce(ease);
  if (bounce === null) return null;
  const cached = springEaseCache.get(bounce);
  if (cached) return cached;
  const springEase: RuntimeEase = (progress) => evaluateSpringEase(progress, bounce);
  springEaseCache.set(bounce, springEase);
  return springEase;
}

function resolveCustomEase(
  ease: string,
  customEaseCache: Map<string, RuntimeEase>,
): RuntimeEase | null {
  if (!ease.startsWith("custom(") || !ease.endsWith(")")) return null;
  const path = ease.slice(7, -1);
  const cached = customEaseCache.get(path);
  if (cached) return cached;
  const customEase = createCubicBezierEase(path);
  if (customEase) customEaseCache.set(path, customEase);
  return customEase;
}

export function installStudioCustomEase(gsap: GsapEaseApi): boolean {
  const originalParseEase = gsap.parseEase;
  if (!originalParseEase) return false;

  const customEaseCache = new Map<string, RuntimeEase>();
  const springEaseCache = new Map<number, RuntimeEase>();

  // Single source of truth for "hyperframes ease string -> function". Both the
  // public parseEase override and the internal registerEase configs below route
  // through this, so the resolution rules live in exactly one place.
  const resolveHyperframesEase = (ease: string | RuntimeEase): RuntimeEase | null => {
    if (typeof ease !== "string") return null;
    if (ease === "hold") return HOLD_EASE;
    return (
      resolveWiggleEase(ease) ??
      resolveSpringEase(ease, springEaseCache) ??
      resolveCustomEase(ease, customEaseCache)
    );
  };

  // Public parseEase: direct callers (studio ease UI, adapters) resolve
  // synchronously; anything else falls through to GSAP's own parser.
  gsap.parseEase = function parseHyperframesEase(ease, ...args) {
    return resolveHyperframesEase(ease) ?? originalParseEase.call(this, ease, ...args);
  };

  // GSAP resolves a keyframe SEGMENT's ease through its INTERNAL _parseEase /
  // _easeMap, never the public parseEase above — so a custom ease used inside
  // `keyframes:{...}` resolves to undefined and throws "_ease is not a function"
  // on the first render. Register the eases in the internal map too. GSAP calls
  // a configurable ease's `.config(...params)` with the parenthesized string
  // comma-split, so `params.join(",")` losslessly reconstructs the original
  // (including custom() bezier paths, whose commas survive the round-trip).
  const registerEase = gsap.registerEase;
  if (typeof registerEase === "function") {
    registerEase("hold", HOLD_EASE);
    const registerConfigurable = (name: string): void => {
      const base: ConfigurableEase = (progress) => progress;
      base.config = (...params) =>
        resolveHyperframesEase(`${name}(${params.join(",")})`) ?? ((progress) => progress);
      registerEase(name, base);
    };
    registerConfigurable("spring");
    registerConfigurable("wiggle");
    registerConfigurable("custom");
  }
  return true;
}
