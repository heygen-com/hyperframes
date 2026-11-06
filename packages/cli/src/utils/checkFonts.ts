import type { CDPSession, Page } from "puppeteer-core";
import type { CheckAnchor, CheckBbox, CheckFinding } from "./checkTypes.js";

export const FONT_FALLBACK_CODE = "text_in_fallback_face";

/** `fonts` section finding: text Chrome drew in a face other than the one the element declares. */
export interface FontFallbackFinding extends CheckFinding {
  declaredFamily: string;
  usedFamily: string;
  glyphCount: number;
}

interface PlatformFont {
  familyName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

interface ProbeElement {
  index: number;
  selector: string;
  family: string;
  text: string;
  bbox: CheckBbox;
}

interface AnchorRequest {
  selector: string;
  time: number;
  bbox: CheckBbox;
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

const MAX_PROBED_ELEMENTS = 400;
const MAX_PROBED_CHARS = 48;
const MAX_SAMPLE_CHARS = 12;
const PROBE_STORE = "__hyperframesFontProbe";

/** First family of a computed `font-family`, unquoted and lowercased for comparison. */
export function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

/** A generic keyword names no face to compare against, so it never counts as a declared family. */
export function declaresNamedFamily(family: string): boolean {
  return family !== "" && !GENERIC_FAMILIES.has(family.toLowerCase());
}

/**
 * Whether `font` is the face `declared` names. Chrome reports a system face by its family name, but a
 * webfont by the file's internal name, so a custom face matches when `declared` is a loaded @font-face family.
 */
export function isDeclaredFace(
  font: Pick<PlatformFont, "familyName" | "isCustomFont">,
  declared: string,
  webfonts: ReadonlySet<string>,
): boolean {
  const name = declared.trim().toLowerCase();
  if (font.isCustomFont) return webfonts.has(name);
  return font.familyName.trim().toLowerCase() === name;
}

/** Elements with their own text, in the page: also parks them in a window store the CDP side reads by index. */
function listTextElements(limit: number, store: string): ProbeElement[] {
  const escapeCss = (value: string): string =>
    window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(value)
      : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const selectorFor = (element: Element): string => {
    if (element.id && document.querySelectorAll(`#${escapeCss(element.id)}`).length === 1) {
      return `#${escapeCss(element.id)}`;
    }
    const parent = element.parentElement;
    const tag = element.tagName.toLowerCase();
    if (!parent) return tag;
    const index = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
    return `${selectorFor(parent)} > ${tag}:nth-of-type(${index.indexOf(element) + 1})`;
  };
  const found: Element[] = [];
  const out: ProbeElement[] = [];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (out.length >= limit) break;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(element.tagName)) continue;
    const text = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("");
    if (text.trim() === "") continue;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      rect.width * rect.height === 0
    ) {
      continue;
    }
    out.push({
      index: found.length,
      selector: selectorFor(element),
      family: style.fontFamily,
      text,
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
    found.push(element);
  }
  Reflect.set(window, store, found);
  return out;
}

/** Families of the page's loaded @font-face faces, lowercased and unquoted. */
function loadedWebfonts(): string[] {
  return Array.from(document.fonts)
    .filter((face) => face.status === "loaded")
    .map((face) =>
      face.family
        .replace(/^["']|["']$/g, "")
        .trim()
        .toLowerCase(),
    );
}

/** Probes one span per distinct character, styled like `element`, and returns the indices it parked in the store. */
function parkCharProbes(args: { store: string; index: number; chars: string[] }): number[] {
  const parked: unknown = Reflect.get(window, args.store);
  if (!Array.isArray(parked)) return [];
  const element: unknown = parked[args.index];
  if (!(element instanceof Element)) return [];
  const style = getComputedStyle(element);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;opacity:0;white-space:pre";
  host.style.font = style.font;
  host.style.fontFeatureSettings = style.fontFeatureSettings;
  host.style.fontVariationSettings = style.fontVariationSettings;
  host.lang = element.closest("[lang]")?.getAttribute("lang") ?? "";
  const indices: number[] = [];
  for (const char of args.chars) {
    const span = document.createElement("span");
    span.textContent = char;
    host.appendChild(span);
    indices.push(parked.length);
    parked.push(span);
  }
  document.body.appendChild(host);
  Reflect.set(window, args.store + "Host", host);
  return indices;
}

function dropCharProbes(store: string): void {
  const host: unknown = Reflect.get(window, store + "Host");
  if (host instanceof Element) host.remove();
  Reflect.deleteProperty(window, store + "Host");
}

async function platformFontsAt(
  cdp: CDPSession,
  store: string,
  index: number,
): Promise<PlatformFont[]> {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression: `window.${store}[${index}]`,
  });
  if (!result.objectId) return [];
  try {
    const { nodeId } = await cdp.send("DOM.requestNode", { objectId: result.objectId });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.map((font) => ({
      familyName: font.familyName,
      isCustomFont: font.isCustomFont,
      glyphCount: font.glyphCount,
    }));
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => undefined);
  }
}

