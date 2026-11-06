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
  /** Computed `font` shorthand plus language: what decides which face draws a given character. */
  fontKey: string;
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
  "-apple-system",
  "blinkmacsystemfont",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

const MAX_PROBED_ELEMENTS = 400;
// A film with a missing webfont flags most of its text; this many findings say so, and each costs a per-character probe.
const MAX_FLAGGED_ELEMENTS = 30;
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
 * Core OS faces that are the metric-compatible substitute for a proprietary family: the platform reports the
 * substitute, and it is what the author's declaration resolves to there, so it counts as the declared face.
 * Only OS substitutes belong here, never per-language entries.
 * - Liberation Sans is metric-compatible with Arial, and Arial's metrics are Helvetica's.
 * - Liberation Serif is metric-compatible with Times New Roman (and Times).
 * - Liberation Mono is metric-compatible with Courier New (and Courier).
 * - macOS reports its system UI face as ".SF NS" when the SF family names are declared.
 */
const OS_SUBSTITUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ["arial", ["liberation sans"]],
  ["helvetica", ["liberation sans"]],
  ["helvetica neue", ["liberation sans"]],
  ["times new roman", ["liberation serif"]],
  ["times", ["liberation serif"]],
  ["courier new", ["liberation mono"]],
  ["courier", ["liberation mono"]],
  ["sf pro", [".sf ns"]],
  ["sf pro text", [".sf ns"]],
  ["sf pro display", [".sf ns"]],
  ["san francisco", [".sf ns"]],
]);

/**
 * Whether `font` is the face `declared` names. Chrome reports a system face by its family name, but a
 * webfont by the file's internal name, so any custom (@font-face) face counts as declared when the declared
 * family is a loaded webfont. By design that includes a webfont later in the author's own stack: Korean drawn
 * by a second listed webfont such as "Noto Sans KR" passes, because the author chose that face. A system face
 * counts only by its own name or as the OS's metric-compatible substitute (see OS_SUBSTITUTES).
 */
export function isDeclaredFace(
  font: Pick<PlatformFont, "familyName" | "isCustomFont">,
  declared: string,
  webfonts: ReadonlySet<string>,
): boolean {
  const name = declared.trim().toLowerCase();
  if (font.isCustomFont) return webfonts.has(name);
  const used = font.familyName.trim().toLowerCase();
  return used === name || (OS_SUBSTITUTES.get(name)?.includes(used) ?? false);
}

// Emoji and symbols are drawn by the system emoji or symbol face on purpose; they are never a fallback defect.
const NOT_TEXT =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{S}]|\u200d|\u20e3|\ufe0e|\ufe0f/u;

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
      fontKey: `${style.font}|${element.closest("[lang]")?.getAttribute("lang") ?? ""}`,
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
  // Platform fonts are read from layout, so settle it before the probes are asked.
  host.getBoundingClientRect();
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
  // Remote objects are released when the session detaches; a release per probe would double the round trips.
  const { nodeId } = await cdp.send("DOM.requestNode", { objectId: result.objectId });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  return fonts.map((font) => ({
    familyName: font.familyName,
    isCustomFont: font.isCustomFont,
    glyphCount: font.glyphCount,
  }));
}

function distinctChars(text: string): string[] {
  const seen = new Set<string>();
  for (const char of text) if (char.trim() !== "" && !NOT_TEXT.test(char)) seen.add(char);
  return [...seen].slice(0, MAX_PROBED_CHARS);
}

/** Faces that drew one character, per computed font: the same font and character answer the same on every element. */
type CharFontCache = Map<string, PlatformFont[]>;

/** Per distinct character of the element, the faces other than the declared one that drew it, probed in one batch. */
async function fallbackByChar(
  page: Page,
  cdp: CDPSession,
  element: ProbeElement,
  declared: string,
  webfonts: ReadonlySet<string>,
  cache: CharFontCache,
): Promise<Map<string, PlatformFont[]>> {
  const chars = distinctChars(element.text);
  const key = (char: string): string => `${element.fontKey}|${char}`;
  const todo = chars.filter((char) => !cache.has(key(char)));
  if (todo.length > 0) {
    const indices = await page.evaluate(parkCharProbes, {
      store: PROBE_STORE,
      index: element.index,
      chars: todo,
    });
    try {
      const probed = await Promise.all(
        todo.map((char, i) => platformFontsAt(cdp, PROBE_STORE, indices[i] ?? -1)),
      );
      todo.forEach((char, i) => cache.set(key(char), probed[i] ?? []));
    } finally {
      await page.evaluate(dropCharProbes, PROBE_STORE);
    }
  }
  return new Map(
    chars.map((char) => [
      char,
      (cache.get(key(char)) ?? []).filter((font) => !isDeclaredFace(font, declared, webfonts)),
    ]),
  );
}

function countOccurrences(text: string, chars: ReadonlySet<string>): number {
  let count = 0;
  for (const char of text) if (chars.has(char)) count += 1;
  return count;
}

/**
 * Text drawn in a face other than the declared first family, at the page's current seek.
 * Chrome says which platform fonts drew each element (CDP `CSS.getPlatformFontsForNode`), so
 * this holds for any script or cause: a missing glyph, an unloaded webfont, a system fallback.
 * Error when the declared face drew none of the run's characters (the whole run fell back); warning for a partial fallback.
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
    const cache: CharFontCache = new Map();
    const findings: Omit<FontFallbackFinding, keyof CheckAnchor>[] = [];
    const requests: AnchorRequest[] = [];
    const named = elements.filter((element) => declaresNamedFamily(firstFamily(element.family)));
    // One pipelined round of element-level reads; only elements with a foreign face go on to the per-character probe.
    const drawn = await Promise.all(named.map((e) => platformFontsAt(cdp, PROBE_STORE, e.index)));
    for (const [n, element] of named.entries()) {
      if (findings.length >= MAX_FLAGGED_ELEMENTS) break;
      const declared = firstFamily(element.family);
      if ((drawn[n] ?? []).every((font) => isDeclaredFace(font, declared, webfonts))) continue;
      const byChar = await fallbackByChar(page, cdp, element, declared, webfonts, cache);
      const affected = new Set([...byChar].filter(([, used]) => used.length > 0).map(([c]) => c));
      if (affected.size === 0) continue;
      const usedFamily = [
        ...new Set([...byChar.values()].flat().map((font) => font.familyName)),
      ].join(", ");
      const glyphCount = countOccurrences(element.text, affected);
      const wholeRun = affected.size === byChar.size;
      findings.push({
        code: FONT_FALLBACK_CODE,
        severity: wholeRun ? "error" : "warning",
        message: `Text in ${element.selector} is declared in "${declared}" but ${wholeRun ? "the whole run" : `${glyphCount} glyph(s)`} was drawn in "${usedFamily}".`,
        fixHint: `Load a face for "${declared}" that covers these characters, or declare a family that does.`,
        text: [...affected].slice(0, MAX_SAMPLE_CHARS).join(""),
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
    if (finding.severity === "error") seen.severity = "error";
    if (finding.glyphCount > seen.glyphCount) {
      Object.assign(seen, { glyphCount: finding.glyphCount, text: finding.text });
    }
  }
  return [...merged.values()];
}
