import { rebindClipboardSelector, type ClipboardAttributeRewrite } from "./clipboardSelectors";
import postcss, { type AtRule, type Rule, type Container, type Declaration } from "postcss";

const FUNCTIONS = new Set(
  "rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix calc min max clamp matrix matrix3d translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d rotate rotatex rotatey rotatez rotate3d skew skewx skewy perspective linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia inset circle ellipse polygon path rect format local".split(
    " ",
  ),
);
const PROPERTIES =
  /^(?:background(?:-color|-image|-position|-size|-repeat|-origin|-clip)?|border(?:-[a-z]+)*|outline(?:-[a-z]+)*|box-shadow|box-sizing|color|opacity|display|visibility|position|inset(?:-[a-z]+)*|top|right|bottom|left|width|height|min-width|min-height|max-width|max-height|margin(?:-[a-z]+)*|padding(?:-[a-z]+)*|overflow(?:-[xy])?|z-index|transform(?:-origin|-style|-box)?|translate|rotate|scale|perspective(?:-origin)?|backface-visibility|font(?:-[a-z]+)*|line-height|letter-spacing|word-spacing|white-space|text(?:-[a-z]+)*|vertical-align|list-style(?:-[a-z]+)*|object-fit|object-position|aspect-ratio|flex(?:-[a-z]+)*|align(?:-[a-z]+)*|justify(?:-[a-z]+)*|place(?:-[a-z]+)*|gap|row-gap|column-gap|order|grid(?:-[a-z]+)*|fill(?:-opacity|-rule)?|stroke(?:-[a-z]+)*|clip-path|clip-rule|mask|filter|stop-color|stop-opacity|flood-color|flood-opacity|lighting-color|paint-order|vector-effect|isolation|mix-blend-mode|dominant-baseline|alignment-baseline|text-anchor|src)$/;

export function embeddedResource(value: string, font = false): boolean {
  return (
    font
      ? /^data:(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf|vnd.ms-fontobject));base64,[a-z0-9+/=\s]+$/i
      : /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i
  ).test(value);
}

function canonical(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
      (_all, hex: string | undefined, char: string | undefined) =>
        hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : (char ?? ""),
    );
}

export function safeCssValue(
  value: string,
  ids: ReadonlyMap<string, string>,
  font = false,
): string | null {
  let invalid = false;
  const normalized = canonical(value);
  const replaced = normalized.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (_all, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const url = (double ?? single ?? bare ?? "").trim();
      if (url.startsWith("#") && ids.has(url.slice(1))) return `url("#${ids.get(url.slice(1))}")`;
      if (embeddedResource(url, font)) return `url("${url.replace(/\s/g, "")}")`;
      invalid = true;
      return "";
    },
  );
  const withoutUrls = replaced.replace(/url\("[^"]*"\)/gi, "");
  if (invalid || /[\\<>@{};]/.test(withoutUrls)) return null;
  for (const match of withoutUrls.matchAll(/([\w-]+)\s*\(/g))
    if (!FUNCTIONS.has((match[1] ?? "").toLowerCase())) return null;
  return replaced;
}

interface CssContext {
  scope: string;
  ids: ReadonlyMap<string, string>;
  warn: () => void;
  fonts: ReadonlyMap<string, string>;
  attributes?: readonly ClipboardAttributeRewrite[];
}
function declaration(decl: Declaration, context: CssContext, font = false): void {
  const prop = canonical(decl.prop).toLowerCase();
  const value = safeCssValue(decl.value, context.ids, font && prop === "src");
  if (!PROPERTIES.test(prop) || (prop === "src" && !font) || value === null) {
    decl.remove();
    context.warn();
    return;
  }
  decl.prop = prop;
  decl.value = rewriteDeclarationValue(prop, value, context.fonts);
}

function rewriteDeclarationValue(
  prop: string,
  value: string,
  fonts: ReadonlyMap<string, string>,
): string {
  if (prop === "position" && /fixed|sticky/i.test(value)) return "absolute";
  if (prop === "font-family") return renameElementFonts(value, fonts);
  if (prop === "font") return renameFontShorthand(value, fonts);
  return value;
}

function validSelector(selector: string): boolean {
  try {
    if (typeof CSS.supports === "function") return CSS.supports(`selector(${selector})`);
    document.createDocumentFragment().querySelector(selector);
    // DOM shims accept consecutive combinators that browsers reject.
    return !/(?:[>+~]\s*){2}/.test(selector);
  } catch {
    return false;
  }
}

function sanitizeRule(node: Rule, context: CssContext): void {
  // Nesting can express selectors outside the intended descendant scope. Keep flat rules only.
  if (
    node.nodes.some((child) => child.type !== "decl" && child.type !== "comment") ||
    /[\\<@{}]/.test(node.selector) ||
    !validSelector(node.selector)
  ) {
    node.remove();
    context.warn();
    return;
  }
  const selector = rebindClipboardSelector(node.selector, context.ids, context.attributes);
  node.selector = `#${context.scope} :is(${selector})`;
  node.walkDecls((decl) => declaration(decl, context));
}

function sanitizeAtRule(node: AtRule, context: CssContext): void {
  if (["media", "supports"].includes(node.name.toLowerCase()) && !/[\\<@{}]/.test(node.params))
    rules(node, context);
  else if (node.name.toLowerCase() === "font-face")
    node.walkDecls((decl) => declaration(decl, context, true));
  else {
    node.remove();
    context.warn();
  }
}

function rules(container: Container, context: CssContext): void {
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type === "rule") sanitizeRule(node, context);
    else if (node.type === "atrule") sanitizeAtRule(node, context);
    else {
      node.remove();
      context.warn();
    }
  }
}

