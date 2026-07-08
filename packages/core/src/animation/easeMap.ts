import { generateSpringEaseData } from "@hyperframes/parsers";

export type EaseFunction = (t: number) => number;

export interface AnimeEaseMapping {
  animeEase: string;
  fn: EaseFunction;
}

export interface ResolvedEase extends AnimeEaseMapping {
  warning?: string;
  customEase?: ParsedCustomEase;
}

export interface CustomEasePoint {
  x: number;
  y: number;
}

export interface ParsedCustomEase {
  kind: "customEase";
  path: string;
  points: CustomEasePoint[];
}

type Direction = "in" | "out" | "inOut";

const BACK_OVERSHOOT = 1.70158;
const ELASTIC_DEFAULT_AMPLITUDE = 1;
const ELASTIC_DEFAULT_PERIOD = 0.3;
const ELASTIC_IN_OUT_PERIOD = 0.45;
const PATH_SAMPLE_COUNT = 24;

const DIRECTIONS: Direction[] = ["in", "out", "inOut"];

interface PowerFamily {
  gsap: string;
  anime: string;
  power: number;
}

interface NativeFamily {
  gsap: string;
  anime: string;
  fn: (direction: Direction) => EaseFunction;
}

interface SpringPreset {
  mass: number;
  stiffness: number;
  damping: number;
}

const SPRING_PRESETS: Record<string, SpringPreset> = {
  "spring-gentle": { mass: 1, stiffness: 100, damping: 15 },
  "spring-bouncy": { mass: 1, stiffness: 180, damping: 12 },
  "spring-stiff": { mass: 1, stiffness: 300, damping: 20 },
  "spring-wobbly": { mass: 1, stiffness: 120, damping: 8 },
  "spring-heavy": { mass: 3, stiffness: 200, damping: 20 },
};

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  const text = String(rounded);
  if (text.startsWith("0.")) return text.slice(1);
  if (text.startsWith("-0.")) return `-${text.slice(2)}`;
  return text;
}

function inOutFromOut(out: EaseFunction): EaseFunction {
  return (t) => (t < 0.5 ? (1 - out(1 - 2 * t)) / 2 : 0.5 + out(2 * (t - 0.5)) / 2);
}

function byDirection(direction: Direction, out: EaseFunction): EaseFunction {
  if (direction === "out") return out;
  if (direction === "in") return (t) => 1 - out(1 - t);
  return inOutFromOut(out);
}

function powerEase(power: number, direction: Direction): EaseFunction {
  return byDirection(direction, (t) => 1 - (1 - t) ** power);
}

function backEase(direction: Direction, overshoot = BACK_OVERSHOOT): EaseFunction {
  return byDirection(direction, (t) => {
    const p = t - 1;
    return p * p * ((overshoot + 1) * p + overshoot) + 1;
  });
}

function elasticEase(
  direction: Direction,
  amplitude = ELASTIC_DEFAULT_AMPLITUDE,
  period = direction === "inOut" ? ELASTIC_IN_OUT_PERIOD : ELASTIC_DEFAULT_PERIOD,
): EaseFunction {
  const safeAmplitude = amplitude > 0 ? amplitude : ELASTIC_DEFAULT_AMPLITUDE;
  const resolvedAmplitude = safeAmplitude >= 1 ? safeAmplitude : 1;
  const resolvedPeriod = period / (safeAmplitude < 1 ? safeAmplitude : 1);
  const phase = (resolvedPeriod / (Math.PI * 2)) * (Math.asin(1 / resolvedAmplitude) || 0);
  const out = (t: number): number => {
    if (t === 0 || t === 1) return t;
    return (
      resolvedAmplitude * 2 ** (-10 * t) * Math.sin(((t - phase) * Math.PI * 2) / resolvedPeriod) +
      1
    );
  };
  return byDirection(direction, out);
}

function bounceEase(direction: Direction): EaseFunction {
  const out = (t: number): number => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) {
      const p = t - 1.5 / 2.75;
      return 7.5625 * p * p + 0.75;
    }
    if (t < 2.5 / 2.75) {
      const p = t - 2.25 / 2.75;
      return 7.5625 * p * p + 0.9375;
    }
    const p = t - 2.625 / 2.75;
    return 7.5625 * p * p + 0.984375;
  };
  return byDirection(direction, out);
}

function expoEase(direction: Direction): EaseFunction {
  const out = (t: number): number => 1 - (2 ** (10 * (1 - t - 1)) * (1 - t) + (1 - t) ** 6 * t);
  return byDirection(direction, out);
}

function sineEase(direction: Direction): EaseFunction {
  return byDirection(direction, (t) => (t === 0 ? 0 : Math.sin((t * Math.PI) / 2)));
}

