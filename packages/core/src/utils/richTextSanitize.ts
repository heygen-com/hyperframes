/**
 * What inline formatting a composition file is allowed to receive.
 *
 * Editing text in the Studio preview can style a run of characters, which means
 * markup now travels from a contenteditable element into a file on disk. This
 * module is the only thing deciding what may make that trip. The server write
 * boundary applies it unconditionally before returning composition bytes.
 *
 * One module rather than two implementations. Two would drift, and the drift
 * would be a security bug rather than an inconsistency.
 *
 * It works on an element's subtree in place. Untrusted markup must be parsed in
 * an inert document before this function receives it.
 */

/** Tags an inline text edit may contain. Everything else is not text styling. */
const FORMATTING_TAGS = new Set(["SPAN", "B", "STRONG", "I", "EM", "U", "BR"]);

/**
 * Style properties a formatting tag may carry.
 *
 * This was paint-only, on the reasoning that a property which moves or resizes
 * text would let an edit inside one element change the composition's layout,
 * and layout is the design panel's job. The reasoning was wrong about who was
 * being restricted: the design panel writes exactly these typography
 * properties onto exactly these spans, as its text layers. Sanitizing them
 * away did not stop text from changing layout, it deleted the layout the user
 * had already set — colouring one word silently dropped a sibling layer's font
 * size. The line that matters is the one below, values that reach outside the
 * stylesheet, not which of its own properties the editor is allowed to keep.
 */
const FORMATTING_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration-line",
  "font-family",
  "font-size",
  "letter-spacing",
  "line-height",
  // Paints the glyph fill and inherits, so an ancestor that sets it wins over
  // any `color` below. The editor mirrors a run's colour into it when that is
  // happening, and stripping it here would put the colour back to invisible.
  "-webkit-text-fill-color",
]);

// Keep this list limited to properties whose grammar cannot fetch a resource.
// Adding a URL-consuming property also requires decoding CSS escapes before
// UNSAFE_VALUE can be a sufficient guard.

/**
 * Attributes a formatting tag may carry.
 *
 * The identity a text layer is tracked by. Everything else is dropped: a
 * contenteditable is a paste target, and an event handler or an id that
 * shadows a composition's own is not formatting.
 */
const FORMATTING_ATTRS = new Set(["data-hf-text-key", "data-hf-id"]);

/**
 * What those attributes are allowed to look like: a bare token, nothing else.
 * `:` is deliberate because text keys use selector-like tokens such as
 * `child:1`; neither allowed attribute is interpreted as a URL.
 */
const SAFE_ATTR_VALUE = /^[A-Za-z0-9_:-]+$/;

/**
 * Tags dropped whole rather than unwrapped.
 *
 * Everything else is unwrapped, so an unexpected tag costs the user its
 * formatting and not their words. These are the ones whose contents are not
 * words: unwrapping a script would turn its source into visible text.
 */
const OPAQUE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
]);

/** Anything that reaches out of the stylesheet, in a property that should not. */
const UNSAFE_VALUE = /url\(|expression\(|javascript:|vbscript:|@import|<\//i;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

type SanitizerFrame =
  | { phase: "visit"; node: Node }
  | { phase: "sanitize"; element: Element; tag: string };

export function isRichTextFormattingTag(tagName: string): boolean {
  return FORMATTING_TAGS.has(tagName.toUpperCase());
}

/** Whether an attribute survives the rich-text persistence boundary. */
export function isRichTextFormattingAttribute(name: string, value: string): boolean {
  return FORMATTING_ATTRS.has(name.toLowerCase()) && SAFE_ATTR_VALUE.test(value);
}

/** Whether a declaration survives the rich-text persistence boundary. */
export function isRichTextFormattingStyle(property: string, value: string): boolean {
  return (
    FORMATTING_STYLE_PROPS.has(property.toLowerCase()) &&
    value.length > 0 &&
    !UNSAFE_VALUE.test(value)
  );
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

/**
 * Strip everything but allowed formatting from an element's contents, in place.
 *
 * The element itself is never touched, only what is inside it. Callers own the
 * element, and it is the composition's, not the editor's, to rewrite.
 *
 * When the children came from untrusted markup, callers must parse that markup
 * into an inert document (for example linkedom or a detached DOMParser document)
 * first. Never assign untrusted HTML to a live DOM element and then call this
 * function: active content can run before sanitization begins.
 */
export function sanitizeRichTextChildren(parent: Element): void {
  const pending: SanitizerFrame[] = Array.from(
    parent.childNodes,
    (node): SanitizerFrame => ({ phase: "visit", node }),
  ).reverse();

  // Post-order without recursion: adversarially deep pasted markup must not
  // exhaust either the server or browser call stack.
  for (let frame = pending.pop(); frame; frame = pending.pop()) {
    if (frame.phase === "sanitize") {
      if (!FORMATTING_TAGS.has(frame.tag)) unwrap(frame.element);
      else stripAttributes(frame.element);
      continue;
    }

    const child = frame.node;
    if (child.nodeType === TEXT_NODE) continue;

    if (!isElementNode(child)) {
      // Comments and processing instructions are neither words nor formatting.
      child.parentNode?.removeChild(child);
      continue;
    }

    const element = child;
    const tag = element.tagName.toUpperCase();

    if (OPAQUE_TAGS.has(tag)) {
      element.parentNode?.removeChild(element);
      continue;
    }

    pending.push({ phase: "sanitize", element, tag });
    for (const descendant of Array.from(element.childNodes).reverse()) {
      pending.push({ phase: "visit", node: descendant });
    }
  }
}

/** Replace an element with its own children, keeping their order and place. */
function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/** Leave a kept tag with a filtered style attribute and its identity, no more. */
function stripAttributes(element: Element): void {
  const style = element.getAttribute("style");
  for (const name of Array.from(element.getAttributeNames())) {
    const value = element.getAttribute(name) ?? "";
    if (isRichTextFormattingAttribute(name, value)) continue;
    element.removeAttribute(name);
  }
  if (style === null) return;
  const safe = filterStyle(style);
  if (safe) element.setAttribute("style", safe);
  else element.removeAttribute("style");
}

/** Keep only the allowlisted declarations, and only if their values are inert. */
function filterStyle(style: string): string {
  return splitDeclarations(style)
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return null;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!isRichTextFormattingStyle(property, value)) return null;
      return `${property}: ${value}`;
    })
    .filter((declaration): declaration is string => declaration !== null)
    .join("; ");
}

function isQuoteDelimiter(char: string): char is "'" | '"' {
  return char === "'" || char === '"';
}

function nextParenthesisDepth(depth: number, char: string): number {
  if (char === "(") return depth + 1;
  if (char === ")") return Math.max(0, depth - 1);
  return depth;
}

function isDeclarationSeparator(char: string, depth: number, quote: "'" | '"' | null): boolean {
  return char === ";" && depth === 0 && quote === null;
}

/**
 * Split on the semicolons that separate declarations, not the ones inside a
 * value. `color: rgb(1, 2, 3)` is one declaration however many separators its
 * value contains.
 */
function splitDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (const char of style) {
    if (char === quote) quote = null;
    else if (quote === null && isQuoteDelimiter(char)) quote = char;
    else if (isDeclarationSeparator(char, depth, quote)) {
      declarations.push(current);
      current = "";
      continue;
    } else if (quote === null) {
      depth = nextParenthesisDepth(depth, char);
    }
    current += char;
  }
  if (current.trim()) declarations.push(current);
  return declarations;
}
