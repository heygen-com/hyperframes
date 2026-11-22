/** Sanitize a figma-exported SVG before it touches disk (design spec §5). DOM-walk allowlist
 * (linkedom): unknown elements and attributes are dropped by default rather than pattern-matched
 * as dangerous, so a new SVG feature can't reopen a class of bug the way regex denylisting did.
 */
import { DOMParser } from "linkedom";
import {
  SVG_ATTRIBUTES as SAFE_ATTRIBUTES,
  SVG_ELEMENTS as SAFE_ELEMENTS,
} from "../utils/svgAllowlist";

function localName(name: string): string {
  const i = name.lastIndexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

/** href/xlink:href (any prefix): a same-document fragment always, `data:image/` only off `<a>`
 * (an `<a>` navigates the top-level document on click; `<use>`/`<image>`/`<feImage>` only fetch
 * it as an inert image resource). */
function isAllowedHref(value: string, tagLocalName: string): boolean {
  const v = value.trim();
  if (v.startsWith("#")) return true;
  return /^data:image\//i.test(v) && tagLocalName.toLowerCase() !== "a";
}

/** CSS loads a resource only through a function (`url()`, `image-set()`, `src()`, ...) or
 * `@import`, so CSS text passes only if every function is on this compute-only list, every
 * `url()` is a same-document fragment, and there is no `@import`. `""` is a bare `(...)` group. */
const SAFE_CSS_FUNCTIONS = new Set([
  "",
  "url",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "var",
  "calc",
  "min",
  "max",
  "clamp",
  "matrix",
  "matrix3d",
  "translate",
  "translatex",
  "translatey",
  "translatez",
  "translate3d",
  "scale",
  "scalex",
  "scaley",
  "scalez",
  "scale3d",
  "rotate",
  "rotatex",
  "rotatey",
  "rotatez",
  "rotate3d",
  "skew",
  "skewx",
  "skewy",
  "perspective",
  "cubic-bezier",
  "steps",
  "blur",
  "brightness",
  "contrast",
  "drop-shadow",
  "grayscale",
  "hue-rotate",
  "invert",
  "opacity",
  "saturate",
  "sepia",
]);

function decodeCssEscape(hex: string | undefined, char: string | undefined): string {
  if (hex === undefined) return char ?? "";
  const cp = parseInt(hex, 16);
  const invalid = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
  return invalid ? "�" : String.fromCodePoint(cp);
}

// A browser folds CR LF, CR and FF to one newline, then reads `\75 rl(` as `url(`, so every check
// runs on that decoded, lowercased text. Comments stay in: CSS never lets one join a function name.
function canonicalCss(text: string): string {
  return text
    .replace(/\r\n?|\f/g, "\n")
    .replace(/\\([0-9a-f]{1,6})[ \t\n]?|\\([\s\S])/gi, (_, hex, char) => decodeCssEscape(hex, char))
    .toLowerCase();
}

// The scans below are single-pass indexOf loops, not regexes: the input is attacker-controlled
// and a backtracking regex here stalled the CLI for seconds on a few KB of padding.
function isCssNameChar(c: string | undefined): boolean {
  return c !== undefined && /[-\w]/.test(c);
}

function functionNameBefore(css: string, paren: number): string {
  let start = paren;
  while (isCssNameChar(css[start - 1])) start--;
  return css.slice(start, paren);
}

function everyFunctionIsSafe(css: string): boolean {
  for (let at = css.indexOf("("); at !== -1; at = css.indexOf("(", at + 1)) {
    if (!SAFE_CSS_FUNCTIONS.has(functionNameBefore(css, at))) return false;
  }
  return true;
}

// A value holding "(" is rejected, so no second url( can hide inside the one being checked.
function isLocalUrlValue(raw: string): boolean {
  const value = raw.trim().replace(/^['"]/, "");
  return value.startsWith("#") && !value.includes("(");
}

function everyUrlIsLocalFragment(css: string): boolean {
  for (let at = css.indexOf("url("); at !== -1; ) {
    const close = css.indexOf(")", at + 4);
    if (close === -1 || !isLocalUrlValue(css.slice(at + 4, close))) return false;
    at = css.indexOf("url(", close + 1);
  }
  return true;
}

function isSafeCss(text: string): boolean {
  const css = canonicalCss(text);
  return !css.includes("@import") && everyFunctionIsSafe(css) && everyUrlIsLocalFragment(css);
}

function isXmlnsAttribute(name: string): boolean {
  return name === "xmlns" || name.startsWith("xmlns:");
}

// aria-*/data-* are inert key/value pairs everywhere else; still CSS-checked below,
// defensively, rather than trusted just because no browser reads CSS from them today.
function isKnownAttribute(local: string): boolean {
  return SAFE_ATTRIBUTES.has(local) || local.startsWith("aria-") || local.startsWith("data-");
}

// Every kept value goes through isSafeCss (style= and presentation attributes are CSS); a
// non-CSS value that merely looks like a call, e.g. id="XRP-(XRP)", is dropped: fails closed.
function isSafeAttribute(tagLocalName: string, name: string, value: string): boolean {
  if (isXmlnsAttribute(name)) return true;
  const local = localName(name);
  if (local === "href") return isAllowedHref(value, tagLocalName);
  return isKnownAttribute(local) && isSafeCss(value);
}

export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root) return "";

  for (const el of [...doc.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    if (!SAFE_ELEMENTS.has(el.tagName)) {
      el.remove();
      continue;
    }
    if (el.tagName === "style" && !isSafeCss(el.textContent)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (!isSafeAttribute(el.tagName, attr.name, attr.value)) el.removeAttribute(attr.name);
    }
  }
  return root.isConnected ? root.outerHTML : "";
}