function circEase(direction: Direction): EaseFunction {
  return byDirection(direction, (t) => Math.sqrt(1 - (t - 1) * (t - 1)));
}

function stepsEase(steps: number): EaseFunction {
  const safeSteps = Math.max(1, Math.floor(steps));
  const increment = 1 / safeSteps;
  const count = safeSteps + 1;
  return (t) => Math.floor(count * Math.min(0.99999999, clamp01(t))) * increment;
}

function linear(t: number): number {
  return t;
}

function animeBack(direction: Direction, overshoot: number): string {
  return `${direction}Back(${formatNumber(overshoot)})`;
}

function animeElastic(direction: Direction, amplitude: number, period: number): string {
  return `${direction}Elastic(${formatNumber(amplitude)}, ${formatNumber(period)})`;
}

function buildNativeEaseMap(): Record<string, AnimeEaseMapping> {
  const map: Record<string, AnimeEaseMapping> = {
    none: { animeEase: "linear", fn: linear },
    "steps(1)": { animeEase: "steps(1)", fn: stepsEase(1) },
  };
  const powers: PowerFamily[] = [
    { gsap: "power1", anime: "Quad", power: 2 },
    { gsap: "power2", anime: "Cubic", power: 3 },
    { gsap: "power3", anime: "Quart", power: 4 },
    { gsap: "power4", anime: "Quint", power: 5 },
  ];
  const families: NativeFamily[] = [
    { gsap: "bounce", anime: "Bounce", fn: bounceEase },
    { gsap: "expo", anime: "Expo", fn: expoEase },
    { gsap: "sine", anime: "Sine", fn: sineEase },
    { gsap: "circ", anime: "Circ", fn: circEase },
  ];

  for (const family of powers) {
    for (const direction of DIRECTIONS) {
      map[`${family.gsap}.${direction}`] = {
        animeEase: `${direction}${family.anime}`,
        fn: powerEase(family.power, direction),
      };
    }
  }

  for (const direction of DIRECTIONS) {
    map[`back.${direction}`] = {
      animeEase: animeBack(direction, BACK_OVERSHOOT),
      fn: backEase(direction),
    };
    const period = direction === "inOut" ? ELASTIC_IN_OUT_PERIOD : ELASTIC_DEFAULT_PERIOD;
    map[`elastic.${direction}`] = {
      animeEase: animeElastic(direction, ELASTIC_DEFAULT_AMPLITUDE, period),
      fn: elasticEase(direction, ELASTIC_DEFAULT_AMPLITUDE, period),
    };
  }

  for (const family of families) {
    for (const direction of DIRECTIONS) {
      map[`${family.gsap}.${direction}`] = {
        animeEase: `${direction}${family.anime}`,
        fn: family.fn(direction),
      };
    }
  }

  return map;
}

export const GSAP_TO_ANIME_EASE: Record<string, AnimeEaseMapping> = buildNativeEaseMap();

function normalizeDirection(direction: string | undefined): Direction | undefined {
  if (direction === undefined) return "out";
  const lower = direction.toLowerCase();
  if (lower === "in") return "in";
  if (lower === "out") return "out";
  if (lower === "inout") return "inOut";
  return undefined;
}

function parseParams(params: string | undefined): number[] | undefined {
  if (params === undefined || params.trim() === "") return [];
  const parsed: number[] = [];
  for (const token of params.split(",")) {
    const value = Number(token.trim());
    if (!Number.isFinite(value)) return undefined;
    parsed.push(value);
  }
  return parsed;
}

function canonicalEaseKey(ease: string): string | undefined {
  const compact = ease.trim().replace(/\s+/g, "");
  if (compact.toLowerCase() === "none") return "none";
  const stepsMatch = /^steps\((\d+)\)$/i.exec(compact);
  if (stepsMatch) return `steps(${stepsMatch[1]})`;
  const match = /^([a-z]+[1-4]?)(?:\.(in|out|inout))?$/i.exec(compact);
  if (!match) return undefined;

  const family = match[1];
  const direction = normalizeDirection(match[2]);
  if (family === undefined || direction === undefined) return undefined;
  return `${family.toLowerCase()}.${direction}`;
}

function resolveParameterizedSteps(compact: string): AnimeEaseMapping | undefined {
  const stepsMatch = /^steps\((\d+)\)$/i.exec(compact);
  if (stepsMatch) {
    const value = Number(stepsMatch[1]);
    if (!Number.isFinite(value) || value < 1) return undefined;
    const steps = Math.floor(value);
    return { animeEase: `steps(${steps})`, fn: stepsEase(steps) };
  }

  return undefined;
}

function resolveBackParameters(direction: Direction, params: number[]): AnimeEaseMapping {
  const overshoot = params[0] ?? BACK_OVERSHOOT;
  return { animeEase: animeBack(direction, overshoot), fn: backEase(direction, overshoot) };
}

