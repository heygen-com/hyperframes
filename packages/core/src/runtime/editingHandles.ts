/**
 * Element handles for the editing channel. The parent never receives an element, only a handle this
 * module gives it and the plain data `describeElement` reads from it. Handles live for one page load:
 * the maps are module state, and an entry goes once its element is garbage-collected.
 */
import {
  buildStableSelector,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_POINT_STACK,
  MAX_SOURCE_GROUPS,
  readElementSource,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementHit,
  type EditingElementSource,
} from "./editingElement";

// Drawn on first use, not at load: a render seeds getRandomValues, and a draw here would shift the
// composition's own random values.
let load = "";
const loadId = () =>
  (load ||= Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(""));
const numbers = new WeakMap<Element, number>();
const elements = new Map<number, WeakRef<Element>>();
const collected = new FinalizationRegistry<number>((n) => {
  if (!elements.get(n)?.deref()) elements.delete(n);
});
let lastNumber = 0;

function handleFor(element: Element): EditingElementHandle {
  let n = numbers.get(element);
  if (n === undefined) {
    n = ++lastNumber;
    numbers.set(element, n);
    collected.register(element, n);
  }
  if (!elements.has(n)) elements.set(n, new WeakRef(element));
  return `${loadId()}:${n}`;
}

/** The live element in this document behind `handle`, else null. */
function elementForHandle(handle: EditingElementHandle): Element | null {
  const [handleLoad, count] = handle.split(":");
  if (handleLoad !== loadId()) return null;
  const n = Number(count);
  const element = elements.get(n)?.deref();
  if (!element) elements.delete(n);
  // A parked scene's nodes come back, so a disconnected element keeps its entry.
  return element?.isConnected && element.ownerDocument === document ? element : null;
}

/** How many elements hold a live entry; for tests of the bound. */
export const trackedHandleCount = () => elements.size;

const sameSource = (a: EditingElementSource, b: EditingElementSource) =>
  a.file === b.file &&
  a.compositionId === b.compositionId &&
  a.originalCompositionId === b.originalCompositionId;

function matchesBefore(element: Element, selector: string | undefined) {
  if (!selector?.startsWith(".")) return null;
  const groups: Array<{ source: EditingElementSource; count: number }> = [];
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return null;
  }
  for (const match of matches) {
    if (match === element) return groups;
    const source = readElementSource(match);
    const group = groups.find((entry) => sameSource(entry.source, source));
    if (group) group.count += 1;
    else if (groups.push({ source, count: 1 }) > MAX_SOURCE_GROUPS) return null;
  }
  return null;
}

const NO_TEXT = new Set(["script", "style"]);

type Cut = { truncated: boolean };

/** A `dataUrl` value starting `data:` keeps only its header; text is cut by length alone. */
function cut(value: string, limit: number, state: Cut, dataUrl = false): string {
  const header = dataUrl && value.startsWith("data:") ? value.slice(0, value.indexOf(",") + 1) : "";
  const kept = header || value.slice(0, limit);
  if (kept.length < value.length) state.truncated = true;
  return kept.slice(0, limit);
}

function renderedText(element: Element, state: Cut): string {
  if (NO_TEXT.has(element.localName)) return "";
  let text = "";
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && NO_TEXT.has((node as Element).localName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    text += node.nodeValue;
    if (text.length > MAX_ELEMENT_TEXT) break;
  }
  return cut(text, MAX_ELEMENT_TEXT, state);
}

function inlineStyles(element: Element, state: Cut): Record<string, string> {
  const styles: Record<string, string> = {};
  const declared = (element as Partial<ElementCSSInlineStyle>).style;
  if (!declared) return styles;
  if (declared.length > MAX_ELEMENT_ENTRIES) state.truncated = true;
  for (let index = 0; index < Math.min(declared.length, MAX_ELEMENT_ENTRIES); index += 1) {
    const name = declared.item(index);
    styles[name] = cut(declared.getPropertyValue(name), MAX_ELEMENT_VALUE, state, true);
  }
  return styles;
}

function attributes(element: Element, state: Cut): EditingElementDescription["attributes"] {
  const kept = Array.from(element.attributes).filter((attribute) => attribute.name !== "style");
  if (kept.length > MAX_ELEMENT_ENTRIES) state.truncated = true;
  return kept
    .slice(0, MAX_ELEMENT_ENTRIES)
    .map((attribute) => [attribute.name, cut(attribute.value, MAX_ELEMENT_VALUE, state, true)]);
}

function children(element: Element, state: Cut): EditingElementDescription["children"] {
  const out: EditingElementDescription["children"] = [];
  const textless = NO_TEXT.has(element.localName);
  for (const node of element.childNodes) {
    if (out.length >= MAX_ELEMENT_ENTRIES) {
      state.truncated = true;
      break;
    }
    if (node.nodeType === Node.ELEMENT_NODE) out.push({ handle: handleFor(node as Element) });
    else if (node.nodeType === Node.TEXT_NODE && !textless)
      out.push({ text: cut(node.nodeValue ?? "", MAX_ELEMENT_TEXT, state) });
  }
  return out;
}

function hit(element: Element): EditingElementHit {
  const rect = element.getBoundingClientRect();
  return {
    handle: handleFor(element),
    tag: element.tagName.toLowerCase(),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

function describeElement(element: Element): EditingElementDescription {
  const selector = buildStableSelector(element);
  const state: Cut = { truncated: false };
  return {
    ...hit(element),
    parent: element.parentElement ? handleFor(element.parentElement) : null,
    id: element.id || null,
    selector: selector ?? null,
    matchesBefore: matchesBefore(element, selector),
    source: readElementSource(element),
    locked: element.closest("[data-timeline-locked]") !== null,
    attributes: attributes(element, state),
    inlineStyles: inlineStyles(element, state),
    text: renderedText(element, state),
    children: children(element, state),
    truncated: state.truncated,
  };
}

export function elementsAtPoint(x: number, y: number): EditingElementHit[] {
  return document.elementsFromPoint(x, y).slice(0, MAX_POINT_STACK).map(hit);
}

export function describeHandles(
  requested: readonly EditingElementHandle[],
): Array<EditingElementDescription | null> {
  return requested.map((handle) => {
    const element = elementForHandle(handle);
    return element ? describeElement(element) : null;
  });
}
