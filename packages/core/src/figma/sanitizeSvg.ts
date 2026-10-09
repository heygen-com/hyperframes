/** Sanitize a figma-exported SVG before it touches disk (design spec §5). DOM-walk allowlist
 * (linkedom): unknown elements and attributes are dropped by default rather than pattern-matched
 * as dangerous, so a new SVG feature can't reopen a class of bug the way regex denylisting did.
 */
import { DOMParser } from "linkedom";

const SAFE_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "image",
  "a",
  "switch",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "mask",
  "clipPath",
  "marker",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "title",
  "desc",
  "metadata",
  "style",
]);

// Local names only — a namespace prefix (xlink:href, x:href, ...) is stripped before this
// lookup, so it doesn't matter which prefix an attacker aliases onto a real or fake namespace.
const SAFE_ATTRIBUTES = new Set([
  "id",
  "class",
  "style",
  "transform",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "points",
  "d",
  "offset",
  "enable-background",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "maskUnits",
  "maskContentUnits",
  "clipPathUnits",
  "clip-rule",
  "filterUnits",
  "primitiveUnits",
  "preserveAspectRatio",
  "space",
  "lang",
  "role",
  "focusable",
  "tabindex",
  "version",
  "baseProfile",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "clip-path",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "marker",
  "cursor",
  "pointer-events",
  "visibility",
  "display",
  "overflow",
  "vector-effect",
  "paint-order",
  "color-interpolation",
  "color-interpolation-filters",
  "isolation",
  "mix-blend-mode",
  "startOffset",
  "method",
  "spacing",
  "side",
  "textLength",
  "lengthAdjust",
  "in",
  "in2",
  "result",
  "mode",
  "type",
  "values",
  "dx",
  "dy",
  "stdDeviation",
  "edgeMode",
  "k1",
  "k2",
  "k3",
  "k4",
  "operator",
  "radius",
  "scale",
  "xChannelSelector",
  "yChannelSelector",
  "baseFrequency",
  "numOctaves",
  "seed",
  "stitchTiles",
  "tableValues",
  "slope",
  "intercept",
  "amplitude",
  "exponent",
  "order",
  "divisor",
  "bias",
  "targetX",
  "targetY",
  "kernelMatrix",
  "preserveAlpha",
  "kernelUnitLength",
  "surfaceScale",
  "diffuseConstant",
  "specularConstant",
  "specularExponent",
  "lighting-color",
  "flood-color",
  "flood-opacity",
  "azimuth",
  "elevation",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "limitingConeAngle",
]);

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

// A browser reads `\75 rl(` as `url(`, so every check runs on escape-decoded, lowercased text.
// Comments stay in: CSS never lets one join a function name or `@import`, only split tokens.
function canonicalCss(text: string): string {
  return text
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (_, hex, char) =>
      decodeCssEscape(hex, char),
    )
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
