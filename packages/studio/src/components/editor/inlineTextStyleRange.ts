/**
 * Styling a run of characters inside an element being edited in place.
 *
 * Not `document.execCommand`. That is deprecated, and what it emits varies by
 * browser between `<font>`, a class, and an inline style depending on
 * `styleWithCSS`. The output of this goes into the user's composition file, so
 * it has to be one predictable shape, and the shape is a `<span>` carrying an
 * inline style.
 *
 * Not DOM range surgery either, which is the obvious way and the wrong one.
 * Wrapping a range in a span is three lines and then every interesting case is
 * a special case: recolouring nests spans that shadow each other, removing a
 * style cannot reach the ancestor that set it, and styling across an existing
 * run's boundary has to split it. Each fix is a new branch and the branches
 * interact.
 *
 * So the element is read into a flat list of styled runs, the styling is
 * applied to a span of characters in that list, and the element is rebuilt
 * from it. Replacing, removing, splitting and merging all stop being cases:
 * the rebuild emits one span per distinct run and cannot nest or duplicate,
 * whatever was there before. Text elements in a composition are a headline or
 * a sentence, so reading and rebuilding one is not a cost worth avoiding.
 */

import { isRichTextFormattingTag } from "@hyperframes/core/rich-text-sanitize";

/** One stretch of characters that are all styled the same way. */
interface StyledRun {
  text: string;
  style: Record<string, string>;
  /**
   * The child element these characters came out of, when they came out of one.
   *
   * Carried because an element's children are not always anonymous formatting:
   * the design panel keeps them as text layers and tracks each by an attribute
   * on it. Rebuilding from style alone emitted fresh, bare spans, which threw
   * that identity away — after colouring a single word the panel could no
   * longer match a layer to its source, so every edit it offered failed to
   * save. The rebuild puts the identity back on the run that still holds it.
   */
  origin: Element | null;
  /**
   * That identity as a value, so two runs can be compared without comparing
   * the nodes they came from. A child with nothing on it but a style has no
   * identity to lose, and merges with its neighbour exactly as before.
   */
  identity: string;
}

export type InlineStyleDelta = Record<string, string | null>;

/**
 * Tags that mean a style. They are read as styling and written back as spans,
 * so there is one representation to reason about instead of two that have to
 * agree. Rendering is unchanged; the markup for an edited element is not.
 */
const TAG_STYLES: Record<string, Record<string, string>> = {
  B: { "font-weight": "700" },
  STRONG: { "font-weight": "700" },
  I: { "font-style": "italic" },
  EM: { "font-style": "italic" },
  U: { "text-decoration-line": "underline" },
};

/**
 * Stands in for a `<br>` while the element is a flat string, so a break counts
 * as one character and offsets survive the rebuild.
 *
 * Not a newline. Compositions are written across lines, so an element's text
 * routinely contains real newlines that are only source formatting, and using
 * one as the marker turned every one of them into a visible line break the
 * first time a word was styled. A NUL never appears: the HTML parser replaces
 * it with U+FFFD, so no document can contain one.
 */
const BREAK = "\u0000";

/** Apply `style` to the characters the range covers, then rebuild the element. */
export function applyInlineStyle(range: Range, style: InlineStyleDelta): void {
  if (range.collapsed) return;
  // Resolved from where the selection starts, not from where it and its end
  // happen to meet. A selection dragged past the element's edge meets its end
  // at an ancestor, and taking that as the host would rebuild the ancestor:
  // every sibling element inside it flattened into text by an edit that was
  // meant to colour a word.
  const host = editingHost(range.startContainer);
  if (!host || !holdsBothEnds(host, range)) return;

  const runs = readRuns(host);
  const span = codePointBounds(
    runs,
    offsetOf(host, range.startContainer, range.startOffset),
    offsetOf(host, range.endContainer, range.endOffset),
  );
  if (!span) return;

  render(host, restyle(runs, span.start, span.end, style));
  selectRange(host, span.start, span.end);
}

/**
 * The offsets to style, widened so they never fall inside a character.
 *
 * A selection offset counts UTF-16 units and an emoji is two of them, so a
 * boundary can land between the halves of one. Styling from there puts half the
 * character in one span and half in the next, and both render as a question
 * mark in a box.
 */
function codePointBounds(
  runs: StyledRun[],
  start: number | null,
  end: number | null,
): { start: number; end: number } | null {
  if (start === null || end === null || start >= end) return null;
  const text = runs.map((run) => run.text).join("");
  return {
    start: isTrailingHalf(text, start) ? start - 1 : start,
    end: isTrailingHalf(text, end) ? end + 1 : end,
  };
}

/** Whether the whole selection lives inside this element. */
function holdsBothEnds(host: Element, range: Range): boolean {
  return host.contains(range.startContainer) && host.contains(range.endContainer);
}

