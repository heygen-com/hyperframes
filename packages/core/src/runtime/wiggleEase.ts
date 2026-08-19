export type WiggleType = "easeOut" | "easeInOut" | "anticipate" | "uniform";

export type WiggleEaseConfig = {
  wiggles: number;
  type: WiggleType;
  amplitude?: number;
};

type WiggleEase = (progress: number) => number;

const WIGGLE_TOKEN =
  /^\s*wiggle\(\s*(\d+)\s*,\s*(easeOut|easeInOut|anticipate|uniform)\s*(?:,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*)?\)\s*$/;
const TAU = Math.PI * 2;

export function parseWiggleEase(ease: string): WiggleEaseConfig | null {
  const match = WIGGLE_TOKEN.exec(ease);
  if (!match) return null;
  const wiggles = Number(match[1]);
  if (!Number.isSafeInteger(wiggles) || wiggles < 1) return null;
  const type = match[2];
  if (type !== "easeOut" && type !== "easeInOut" && type !== "anticipate" && type !== "uniform") {
    return null;
  }
  if (match[3] === undefined) return { wiggles, type };
  const amplitude = Number(match[3]);
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) return null;
  return { wiggles, type, amplitude };
}

export function evaluateWiggleEase(
  progress: number,
  wiggles: number,
  type: WiggleType,
  amplitude?: number,
): number {
  if (!Number.isFinite(progress)) return progress;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  const peakAmplitude =
    amplitude ??
    (type === "easeInOut" ? 0.08 : type === "uniform" ? 0.14 : type === "anticipate" ? 0.12 : 0.16);
  const envelope =
    type === "easeInOut"
      ? peakAmplitude * Math.sin(Math.PI * progress)
      : type === "uniform"
        ? peakAmplitude
        : peakAmplitude * (1 - progress);
  const direction = type === "anticipate" ? -1 : 1;
  // Overshoot outside [0, 1] is intentional: wiggle eases model spring-like
  // motion while still pinning the exact segment endpoints above.
  return progress + direction * envelope * Math.sin(TAU * wiggles * progress);
}

export function resolveWiggleEase(
  ease: string,
  cache?: Map<string, WiggleEase>,
): WiggleEase | null {
  const config = parseWiggleEase(ease);
  if (!config) return null;
  const key = `${config.wiggles}:${config.type}:${config.amplitude ?? "default"}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const wiggleEase: WiggleEase = (progress) =>
    evaluateWiggleEase(progress, config.wiggles, config.type, config.amplitude);
  cache?.set(key, wiggleEase);
  return wiggleEase;
}