function distinctChars(text: string): string[] {
  const seen = new Set<string>();
  for (const char of text) if (char.trim() !== "") seen.add(char);
  return [...seen].slice(0, MAX_PROBED_CHARS);
}

/** Which of the element's characters a mismatching face actually drew, by probing each one alone. */
async function affectedChars(
  page: Page,
  cdp: CDPSession,
  element: ProbeElement,
  declared: string,
  webfonts: ReadonlySet<string>,
): Promise<string> {
  const chars = distinctChars(element.text);
  const indices = await page.evaluate(parkCharProbes, {
    store: PROBE_STORE,
    index: element.index,
    chars,
  });
  try {
    const hit: string[] = [];
    for (const [i, char] of chars.entries()) {
      const fonts = await platformFontsAt(cdp, PROBE_STORE, indices[i] ?? -1);
      if (fonts.some((font) => !isDeclaredFace(font, declared, webfonts))) hit.push(char);
    }
    return hit.slice(0, MAX_SAMPLE_CHARS).join("");
  } finally {
    await page.evaluate(dropCharProbes, PROBE_STORE);
  }
}

/**
 * Text drawn in a face other than the declared first family, at the page's current seek.
 * Chrome says which platform fonts drew each element (CDP `CSS.getPlatformFontsForNode`), so
 * this holds for any script or cause: a missing glyph, an unloaded webfont, a system fallback.
 */
export async function collectFontFallback(
  page: Page,
  time: number,
  anchor: (requests: AnchorRequest[]) => Promise<CheckAnchor[]>,
): Promise<FontFallbackFinding[]> {
  const elements = await page.evaluate(listTextElements, MAX_PROBED_ELEMENTS, PROBE_STORE);
  if (elements.length === 0) return [];
  const webfonts = new Set(await page.evaluate(loadedWebfonts));
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("DOM.getDocument", { depth: 0 });
    const drafts: { element: ProbeElement; declared: string; used: PlatformFont[] }[] = [];
    for (const element of elements) {
      const declared = firstFamily(element.family);
      if (!declaresNamedFamily(declared)) continue;
      const fonts = await platformFontsAt(cdp, PROBE_STORE, element.index);
      const used = fonts.filter((font) => !isDeclaredFace(font, declared, webfonts));
      if (used.length > 0) drafts.push({ element, declared, used });
    }
    const findings: Omit<FontFallbackFinding, keyof CheckAnchor>[] = [];
    const requests: AnchorRequest[] = [];
    for (const { element, declared, used } of drafts) {
      const text = await affectedChars(page, cdp, element, declared, webfonts);
      const glyphCount = used.reduce((sum, font) => sum + font.glyphCount, 0);
      const usedFamily = used.map((font) => font.familyName).join(", ");
      findings.push({
        code: FONT_FALLBACK_CODE,
        severity: "error",
        message: `Text in ${element.selector} is declared in "${declared}" but ${glyphCount} glyph(s) were drawn in "${usedFamily}".`,
        fixHint: `Load a face for "${declared}" that covers these characters, or declare a family that does.`,
        text,
        declaredFamily: declared,
        usedFamily,
        glyphCount,
      });
      requests.push({ selector: element.selector, time, bbox: element.bbox });
    }
    const anchors = await anchor(requests);
    return findings.map((finding, i) => ({
      ...finding,
      ...(anchors[i] ?? fallbackAnchor(requests[i])),
    }));
  } finally {
    await cdp.detach().catch(() => undefined);
    await page.evaluate((store) => Reflect.deleteProperty(window, store), PROBE_STORE);
  }
}

function fallbackAnchor(request: AnchorRequest | undefined): CheckAnchor {
  return {
    selector: request?.selector ?? "[data-composition-id]",
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: request?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
    time: request?.time ?? 0,
  };
}

/** Same element and same cause across samples is one finding that lists every sample time. */
export function mergeFontFindings(batches: FontFallbackFinding[][]): FontFallbackFinding[] {
  const merged = new Map<string, FontFallbackFinding & { times: number[] }>();
  for (const finding of batches.flat()) {
    const key = JSON.stringify([finding.sourceFile, finding.selector, finding.usedFamily]);
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, { ...finding, times: [finding.time] });
      continue;
    }
    seen.times.push(finding.time);
    if (finding.glyphCount > seen.glyphCount) {
      Object.assign(seen, { glyphCount: finding.glyphCount, text: finding.text });
    }
  }
  return [...merged.values()];
}