/** Whether this offset sits on the second half of a character, mid-pair. */
function isTrailingHalf(text: string, offset: number): boolean {
  const code = text.charCodeAt(offset);
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * What the range is styled with, for a toolbar that has to open showing the
 * truth rather than a default. Reports a property only when the whole range
 * agrees about it, which is what a control can honestly display.
 */
export function readInlineStyle(range: Range, properties: string[]): Record<string, string> {
  const host = editingHost(range.startContainer);
  if (!host || !holdsBothEnds(host, range)) return {};
  const start = offsetOf(host, range.startContainer, range.startOffset);
  const end = offsetOf(host, range.endContainer, range.endOffset);
  if (start === null || end === null) return {};

  const covered = charRuns(readRuns(host))
    .slice(start, Math.max(end, start + 1))
    .map((entry) => entry.style);
  if (covered.length === 0) return {};

  const styles: Record<string, string> = {};
  for (const property of properties) {
    const first = covered[0]?.[property];
    if (first === undefined) continue;
    if (covered.every((style) => style[property] === first)) styles[property] = first;
  }
  return styles;
}

/**
 * The element the caret is in: the one made editable, never a span inside it.
 *
 * Reading the nearest element instead would rebuild only the run the caret
 * happened to land in, which is how a recolour ends up nested inside the
 * colour it was meant to replace.
 */
function editingHost(node: Node): HTMLElement | null {
  let element = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
  const editable = element?.closest<HTMLElement>("[contenteditable]");
  if (editable) return editable;
  // No open edit, so climb out of the formatting to the element that owns it.
  while (element?.parentElement && isRichTextFormattingTag(element.tagName)) {
    element = element.parentElement;
  }
  return element;
}

/** Read the element as a flat list of runs, in document order. */
function readRuns(host: Element): StyledRun[] {
  const runs: StyledRun[] = [];
  // Text sitting directly in the host belongs to no child, so it has no origin.
  walk(host, {}, runs, null);
  return runs;
}

function walk(
  node: Node,
  inherited: Record<string, string>,
  runs: StyledRun[],
  origin: Element | null,
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text) runs.push({ text, style: inherited, origin, identity: identityOf(origin) });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as HTMLElement;
    if (element.tagName === "BR") {
      runs.push({ text: BREAK, style: inherited, origin, identity: identityOf(origin) });
      continue;
    }
    // The outermost child is the one the panel knows as a layer, so nesting
    // below it keeps pointing at it rather than at its inner formatting.
    walk(
      element,
      { ...inherited, ...TAG_STYLES[element.tagName], ...ownStyle(element) },
      runs,
      origin ?? element,
    );
  }
}

/** A child's identity as a comparable string, empty when it has none. */
function identityOf(element: Element | null): string {
  if (!element) return "";
  return [...preservedAttributes(element)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function ownStyle(element: HTMLElement): Record<string, string> {
  const style: Record<string, string> = {};
  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index);
    if (property) style[property] = element.style.getPropertyValue(property);
  }
  return style;
}

/** One entry per character, which is the easiest thing to slice and compare. */
function charRuns(runs: StyledRun[]): Array<Omit<StyledRun, "text">> {
  const perChar: Array<Omit<StyledRun, "text">> = [];
  for (const run of runs) {
    for (let index = 0; index < run.text.length; index += 1) {
      perChar.push({ style: run.style, origin: run.origin, identity: run.identity });
    }
  }
  return perChar;
}

/** Apply the delta to `[start, end)` and hand back runs covering the element. */
function restyle(
  runs: StyledRun[],
  start: number,
  end: number,
  delta: InlineStyleDelta,
): StyledRun[] {
  const text = runs.map((run) => run.text).join("");
  const perChar = charRuns(runs);
  const next: StyledRun[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const inside = index >= start && index < end;
    const previous = perChar[index]?.style ?? {};
    const style = inside ? withDelta(previous, delta) : previous;
    const origin = perChar[index]?.origin ?? null;
    const identity = perChar[index]?.identity ?? "";
    const last = next[next.length - 1];
    // Merged as it is built, so equal neighbours never become two spans. Two
    // that the design panel tracks as separate layers stay apart even when
    // they now look identical, because merging them deletes one of them.
    if (last && last.identity === identity && sameStyle(last.style, style))
      last.text += text[index];
    else next.push({ text: text[index] ?? "", style, origin, identity });
  }
  return next;
}

function withDelta(style: Record<string, string>, delta: InlineStyleDelta): Record<string, string> {
  const next = { ...style };
  for (const [property, value] of Object.entries(delta)) {
    if (value === null) delete next[property];
    else next[property] = value;
  }
  return next;
}

