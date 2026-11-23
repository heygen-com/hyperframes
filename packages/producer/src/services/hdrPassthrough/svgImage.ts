/**
 * HDR passthrough: whether an SVG image document is static, read as XML.
 *
 * An SVG shown as an image runs no script and loads nothing, but it still
 * animates on the browser's own clock: SMIL animation elements and CSS
 * animations or transitions in its stylesheets. Capture would freeze such an
 * image on its first frame. A scan of the raw bytes for animation names is
 * not enough: a namespace prefix (`<s:animate>` with `xmlns:s` bound to the
 * SVG namespace) and XML character references (`anim&#97;tion`, `&#64;keyframes`
 * inside `<style>`) both reach the browser as the names a scan looks for only
 * after XML parsing.
 *
 * So the document is parsed the way the browser's XML parser reads it, with
 * namespaces resolved and character references decoded, and checked against
 * an allowlist. Anything the parser here does not read exactly declines: a
 * DOCTYPE (an internal subset can define entities), an entity reference other
 * than the five predefined ones, a processing instruction other than the XML
 * declaration, a name or attribute it cannot parse, mismatched tags, an
 * unbound prefix. Then:
 *
 * - every element in the SVG namespace is a static one (`STATIC_SVG_ELEMENTS`,
 *   by exact local name: no animation element, `<discard>`, `<image>`,
 *   `<feImage>`, `<foreignObject>`, `<script>` or anything unlisted), and an
 *   element in any other namespace sits inside `<metadata>`, which renders
 *   nothing;
 * - `<style>` text and `style` attributes, decoded, have no animation,
 *   transition or keyframes, no CSS escape (`\\`), no `@import`, no `data:` and
 *   no `url()` other than a fragment;
 * - no attribute holds `data:`, a `url()` other than a fragment, an `href`
 *   other than a fragment, or an event handler.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** SVG elements that paint only what their attributes and the stylesheet say. Exact local names. */
const STATIC_SVG_ELEMENTS: ReadonlySet<string> = new Set(
  (
    "svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath " +
    "linearGradient radialGradient stop clipPath mask pattern filter title desc metadata marker " +
    "style switch view a feBlend feColorMatrix feComponentTransfer feComposite " +
    "feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood " +
    "feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset " +
    "fePointLight feSpecularLighting feSpotLight feTile feTurbulence"
  ).split(/\s+/),
);

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

const UNREADABLE = "an SVG the passthrough cannot read";

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const SPACE = /[ \t\r\n]*/y;

/** Thrown inside the parser for anything it does not read exactly; the message is the verdict. */
class NotStatic extends Error {}

function decline(detail: string): never {
  throw new NotStatic(detail);
}

/** Decode character and predefined entity references; anything else declines. */
function decodeReferences(raw: string): string {
  return raw.replace(/&([^;&]*);?/g, (match, body: string) => {
    if (!match.endsWith(";")) decline("an SVG with a bare &");
    const named = PREDEFINED_ENTITIES[body];
    if (named !== undefined) return named;
    const code = /^#x([0-9a-fA-F]{1,6})$/.test(body)
      ? Number.parseInt(body.slice(2), 16)
      : /^#([0-9]{1,7})$/.test(body)
        ? Number.parseInt(body.slice(1), 10)
        : undefined;
    if (code === undefined || code > 0x10ffff || code === 0) {
      decline(`an SVG with an entity reference (&${body};)`);
    }
    return String.fromCodePoint(code);
  });
}

