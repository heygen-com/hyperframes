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

/** A line break counts as one character, so offsets survive a rebuild. */
const BREAK = "\n";

/** Apply `style` to the characters the range covers, then rebuild the element. */
export function applyInlineStyle(range: Range, style: InlineStyleDelta): void {
  if (range.collapsed) return;
  const host = editingHost(range.commonAncestorContainer);
  if (!host) return;

  const start = offsetOf(host, range.startContainer, range.startOffset);
  const end = offsetOf(host, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return;

  const runs = restyle(readRuns(host), start, end, style);
  render(host, runs);
  selectRange(host, start, end);
}

/**
 * What the range is styled with, for a toolbar that has to open showing the
 * truth rather than a default. Reports a property only when the whole range
 * agrees about it, which is what a control can honestly display.
 */
export function readInlineStyle(range: Range, properties: string[]): Record<string, string> {
  const host = editingHost(range.commonAncestorContainer);
  if (!host) return {};
  const start = offsetOf(host, range.startContainer, range.startOffset);
  const end = offsetOf(host, range.endContainer, range.endOffset);
  if (start === null || end === null) return {};

  const covered = charStyles(readRuns(host)).slice(start, Math.max(end, start + 1));
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
  walk(host, {}, runs);
  return runs;
}

function walk(node: Node, inherited: Record<string, string>, runs: StyledRun[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (text) runs.push({ text, style: inherited });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as HTMLElement;
    if (element.tagName === "BR") {
      runs.push({ text: BREAK, style: inherited });
      continue;
    }
    walk(element, { ...inherited, ...TAG_STYLES[element.tagName], ...ownStyle(element) }, runs);
  }
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
function charStyles(runs: StyledRun[]): Array<Record<string, string>> {
  const styles: Array<Record<string, string>> = [];
  for (const run of runs) {
    for (let index = 0; index < run.text.length; index += 1) styles.push(run.style);
  }
  return styles;
}

/** Apply the delta to `[start, end)` and hand back runs covering the element. */
function restyle(
  runs: StyledRun[],
  start: number,
  end: number,
  delta: InlineStyleDelta,
): StyledRun[] {
  const text = runs.map((run) => run.text).join("");
  const styles = charStyles(runs);
  const next: StyledRun[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const inside = index >= start && index < end;
    const style = inside ? withDelta(styles[index] ?? {}, delta) : (styles[index] ?? {});
    const last = next[next.length - 1];
    // Merged as it is built, so equal neighbours never become two spans.
    if (last && sameStyle(last.style, style)) last.text += text[index];
    else next.push({ text: text[index] ?? "", style });
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
  host.replaceChildren();
  for (const run of runs) {
    const key = styleKey(run.style);
    for (const [index, piece] of run.text.split(BREAK).entries()) {
      if (index > 0) host.append(doc.createElement("br"));
      if (!piece) continue;
      if (!key) {
        host.append(doc.createTextNode(piece));
        continue;
      }
      const span = doc.createElement("span");
      span.setAttribute("style", key);
      span.textContent = piece;
      host.append(span);
    }
  }
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