function resolveElasticParameters(direction: Direction, params: number[]): AnimeEaseMapping {
  const amplitude = params[0] ?? ELASTIC_DEFAULT_AMPLITUDE;
  const period =
    params[1] ?? (direction === "inOut" ? ELASTIC_IN_OUT_PERIOD : ELASTIC_DEFAULT_PERIOD);
  return {
    animeEase: animeElastic(direction, amplitude, period),
    fn: elasticEase(direction, amplitude, period),
  };
}

function resolveParameterizedFamily(compact: string): AnimeEaseMapping | undefined {
  const match = /^([a-z]+[1-4]?)(?:\.(in|out|inout))?\(([^)]*)\)$/i.exec(compact);
  if (!match) return undefined;
  const family = match[1];
  const direction = normalizeDirection(match[2]);
  const params = parseParams(match[3]);
  if (family === undefined || direction === undefined || params === undefined) return undefined;

  const lowerFamily = family.toLowerCase();
  if (lowerFamily === "back") return resolveBackParameters(direction, params);
  if (lowerFamily === "elastic") return resolveElasticParameters(direction, params);

  return undefined;
}

function resolveParameterizedEase(ease: string): AnimeEaseMapping | undefined {
  const compact = ease.trim().replace(/\s+/g, "");
  return resolveParameterizedSteps(compact) ?? resolveParameterizedFamily(compact);
}

function isCommand(token: string): boolean {
  return token.length === 1 && "MmLlCc".includes(token);
}

function readNumber(tokens: string[], index: number): { value: number; next: number } | undefined {
  const token = tokens[index];
  if (token === undefined || isCommand(token)) return undefined;
  const value = Number(token);
  if (!Number.isFinite(value)) return undefined;
  return { value, next: index + 1 };
}

function readPoint(
  tokens: string[],
  index: number,
  command: string,
  current: CustomEasePoint,
): { point: CustomEasePoint; next: number } | undefined {
  const x = readNumber(tokens, index);
  if (x === undefined) return undefined;
  const y = readNumber(tokens, x.next);
  if (y === undefined) return undefined;
  const isRelative = command === command.toLowerCase();
  return {
    point: {
      x: isRelative ? current.x + x.value : x.value,
      y: isRelative ? current.y + y.value : y.value,
    },
    next: y.next,
  };
}

function cubicPoint(
  start: CustomEasePoint,
  control1: CustomEasePoint,
  control2: CustomEasePoint,
  end: CustomEasePoint,
  t: number,
): CustomEasePoint {
  const inverse = 1 - t;
  const a = inverse ** 3;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t ** 3;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

function pathTokens(path: string): string[] {
  return path.match(/[MmLlCc]|[-+]?(?:\d+\.?\d*|\.\d+)(?:(?:e|E)[-+]?\d+)?/g) ?? [];
}

interface PathParseState {
  index: number;
  command: string;
  current: CustomEasePoint;
}

function readRequiredPoint(
  tokens: string[],
  index: number,
  command: string,
  current: CustomEasePoint,
  segmentName: string,
): { point: CustomEasePoint; next: number } {
  const point = readPoint(tokens, index, command, current);
  if (point === undefined) throw new Error(`Invalid CustomEase ${segmentName} segment`);
  return point;
}

function consumeLineSegment(
  tokens: string[],
  state: PathParseState,
  upperCommand: string,
  points: CustomEasePoint[],
): PathParseState {
  const next = readRequiredPoint(tokens, state.index, state.command, state.current, upperCommand);
  points.push(next.point);
  return {
    index: next.next,
    command: upperCommand === "M" ? (state.command === "m" ? "l" : "L") : state.command,
    current: next.point,
  };
}

function consumeCubicSegment(
  tokens: string[],
  state: PathParseState,
  points: CustomEasePoint[],
): PathParseState {
  const control1 = readRequiredPoint(tokens, state.index, state.command, state.current, "C");
  const control2 = readRequiredPoint(tokens, control1.next, state.command, state.current, "C");
  const end = readRequiredPoint(tokens, control2.next, state.command, state.current, "C");
  for (let i = 1; i <= PATH_SAMPLE_COUNT; i++) {
    points.push(
      cubicPoint(state.current, control1.point, control2.point, end.point, i / PATH_SAMPLE_COUNT),
    );
  }
  return { index: end.next, command: state.command, current: end.point };
}

function parsePathPoints(path: string): CustomEasePoint[] {
  const tokens = pathTokens(path);
  const points: CustomEasePoint[] = [];
  let state: PathParseState = { index: 0, command: "", current: { x: 0, y: 0 } };

  while (state.index < tokens.length) {
    const token = tokens[state.index];
    if (token === undefined) break;
    if (isCommand(token)) {
      state = { ...state, command: token, index: state.index + 1 };
      continue;
    }

    const upperCommand = state.command.toUpperCase();
    if (upperCommand === "M" || upperCommand === "L") {
      state = consumeLineSegment(tokens, state, upperCommand, points);
      continue;
    }

    if (upperCommand === "C") {
      state = consumeCubicSegment(tokens, state, points);
      continue;
    }

    throw new Error(`Unsupported CustomEase path command "${state.command}"`);
  }

  if (points.length < 2) throw new Error("CustomEase path must contain at least two points");
  return points;
}

interface PointBounds {
  first: CustomEasePoint;
  last: CustomEasePoint;
}

interface PointSegment {
  previous: CustomEasePoint;
  current: CustomEasePoint;
}

function pointBounds(points: CustomEasePoint[]): PointBounds | undefined {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { first, last };
}

function findPointSegment(points: CustomEasePoint[], x: number): PointSegment | undefined {
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous !== undefined && current !== undefined && x <= current.x) {
      return { previous, current };
    }
  }

  return undefined;
}