export function sanitizeElementCss(
  css: string,
  scope: string,
  ids: ReadonlyMap<string, string>,
  warn: () => void,
  fonts: ReadonlyMap<string, string>,
  attributes: readonly ClipboardAttributeRewrite[] = [],
): string {
  try {
    const root = postcss.parse(css);
    rules(root, { scope, ids, warn, fonts, attributes });
    return root.toString().replace(/</g, "");
  } catch {
    warn();
    return "";
  }
}

export function sanitizeElementStyle(
  style: string,
  ids: ReadonlyMap<string, string>,
  warn: () => void,
  fonts: ReadonlyMap<string, string>,
): string {
  try {
    const root = postcss.parse(`a{${style}}`);
    if (
      root.nodes.length !== 1 ||
      root.first?.type !== "rule" ||
      root.first.nodes.some((node) => node.type !== "decl" && node.type !== "comment")
    ) {
      warn();
      return "";
    }
    root.walkDecls((decl) => declaration(decl, { scope: "", ids, warn, fonts }));
    return root.first.nodes.map((node) => node.toString()).join(";");
  } catch {
    warn();
    return "";
  }
}

function fontKey(value: string): string {
  return canonical(value)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .toLowerCase();
}

export function elementFontNames(css: string, scope: string): ReadonlyMap<string, string> {
  const fonts = new Map<string, string>();
  try {
    postcss.parse(css).walkAtRules((rule) => {
      if (rule.name.toLowerCase() !== "font-face") return;
      rule.walkDecls((decl) => {
        if (canonical(decl.prop).toLowerCase() !== "font-family") return;
        const key = fontKey(decl.value);
        if (!fonts.has(key)) fonts.set(key, `"${scope}-font-${fonts.size}"`);
      });
    });
  } catch {
    /* The stylesheet sanitizer reports parse failures. */
  }
  return fonts;
}

export function renameElementFonts(value: string, fonts: ReadonlyMap<string, string>): string {
  return postcss.list
    .comma(value)
    .map((family) => fonts.get(fontKey(family)) ?? family)
    .join(", ");
}

function renameFontShorthand(value: string, fonts: ReadonlyMap<string, string>): string {
  const style = document.createElement("span").style;
  style.font = value;
  if (!style.fontFamily) return value;
  style.fontFamily = renameElementFonts(style.fontFamily, fonts);
  return style.font;
}
