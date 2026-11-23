/**
 * HDR passthrough: whether an SVG image document is static, read as XML.
 *
 * An SVG shown as an image runs no script and loads nothing, but it still
 * animates on the browser's own clock: SMIL animation elements and CSS
 * animations or transitions in its stylesheets. Capture would freeze such an
 * image on its first frame. Telling a static stylesheet from an animating one
 * means reading CSS the way the browser does, and every reader short of the
 * browser's own misses a spelling: a namespace prefix (`<s:animate>`), XML
 * character references (`anim&#97;tion`), a comment or CDATA section that
 * splits a name the browser joins back (`anim<!---->ation`), a `<style>` in
 * the XHTML namespace that the browser applies.
 *
 * So only plain static SVG passes: shapes, paths, gradients, patterns, clips,
 * masks, markers and text, styled by presentation attributes. The document is
 * parsed as XML, with namespaces resolved and character references decoded,
 * and anything else declines:
 *
 * - any element not in `STATIC_SVG_ELEMENTS` (by exact local name, in the SVG
 *   namespace), in any namespace and anywhere, `<metadata>` included: every
 *   `<style>`, animation element, `<discard>`, `<image>`, `<foreignObject>`,
 *   `<script>`, filter, link and anything unlisted;
 * - any attribute not in `STATIC_SVG_ATTRIBUTES` (presentation and geometry
 *   attributes, no namespace), other than `xml:space`, `xml:lang`, namespace
 *   declarations and a fragment `href` / `xlink:href`: every `style`
 *   attribute and event handler;
 * - any attribute value with `data:`, a CSS escape, or a `url()` other than a
 *   fragment;
 * - any comment, CDATA section, DOCTYPE, entity reference other than the five
 *   predefined ones, processing instruction other than the XML declaration,
 *   name or attribute the parser cannot read, mismatched tag or unbound
 *   prefix.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const words = (text: string): ReadonlySet<string> => new Set(text.trim().split(/\s+/));

/** SVG elements that paint only what their attributes say. Exact local names, SVG namespace. */
const STATIC_SVG_ELEMENTS = words(`
  svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath
  linearGradient radialGradient stop clipPath mask pattern marker title desc metadata
`);

/** Attributes without a namespace that set geometry or a static presentation property. */
const STATIC_SVG_ATTRIBUTES = words(`
  id class version baseProfile width height viewBox preserveAspectRatio x y transform
  cx cy r rx ry x1 y1 x2 y2 points d pathLength
  gradientUnits gradientTransform spreadMethod fx fy fr offset
  patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits
  markerWidth markerHeight markerUnits refX refY orient
  dx dy rotate textLength lengthAdjust startOffset method spacing side
  fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap
  stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color
  stop-color stop-opacity font-family font-size font-weight font-style font-variant
  font-stretch text-anchor dominant-baseline alignment-baseline baseline-shift
  letter-spacing word-spacing text-decoration writing-mode direction unicode-bidi
  clip-path clip-rule mask display visibility overflow paint-order shape-rendering
  text-rendering vector-effect color-interpolation
`);

/** Attributes in the XML namespace that change nothing the image paints over time. */
const STATIC_XML_ATTRIBUTES = words("space lang");

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

/** An `href` (plain or XLink) that points inside the document. */
function isFragmentHref(value: string): boolean {
  return value.trimStart().startsWith("#");
}

/** Whether an attribute's name is off the static allowlists, as a verdict, or null. */
function attributeNameVerdict(ns: string | null, local: string, value: string): string | null {
  if ((ns === null || ns === XLINK_NS) && local === "href") {
    return isFragmentHref(value) ? null : "an SVG with an external reference";
  }
  if (ns === null) {
    return STATIC_SVG_ATTRIBUTES.has(local) ? null : `an SVG with a ${local} attribute`;
  }
  if (ns === XML_NS && STATIC_XML_ATTRIBUTES.has(local)) return null;
  return `an SVG with an attribute outside the static set (${local})`;
}

/** What in one decoded attribute declines, or null. */
function attributeVerdict(ns: string | null, local: string, value: string): string | null {
  const name = attributeNameVerdict(ns, local, value);
  if (name) return name;
  if (value.includes("\\")) return "an SVG with an escape in an attribute";
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
  if (ns !== SVG_NS) decline("an SVG with an element outside the SVG namespace");
  if (!STATIC_SVG_ELEMENTS.has(local)) decline(`an SVG with a <${local}> element`);
  checkAttributes(tag, scope);
  return { qname: tag.qname, ns, local, scope };
}

/** The parser's state between tokens. */
interface Walk {
  cursor: Cursor;
  stack: OpenElement[];
  rootSeen: boolean;
}

function readText(walk: Walk): void {
  const { cursor } = walk;
  const at = cursor.text.indexOf("<", cursor.pos);
  const raw = cursor.text.slice(cursor.pos, at < 0 ? cursor.text.length : at);
  cursor.pos += raw.length;
  const decoded = decodeReferences(raw);
  if (walk.stack.length === 0 && decoded.trim() !== "") decline(UNREADABLE);
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

/** Markup at the cursor: an end or start tag; a comment, CDATA, declaration or PI declines. */
function readMarkup(walk: Walk): void {
  const { cursor } = walk;
  if (cursor.startsWith("<!--")) {
    decline("an SVG with a comment");
  } else if (cursor.startsWith("<![CDATA[")) {
    decline("an SVG with a CDATA section");
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
 * null when it is: parsed as XML, every element and attribute on the static
 * allowlists (see the module comment).
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
