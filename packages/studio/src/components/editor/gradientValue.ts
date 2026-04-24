export type GradientKind = "linear" | "radial" | "conic";

export type RadialSizeKeyword =
  | "closest-side"
  | "closest-corner"
  | "farthest-side"
  | "farthest-corner";

export interface GradientStop {
  color: string;
  position: number;
}

export interface GradientModel {
  kind: GradientKind;
  repeating: boolean;
  angle: number;
  centerX: number;
  centerY: number;
  shape: "circle" | "ellipse";
  radialSize: RadialSizeKeyword;
  stops: GradientStop[];
}

const RADIAL_SIZE_KEYWORDS: RadialSizeKeyword[] = [
  "closest-side",
  "closest-corner",
  "farthest-side",
  "farthest-corner",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parsePercent(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : fallback;
}

function parseAngle(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseColorStop(raw: string): { color: string; position: number | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/);
  if (!match) return { color: trimmed, position: null };
  return {
    color: match[1].trim(),
    position: match[2] != null ? parsePercent(match[2], 0) : null,
  };
}

function normalizeStops(stops: Array<{ color: string; position: number | null }>): GradientStop[] {
  if (stops.length === 0) {
    return [
      { color: "rgba(60, 230, 172, 0.18)", position: 0 },
      { color: "rgba(255, 255, 255, 0.04)", position: 100 },
    ];
  }

  if (stops.length === 1) {
    return [
      { color: stops[0].color, position: 0 },
      { color: stops[0].color, position: 100 },
    ];
  }

  const result = stops.map((stop, index) => ({
    color: stop.color,
    position: stop.position ?? (index / (stops.length - 1)) * 100,
  }));

  return result.map((stop) => ({
    color: stop.color,
    position: round(clamp(stop.position, 0, 100)),
  }));
}

function splitGradientArgs(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    if (char === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function directionToAngle(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const map: Record<string, number> = {
    "to top": 0,
    "to top right": 45,
    "to right top": 45,
    "to right": 90,
    "to bottom right": 135,
    "to right bottom": 135,
    "to bottom": 180,
    "to bottom left": 225,
    "to left bottom": 225,
    "to left": 270,
    "to top left": 315,
    "to left top": 315,
  };
  return normalized in map ? map[normalized] : null;
}

function parseLinearArgs(parts: string[]): GradientModel {
  const first = parts[0] ?? "";
  const angleFromDirection = directionToAngle(first);
  const firstIsAngle = /-?\d+(?:\.\d+)?deg$/i.test(first);
  const angle = firstIsAngle ? parseAngle(first, 180) : (angleFromDirection ?? 180);
  const stopParts = firstIsAngle || angleFromDirection != null ? parts.slice(1) : parts;

  return {
    kind: "linear",
    repeating: false,
    angle,
    centerX: 50,
    centerY: 50,
    shape: "ellipse",
    radialSize: "farthest-corner",
    stops: normalizeStops(stopParts.map(parseColorStop)),
  };
}

function parseRadialArgs(parts: string[]): GradientModel {
  const first = parts[0] ?? "";
  const hasConfig = /\bat\b|circle|ellipse|closest-|farthest-/i.test(first);
  const config = hasConfig ? first : "";
  const stopParts = hasConfig ? parts.slice(1) : parts;

  const shape = /\bcircle\b/i.test(config) ? "circle" : "ellipse";
  const radialSize =
    RADIAL_SIZE_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(config)) ??
    "farthest-corner";
  const positionMatch = config.match(/at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i);

  return {
    kind: "radial",
    repeating: false,
    angle: 180,
    centerX: parsePercent(positionMatch?.[1], 50),
    centerY: parsePercent(positionMatch?.[2], 50),
    shape,
    radialSize,
    stops: normalizeStops(stopParts.map(parseColorStop)),
  };
}

function parseConicArgs(parts: string[]): GradientModel {
  const first = parts[0] ?? "";
  const hasConfig = /\bfrom\b|\bat\b/i.test(first);
  const config = hasConfig ? first : "";
  const stopParts = hasConfig ? parts.slice(1) : parts;
  const angleMatch = config.match(/from\s+(-?\d+(?:\.\d+)?)deg/i);
  const positionMatch = config.match(/at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/i);

  return {
    kind: "conic",
    repeating: false,
    angle: parseAngle(angleMatch?.[1], 0),
    centerX: parsePercent(positionMatch?.[1], 50),
    centerY: parsePercent(positionMatch?.[2], 50),
    shape: "ellipse",
    radialSize: "farthest-corner",
    stops: normalizeStops(stopParts.map(parseColorStop)),
  };
}

export function buildDefaultGradientModel(fallbackColor?: string): GradientModel {
  return {
    kind: "linear",
    repeating: false,
    angle: 135,
    centerX: 50,
    centerY: 50,
    shape: "ellipse",
    radialSize: "farthest-corner",
    stops: normalizeStops([
      {
        color:
          fallbackColor && fallbackColor !== "transparent"
            ? fallbackColor
            : "rgba(60, 230, 172, 0.18)",
        position: 0,
      },
      { color: "rgba(255, 255, 255, 0.04)", position: 100 },
    ]),
  };
}

export function parseGradient(value: string | undefined): GradientModel | null {
  if (!value || value === "none") return null;
  const match = value.trim().match(/^(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i);
  if (!match) return null;

  const repeating = Boolean(match[1]);
  const kind = match[2].toLowerCase() as GradientKind;
  const parts = splitGradientArgs(match[3] ?? "");

  const parsed =
    kind === "linear"
      ? parseLinearArgs(parts)
      : kind === "radial"
        ? parseRadialArgs(parts)
        : parseConicArgs(parts);

  return { ...parsed, repeating };
}

function formatStop(stop: GradientStop): string {
  return `${stop.color} ${round(stop.position)}%`;
}

export function serializeGradient(model: GradientModel): string {
  const fn = `${model.repeating ? "repeating-" : ""}${model.kind}-gradient`;
  const stops = model.stops.map(formatStop).join(", ");

  if (model.kind === "linear") {
    return `${fn}(${round(model.angle)}deg, ${stops})`;
  }

  if (model.kind === "radial") {
    return `${fn}(${model.shape} ${model.radialSize} at ${round(model.centerX)}% ${round(
      model.centerY,
    )}%, ${stops})`;
  }

  return `${fn}(from ${round(model.angle)}deg at ${round(model.centerX)}% ${round(
    model.centerY,
  )}%, ${stops})`;
}

function blendChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

function formatHex(channel: number): string {
  return channel.toString(16).padStart(2, "0");
}

export function interpolateGradientStopColor(model: GradientModel, position: number): string {
  const clampedPosition = clamp(position, 0, 100);
  const sortedStops = [...model.stops].sort((a, b) => a.position - b.position);
  const exact = sortedStops.find((stop) => Math.abs(stop.position - clampedPosition) < 0.001);
  if (exact) return exact.color;

  const right = sortedStops.find((stop) => stop.position > clampedPosition) ?? sortedStops.at(-1);
  const left =
    [...sortedStops].reverse().find((stop) => stop.position < clampedPosition) ?? sortedStops[0];
  if (!left || !right) return sortedStops[0]?.color ?? "rgba(255, 255, 255, 1)";
  if (left === right) return left.color;

  const leftColor = left.color;
  const rightColor = right.color;
  const leftParsed = leftColor ? parseColorString(leftColor) : null;
  const rightParsed = rightColor ? parseColorString(rightColor) : null;
  if (!leftParsed || !rightParsed) return left.color;

  const ratio = (clampedPosition - left.position) / Math.max(1, right.position - left.position);
  const red = blendChannel(leftParsed.red, rightParsed.red, ratio);
  const green = blendChannel(leftParsed.green, rightParsed.green, ratio);
  const blue = blendChannel(leftParsed.blue, rightParsed.blue, ratio);
  const alpha = round(leftParsed.alpha + (rightParsed.alpha - leftParsed.alpha) * ratio);

  if (alpha >= 1) {
    return `#${formatHex(red)}${formatHex(green)}${formatHex(blue)}`.toUpperCase();
  }

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function insertGradientStop(model: GradientModel, position: number): GradientModel {
  const clampedPosition = round(clamp(position, 0, 100));
  const color = interpolateGradientStopColor(model, clampedPosition);
  const nextStops = [...model.stops, { color, position: clampedPosition }].sort(
    (a, b) => a.position - b.position,
  );
  return {
    ...model,
    stops: nextStops,
  };
}

function parseColorString(
  value: string,
): { red: number; green: number; blue: number; alpha: number } | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (!rgba) return null;

  return {
    red: Number.parseFloat(rgba[1]),
    green: Number.parseFloat(rgba[2]),
    blue: Number.parseFloat(rgba[3]),
    alpha: rgba[4] != null ? Number.parseFloat(rgba[4]) : 1,
  };
}