/** What in decoded CSS from an SVG image declines, or null. */
function cssVerdict(css: string): string | null {
  if (css.includes("\\")) return "an SVG whose CSS has an escape";
  if (/animation|transition|keyframes/i.test(css)) return "an SVG whose CSS animates";
  if (/@import/i.test(css)) return "an SVG whose CSS imports";
  if (/data:/i.test(css)) return "an SVG that embeds content";
  if (/url\(\s*["']?(?!#)/i.test(css)) return "an SVG with an external reference";
  return null;
}

/** An `href` (plain or XLink) that points outside the document. */
function isExternalHref(ns: string | null, local: string, value: string): boolean {
  return (ns === null || ns === XLINK_NS) && local === "href" && !value.trimStart().startsWith("#");
}

/** What in one decoded attribute declines, or null. */
function attributeVerdict(ns: string | null, local: string, value: string): string | null {
  if (ns === null && local === "style") return cssVerdict(value);
  if (isExternalHref(ns, local, value)) return "an SVG with an external reference";
  if (ns === null && /^on/i.test(local)) return "an SVG with an event handler";
  if (/data:/i.test(value)) return "an SVG that embeds content";
  if (/url\(\s*["']?(?!#)/i.test(value)) return "an SVG with an external reference";
  return null;
}

interface Scope {
  defaultNs: string | null;
  prefixes: Map<string, string>;
}

interface OpenElement {
  qname: string;
  ns: string | null;
  local: string;
  scope: Scope;
  /** Inside `<metadata>` (this element or an ancestor). */
  inMetadata: boolean;
}

function resolve(scope: Scope, qname: string, isElement: boolean): [string | null, string] {
  const colon = qname.indexOf(":");
  if (colon < 0) return [isElement ? scope.defaultNs : null, qname];
  const prefix = qname.slice(0, colon);
  const ns = prefix === "xml" ? XML_NS : scope.prefixes.get(prefix);
  if (ns === undefined) decline(`an SVG with an unbound prefix (${prefix})`);
  return [ns, qname.slice(colon + 1)];
}

/** The parser's cursor over the document text. */
class Cursor {
  pos = 0;
  constructor(readonly text: string) {}

  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.pos);
  }

  skipSpace(): void {
    SPACE.lastIndex = this.pos;
    SPACE.exec(this.text);
    this.pos = SPACE.lastIndex;
  }

  name(): string {
    NAME.lastIndex = this.pos;
    const match = NAME.exec(this.text);
    if (!match) decline(UNREADABLE);
    this.pos = NAME.lastIndex;
    return match[0];
  }

  /** Text up to `end`, consuming `end`; declines when it never comes. */
  until(end: string): string {
    const at = this.text.indexOf(end, this.pos);
    if (at < 0) decline(UNREADABLE);
    const out = this.text.slice(this.pos, at);
    this.pos = at + end.length;
    return out;
  }
}

interface RawTag {
  qname: string;
  attributes: Array<[string, string]>;
  selfClosing: boolean;
}

/** One `name="value"` at the cursor, the value decoded. */
function readAttribute(cursor: Cursor): [string, string] {
  const name = cursor.name();
  cursor.skipSpace();
  if (!cursor.startsWith("=")) decline(UNREADABLE);
  cursor.pos += 1;
  cursor.skipSpace();
  const quote = cursor.text[cursor.pos];
  if (quote !== '"' && quote !== "'") decline(UNREADABLE);
  cursor.pos += 1;
  const raw = cursor.until(quote);
  if (raw.includes("<")) decline(UNREADABLE);
  return [name, decodeReferences(raw)];
}

function readTag(cursor: Cursor): RawTag {
  cursor.pos += 1; // "<"
  const qname = cursor.name();
  const attributes: Array<[string, string]> = [];
  for (;;) {
    const before = cursor.pos;
    cursor.skipSpace();
    const end = cursor.startsWith("/>") ? 2 : cursor.startsWith(">") ? 1 : 0;
    if (end > 0) {
      cursor.pos += end;
      return { qname, attributes, selfClosing: end === 2 };
    }
    if (cursor.pos === before) decline(UNREADABLE);
    const attribute = readAttribute(cursor);
    if (attributes.some(([name]) => name === attribute[0])) decline(UNREADABLE);
    attributes.push(attribute);
  }
}

const isNamespaceDeclaration = (name: string) => name === "xmlns" || name.startsWith("xmlns:");

/** The namespace scope an element's `xmlns` attributes open inside its parent's. */
function scopeOf(tag: RawTag, parent: OpenElement | undefined): Scope {
  const scope: Scope = {
    defaultNs: parent?.scope.defaultNs ?? null,
    prefixes: new Map(parent?.scope.prefixes),
  };
  for (const [name, value] of tag.attributes) {
    if (name === "xmlns") scope.defaultNs = value === "" ? null : value;
    else if (name.startsWith("xmlns:")) {
      if (value === "") decline(UNREADABLE);
      scope.prefixes.set(name.slice(6), value);
    }
  }
  return scope;
}

/** An element's attributes, namespace declarations aside, against `attributeVerdict`. */
function checkAttributes(tag: RawTag, scope: Scope): void {
  for (const [name, value] of tag.attributes) {
    if (isNamespaceDeclaration(name)) continue;
    const [ns, local] = resolve(scope, name, false);
    const verdict = attributeVerdict(ns, local, value);
    if (verdict) decline(verdict);
  }
}

/** Open one element: its namespace scope, then its own name and attributes against the allowlist. */
function openElement(tag: RawTag, parent: OpenElement | undefined): OpenElement {
  const scope = scopeOf(tag, parent);
  const [ns, local] = resolve(scope, tag.qname, true);
  const isSvg = ns === SVG_NS;
  const inMetadata = parent?.inMetadata === true || (isSvg && local === "metadata");
  if (isSvg && !STATIC_SVG_ELEMENTS.has(local)) decline(`an SVG with a <${local}> element`);
  // Only `<metadata>` holds elements of other namespaces, and it renders nothing.
  if (!isSvg && !inMetadata) decline("an SVG with an element outside the SVG namespace");
  checkAttributes(tag, scope);
  return { qname: tag.qname, ns, local, scope, inMetadata };
}

/** The parser's state between tokens. */
interface Walk {
  cursor: Cursor;
  stack: OpenElement[];
  rootSeen: boolean;
}

/** Text inside `<style>` is CSS. */
function checkStyleText(top: OpenElement | undefined, css: string): void {
  if (top?.ns !== SVG_NS || top.local !== "style") return;
  const verdict = cssVerdict(css);
  if (verdict) decline(verdict);
}

function readText(walk: Walk): void {
  const { cursor } = walk;
  const top = walk.stack.at(-1);
  const at = cursor.text.indexOf("<", cursor.pos);
  const raw = cursor.text.slice(cursor.pos, at < 0 ? cursor.text.length : at);
  cursor.pos += raw.length;
  const decoded = decodeReferences(raw);
  if (!top && decoded.trim() !== "") decline(UNREADABLE);
  checkStyleText(top, decoded);
}

function readEndTag(walk: Walk): void {
  const { cursor } = walk;
  cursor.pos += 2; // "</"
  const qname = cursor.name();
  cursor.skipSpace();
  if (!cursor.startsWith(">") || walk.stack.at(-1)?.qname !== qname) decline(UNREADABLE);
  cursor.pos += 1;
  walk.stack.pop();
}

function readStartTag(walk: Walk): void {
  const top = walk.stack.at(-1);
  if (!top && walk.rootSeen) decline(UNREADABLE);
  const tag = readTag(walk.cursor);
  const element = openElement(tag, top);
  if (!top) {
    if (element.ns !== SVG_NS || element.local !== "svg") {
      decline("an image of a format the passthrough does not read");
    }
    walk.rootSeen = true;
  }
  if (!tag.selfClosing) walk.stack.push(element);
}

/** Markup at the cursor: a comment, CDATA, an end or start tag; a declaration or PI declines. */
function readMarkup(walk: Walk): void {
  const { cursor } = walk;
  if (cursor.startsWith("<!--")) {
    cursor.pos += 4;
    cursor.until("-->");
  } else if (cursor.startsWith("<![CDATA[")) {
    const top = walk.stack.at(-1);
    if (!top) decline(UNREADABLE);
    cursor.pos += 9;
    checkStyleText(top, cursor.until("]]>"));
  } else if (cursor.startsWith("<!")) {
    decline("an SVG with a DOCTYPE or declaration");
  } else if (cursor.startsWith("<?")) {
    decline("an SVG with a processing instruction");
  } else if (cursor.startsWith("</")) {
    readEndTag(walk);
  } else {
    readStartTag(walk);
  }
}

/** Parse the whole document, declining (throwing `NotStatic`) on anything not static. */
function walkDocument(text: string): void {
  const cursor = new Cursor(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const walk: Walk = { cursor, stack: [], rootSeen: false };
  if (cursor.startsWith("<?xml") && /[\s?]/.test(cursor.text[5] ?? "")) cursor.until("?>");
  while (cursor.pos < cursor.text.length) {
    if (cursor.startsWith("<")) readMarkup(walk);
    else readText(walk);
  }
  if (!walk.rootSeen || walk.stack.length > 0) decline(UNREADABLE);
}

/**
 * Why an SVG image document is not known to be static, as a log detail, or
 * null when it is: parsed as XML, every element and its CSS on the allowlist
 * (see the module comment).
 */
export function svgImageVerdict(text: string): string | null {
  try {
    walkDocument(text);
    return null;
  } catch (error) {
    if (error instanceof NotStatic) return error.message;
    throw error;
  }
}