function interpolateSegment(segment: PointSegment, x: number): number {
  if (segment.current.x === segment.previous.x) return segment.current.y;
  const progress = (x - segment.previous.x) / (segment.current.x - segment.previous.x);
  return segment.previous.y + (segment.current.y - segment.previous.y) * progress;
}

function interpolateAtX(points: CustomEasePoint[], x: number): number {
  const bounds = pointBounds(points);
  if (bounds === undefined) return x;
  if (x <= bounds.first.x) return bounds.first.y;
  if (x >= bounds.last.x) return bounds.last.y;
  return interpolateSegment(
    findPointSegment(points, x) ?? { previous: bounds.last, current: bounds.last },
    x,
  );
}

function customEaseFunction(points: CustomEasePoint[]): EaseFunction {
  return (t) => interpolateAtX(points, clamp01(t));
}

function looksLikeCustomEasePath(ease: string): boolean {
  return /^[Mm]\s*[-+]?(?:\d+\.?\d*|\.\d+)/.test(ease.trim());
}

export function parseCustomEase(path: string): ParsedCustomEase {
  const trimmed = path.trim();
  return { kind: "customEase", path: trimmed, points: parsePathPoints(trimmed) };
}

export function parseCustomEasePath(path: string): EaseFunction {
  return customEaseFunction(parseCustomEase(path).points);
}

export function serializeCustomEase(parsed: ParsedCustomEase): string {
  const [first, ...rest] = parsed.points;
  if (first === undefined) return "M0,0 L1,1";
  const segments = [`M${formatNumber(first.x)},${formatNumber(first.y)}`];
  if (rest.length > 0) {
    segments.push(
      `L${rest.map((point) => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ")}`,
    );
  }
  return segments.join(" ");
}

function resolveSpringPreset(ease: string): ResolvedEase | undefined {
  const preset = SPRING_PRESETS[ease.toLowerCase()];
  if (preset === undefined) return undefined;
  const customEase = parseCustomEase(
    generateSpringEaseData(preset.mass, preset.stiffness, preset.damping, 120),
  );
  return {
    animeEase: serializeCustomEase(customEase),
    fn: customEaseFunction(customEase.points),
    customEase,
  };
}

function fallbackEase(gsapEase: string, warning: string): ResolvedEase {
  return {
    animeEase: "outQuad",
    fn: powerEase(2, "out"),
    warning: `Unrecognized GSAP ease "${gsapEase}"; using anime.js outQuad fallback. ${warning}`,
  };
}

export function resolveEase(gsapEase: string): ResolvedEase {
  const trimmed = gsapEase.trim();
  if (looksLikeCustomEasePath(trimmed)) {
    try {
      const customEase = parseCustomEase(trimmed);
      return {
        animeEase: serializeCustomEase(customEase),
        fn: customEaseFunction(customEase.points),
        customEase,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "CustomEase parse failed";
      return fallbackEase(gsapEase, message);
    }
  }

  const springPreset = resolveSpringPreset(trimmed);
  if (springPreset !== undefined) return springPreset;

  const key = canonicalEaseKey(trimmed);
  if (key !== undefined) {
    const nativeEase = GSAP_TO_ANIME_EASE[key];
    if (nativeEase !== undefined) return { animeEase: nativeEase.animeEase, fn: nativeEase.fn };
  }

  const parameterized = resolveParameterizedEase(trimmed);
  if (parameterized !== undefined) {
    return { animeEase: parameterized.animeEase, fn: parameterized.fn };
  }

  return fallbackEase(gsapEase, "Add an explicit mapping before migrating this ease.");
}
