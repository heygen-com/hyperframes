import type { DesignTokens, FontToken } from "./types.js";

// The token script runs in the captured page, and the page can redefine the built-ins it uses, so its result
// is whatever the page chose to return. Each field is rebuilt here to its declared type and bounded in size,
// so nothing downstream reads a page-chosen string where it expects a number or a list.

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max = 2000): string =>
  typeof value === "string" ? value.slice(0, max) : "";

const optionalText = (value: unknown, max = 2000): string | undefined =>
  typeof value === "string" ? value.slice(0, max) : undefined;

const wholeText = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.length <= max ? value : undefined;

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function list<T>(value: unknown, max: number, item: (entry: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const kept: T[] = [];
  for (const entry of value.slice(0, max)) {
    const next = item(entry);
    if (next !== undefined) kept.push(next);
  }
  return kept;
}

const textEntry = (max: number) => (entry: unknown) =>
  typeof entry === "string" ? entry.slice(0, max) : undefined;

function font(entry: unknown): FontToken | undefined {
  if (!isFields(entry) || typeof entry.family !== "string" || !entry.family) return undefined;
  const range = entry.weightRange;
  return {
    family: entry.family.slice(0, 200),
    weights: list(entry.weights, 20, optionalNumber),
    ...(typeof entry.variable === "boolean" ? { variable: entry.variable } : {}),
    ...(Array.isArray(range) &&
    range.length === 2 &&
    range.every((n) => optionalNumber(n) !== undefined)
      ? { weightRange: [range[0], range[1]] as [number, number] }
      : {}),
  };
}

const LAYOUTS = new Set(["stacked", "grid", "split", "centered"]);

function section(entry: unknown): DesignTokens["sections"][number] | undefined {
  if (!isFields(entry)) return undefined;
  const layout = LAYOUTS.has(entry.layout as string)
    ? (entry.layout as "stacked" | "grid" | "split" | "centered")
    : undefined;
  return {
    selector: text(entry.selector, 500),
    type: text(entry.type, 100),
    x: optionalNumber(entry.x),
    y: number(entry.y),
    width: optionalNumber(entry.width),
    height: number(entry.height),
    heading: text(entry.heading, 200),
    backgroundColor: optionalText(entry.backgroundColor, 200),
    callsToAction: Array.isArray(entry.callsToAction)
      ? list(entry.callsToAction, 20, textEntry(200))
      : undefined,
    text: optionalText(entry.text, 1000),
    layout,
    assetUrls: Array.isArray(entry.assetUrls)
      ? list(entry.assetUrls, 50, (url) => wholeText(url, 8000))
      : undefined,
    backgroundImage: wholeText(entry.backgroundImage, 100_000),
  };
}

function cssVariables(value: unknown): Record<string, string> {
  if (!isFields(value)) return {};
  const kept: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value).slice(0, 1000)) {
    if (typeof entry === "string") kept[name.slice(0, 200)] = entry.slice(0, 2000);
  }
  return kept;
}

function page(value: unknown): DesignTokens["page"] {
  if (!isFields(value)) return undefined;
  const viewport = isFields(value.viewport) ? value.viewport : {};
  return {
    width: number(value.width),
    height: number(value.height),
    viewport: { width: number(viewport.width), height: number(viewport.height) },
  };
}

/** The token script's result as `DesignTokens`: every field of its declared type, every list and text bounded. */
export function normalizeDesignTokens(raw: unknown): DesignTokens {
  const value = isFields(raw) ? raw : {};
  return {
    title: text(value.title, 500),
    description: text(value.description),
    ogImage: wholeText(value.ogImage, 8000),
    cssVariables: cssVariables(value.cssVariables),
    fonts: list(value.fonts, 20, font),
    colors: list(value.colors, 20, textEntry(100)),
    headings: list(value.headings, 20, (entry) =>
      isFields(entry)
        ? {
            level: number(entry.level),
            text: text(entry.text, 200),
            fontSize: text(entry.fontSize, 100),
            fontWeight: text(entry.fontWeight, 100),
            color: text(entry.color, 100),
          }
        : undefined,
    ),
    ctas: list(value.ctas, 10, (entry) =>
      isFields(entry)
        ? { text: text(entry.text, 60), href: wholeText(entry.href, 8000) }
        : undefined,
    ),
    svgs: list(value.svgs, 50, (entry) =>
      // A cut-off SVG would be written as a broken file, so an oversized one is dropped whole.
      isFields(entry) && typeof entry.outerHTML === "string" && entry.outerHTML.length <= 1_000_000
        ? {
            label: optionalText(entry.label, 500),
            viewBox: optionalText(entry.viewBox, 200),
            width: number(entry.width),
            height: number(entry.height),
            outerHTML: entry.outerHTML,
            isLogo: entry.isLogo === true,
          }
        : undefined,
    ),
    sections: list(value.sections, 200, section),
    colorStats: list(value.colorStats, 48, (entry) =>
      isFields(entry) && typeof entry.hex === "string"
        ? {
            hex: entry.hex.slice(0, 100),
            count: number(entry.count),
            bgCount: number(entry.bgCount),
            interactiveBg: number(entry.interactiveBg),
            areaBg: number(entry.areaBg),
            textCount: number(entry.textCount),
            maxArea: number(entry.maxArea),
          }
        : undefined,
    ),
    page: page(value.page),
  };
}
