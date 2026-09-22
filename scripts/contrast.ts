type Color = readonly [number, number, number, number];
type Role = "text" | "large-text" | "graphic";
export interface ContrastPair {
  id: string;
  foreground: string;
  background: string[];
  paintBacking: string[];
  opacity: number;
  format: "color" | "rgb-channels";
  role: Role;
  minimum: number;
  sources: string[];
}
export interface ContrastTheme {
  id: string;
  selector: string;
  canvas: string;
  pairs: ContrastPair[];
}
export interface Measurement {
  id: string;
  ratio: number;
  minimum: number;
}
export type ContrastBaseline = Record<string, number>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty string");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected finite number");
  return value;
}
function opacity(value: unknown): number {
  const result = number(value);
  if (result < 0 || result > 1) throw new Error("Opacity outside 0..1");
  return result;
}
function role(value: unknown): Role {
  if (value === "text" || value === "large-text" || value === "graphic") return value;
  throw new Error("Unknown contrast role");
}
function roleMinimum(row: Record<string, unknown>) {
  const kind = role(row.role);
  const minimum = number(row.minimum);
  if (minimum !== (kind === "text" ? 4.5 : 3)) throw new Error("Minimum must match WCAG AA role");
  return { role: kind, minimum };
}
function format(value: unknown): ContrastPair["format"] {
  if (value === undefined) return "color";
  if (value === "color" || value === "rgb-channels") return value;
  throw new Error("Unknown color format");
}
function strings(value: unknown): string[] {
  const entries = array(value).map(string);
  if (!entries.length) throw new Error("Expected nonempty list");
  return entries;
}
function parsePair(input: unknown): ContrastPair {
  const row = record(input);
  return {
    id: string(row.id),
    foreground: string(row.foreground),
    background: strings(row.background),
    paintBacking: strings(row.paintBacking ?? row.background),
    opacity: opacity(row.opacity ?? 1),
    format: format(row.format),
    ...roleMinimum(row),
    sources: strings(row.sources),
  };
}
export function parseManifest(text: string): ContrastTheme[] {
  const themes = array(record(JSON.parse(text)).themes).map((input) => {
    const theme = record(input);
    return {
      id: string(theme.id),
      selector: string(theme.selector),
      canvas: string(theme.canvas),
      pairs: array(theme.pairs).map(parsePair),
    };
  });
  const ids = themes.flatMap((theme) => theme.pairs.map((pair) => `${theme.id}/${pair.id}`));
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error("Empty or duplicate contrast pairs");
  return themes;
}
export function parseBaseline(text: string): ContrastBaseline {
  return Object.fromEntries(
    Object.entries(record(JSON.parse(text))).map(([key, value]) => [key, number(value)]),
  );
}

function hexColor(hex: string): Color {
  const expanded = hex.length < 5 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const rgba = expanded.padEnd(8, "f");
  const part = (at: number) => parseInt(rgba.slice(at, at + 2), 16) / 255;
  return [part(0), part(2), part(4), part(6)];
}
function channel(value: string, divisor: number): number {
  const numeric = value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value) / divisor;
  if (![Number.isFinite(numeric), numeric >= 0, numeric <= 1].every(Boolean))
    throw new Error(`Invalid color channel ${value}`);
  return numeric;
}
function rgbColor(value: string): Color {
  const parts = value.trim().split(/[\s,/]+/);
  if (![3, 4].includes(parts.length)) throw new Error(`Invalid RGB color: ${value}`);
  return [
    channel(parts[0]!, 255),
    channel(parts[1]!, 255),
    channel(parts[2]!, 255),
    channel(parts[3] ?? "1", 1),
  ];
}
export function parseColor(value: string): Color {
  const hex = value.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) return hexColor(hex[1]!);
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) throw new Error(`Unsupported sRGB color: ${value}`);
  return rgbColor(rgb[1]!);
}
export function composite(foreground: Color, background: Color): Color {
  if (background[3] !== 1) throw new Error("Compositing requires an opaque backing");
  const mix = (at: 0 | 1 | 2) =>
    foreground[at] * foreground[3] + background[at] * (1 - foreground[3]);
  return [mix(0), mix(1), mix(2), 1];
}
function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function luminance(color: Color): number {
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}
export function contrast(a: Color, b: Color): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tokensFor(css: string, selector: string): Map<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    (match) => match[1]!.trim() === selector,
  );
  if (blocks.length !== 1) throw new Error(`Expected exactly one theme block: ${selector}`);
  const entries = [...blocks[0]![2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    (match) => [match[1]!, match[2]!.trim()] as const,
  );
  const tokens = new Map(entries);
  if (tokens.size !== entries.length) throw new Error("Duplicate token declaration");
  return tokens;
}
function tokenValue(name: string, tokens: Map<string, string>, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Token cycle: ${name}`);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Missing token: ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? tokenValue(alias[1]!, tokens, [...seen, name]) : value;
}
function surface(layers: string[], canvas: Color, tokens: Map<string, string>): Color {
  return layers.reduce(
    (backing, name) => composite(parseColor(tokenValue(name, tokens)), backing),
    canvas,
  );
}
function measurePair(
  pair: ContrastPair,
  theme: ContrastTheme,
  tokens: Map<string, string>,
): Measurement {
  const canvas = parseColor(tokenValue(theme.canvas, tokens));
  if (canvas[3] !== 1) throw new Error("Theme canvas must be opaque");
  const value = tokenValue(pair.foreground, tokens);
  const fg = pair.format === "rgb-channels" ? rgbColor(value) : parseColor(value);
  const paint: Color = [fg[0], fg[1], fg[2], fg[3] * pair.opacity];
  const backing = surface(pair.paintBacking, canvas, tokens);
  const background = surface(pair.background, canvas, tokens);
  return {
    id: `${theme.id}/${pair.id}`,
    minimum: pair.minimum,
    ratio: contrast(composite(paint, backing), background),
  };
}
export function measure(css: string, themes: ContrastTheme[]): Measurement[] {
  return themes.flatMap((theme) => {
    const tokens = tokensFor(css, theme.selector);
    return theme.pairs.map((pair) => measurePair(pair, theme, tokens));
  });
}
function newDebt(row: Measurement): string[] {
  return row.ratio < row.minimum ? [`${row.id}: new contrast debt ${row.ratio}`] : [];
}
function debtIssue(row: Measurement, baseline: ContrastBaseline): string[] {
  const previous = baseline[row.id];
  if (previous === undefined) return newDebt(row);
  if (row.ratio >= row.minimum) return [`${row.id}: remove passing pair from baseline`];
  if (Math.abs(row.ratio - previous) > 1e-10)
    return [
      `${row.id}: ratio ${row.ratio}, baseline ${previous}; bank improvements, reject regressions`,
    ];
  return [];
}
function baselineDirection(id: string, ratio: number, previous: ContrastBaseline): string[] {
  return ratio < (previous[id] ?? Infinity) ? [`${id}: baseline may only improve`] : [];
}
export function verdict(
  rows: Measurement[],
  baseline: ContrastBaseline,
  previous = baseline,
): string[] {
  const issues = rows.flatMap((row) => debtIssue(row, baseline));
  const ids = new Set(rows.map((row) => row.id));
  for (const [id, ratio] of Object.entries(baseline)) {
    if (!ids.has(id)) issues.push(`${id}: stale baseline pair`);
    issues.push(...baselineDirection(id, ratio, previous));
  }
  return issues;
}