function sameStyle(a: Record<string, string>, b: Record<string, string>): boolean {
  return styleKey(a) === styleKey(b);
}

/** Sorted, so two runs styled the same way compare equal whatever the order. */
function styleKey(style: Record<string, string>): string {
  return Object.keys(style)
    .sort()
    .map((property) => `${property}: ${style[property]}`)
    .join("; ");
}

/** Rebuild the element: bare text where there is no styling, one span where there is. */
function render(host: Element, runs: StyledRun[]): void {
  const doc = host.ownerDocument;
  const nodes = runNodes(doc, runs);
  host.replaceChildren();
  if (nodes.length > 1 && laysOutItsChildren(host)) {
    // Wrapped, because in a flex or grid container every child is an item to
    // be laid out. Text that was one anonymous item becomes several boxes the
    // moment a word inside it is coloured, and the element visibly reflows:
    // centring, wrapping and order all change under an edit that was only ever
    // meant to change a colour. One wrapper keeps it a single item, and the
    // runs inside it stay inline text.
    const wrapper = doc.createElement("span");
    wrapper.append(...nodes);
    host.append(wrapper);
    return;
  }
  host.append(...nodes);
}

function runNodes(doc: Document, runs: StyledRun[]): Node[] {
  const nodes: Node[] = [];
  // One span per origin keeps its attributes: an identity that appeared twice
  // would be two layers claiming to be the same one. A run split off from an
  // origin is a new layer and is written as one.
  const claimed = new Set<Element>();
  for (const run of runs) {
    const key = styleKey(run.style);
    const carried =
      run.origin && !claimed.has(run.origin) ? preservedAttributes(run.origin) : new Map();
    if (carried.size > 0 && run.origin) claimed.add(run.origin);
    for (const [index, piece] of run.text.split(BREAK).entries()) {
      if (index > 0) nodes.push(doc.createElement("br"));
      if (!piece) continue;
      if (!key && carried.size === 0) {
        nodes.push(doc.createTextNode(piece));
        continue;
      }
      const span = doc.createElement("span");
      for (const [name, value] of carried) span.setAttribute(name, value);
      if (key) span.setAttribute("style", key);
      span.textContent = piece;
      nodes.push(span);
      carried.clear();
    }
  }
  return nodes;
}

/**
 * What a child carries besides its styling: the identity the design panel
 * tracks it by. Its style is not copied — that is what the run holds, already
 * merged with whatever the edit changed.
 */
function preservedAttributes(element: Element): Map<string, string> {
  const kept = new Map<string, string>();
  for (const name of element.getAttributeNames()) {
    if (name === "style") continue;
    kept.set(name, element.getAttribute(name) ?? "");
  }
  return kept;
}

/** Displays whose children are boxes it positions, rather than text it flows. */
const LAYS_OUT_CHILDREN = new Set([
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  // How line clamping is written, and it boxes its children like flex.
  "-webkit-box",
  "-webkit-inline-box",
]);

function laysOutItsChildren(host: Element): boolean {
  const view = host.ownerDocument.defaultView;
  if (!view) return false;
  return LAYS_OUT_CHILDREN.has(view.getComputedStyle(host).display);
}

/** Where a DOM position falls, counted in characters from the element's start. */
function offsetOf(host: Element, container: Node, containerOffset: number): number | null {
  let count = 0;
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT | 1);
  if (container === host) {
    // A position between children, expressed as a child index.
    for (const child of Array.from(host.childNodes).slice(0, containerOffset)) {
      count += (child.textContent ?? "").length || (nodeName(child) === "BR" ? 1 : 0);
    }
    return count;
  }
  let node = walker.nextNode();
  while (node) {
    if (node === container) return count + containerOffset;
    if (node.nodeType === 3) count += (node.textContent ?? "").length;
    else if (nodeName(node) === "BR") count += 1;
    node = walker.nextNode();
  }
  return null;
}

function nodeName(node: Node): string {
  return node.nodeType === 1 ? (node as Element).tagName : "";
}

/** Put the selection back over the characters that were just styled. */
function selectRange(host: Element, start: number, end: number): void {
  const doc = host.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  const from = positionAt(host, start);
  const to = positionAt(host, end);
  if (!selection || !from || !to) return;
  const range = doc.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The DOM position a character offset lands on, after a rebuild. */
function positionAt(host: Element, offset: number): { node: Node; offset: number } | null {
  let count = 0;
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let last: Node | null = null;
  while (node) {
    const length = (node.textContent ?? "").length;
    if (count + length >= offset) return { node, offset: offset - count };
    count += length;
    last = node;
    node = walker.nextNode();
  }
  if (last) return { node: last, offset: (last.textContent ?? "").length };
  return { node: host, offset: 0 };
}
