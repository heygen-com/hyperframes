/**
 * Element handles for the editing channel. The parent never receives an element, only a number this
 * module gives it and the plain data `describeElement` reads from it. Handles live for one page load:
 * the maps are module state, and a removed element's entry is only a dead WeakRef.
 */
import {
  buildStableSelector,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_POINT_STACK,
  MAX_SOURCE_GROUPS,
  readElementSource,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementSource,
} from "./editingElement";

const handles = new WeakMap<Element, EditingElementHandle>();
const elements = new Map<EditingElementHandle, WeakRef<Element>>();
let lastHandle = 0;

function handleFor(element: Element): EditingElementHandle {
  let handle = handles.get(element);
  if (handle === undefined) {
    handle = ++lastHandle;
    handles.set(element, handle);
    elements.set(handle, new WeakRef(element));
  }
  return handle;
}

/** The live element in this document behind `handle`, else null. */
function elementForHandle(handle: EditingElementHandle): Element | null {
  const element = elements.get(handle)?.deref();
  return element?.isConnected && element.ownerDocument === document ? element : null;
}

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

const cut = (text: string | null) => (text ?? "").slice(0, MAX_ELEMENT_TEXT);

function inlineStyles(element: Element): Record<string, string> {
  const styles: Record<string, string> = {};
  const declared = (element as Partial<ElementCSSInlineStyle>).style;
  if (!declared) return styles;
  for (let index = 0; index < Math.min(declared.length, MAX_ELEMENT_ENTRIES); index += 1) {
    const name = declared.item(index);
    styles[name] = declared.getPropertyValue(name);
  }
  return styles;
}

function children(element: Element): EditingElementDescription["children"] {
  const out: EditingElementDescription["children"] = [];
  for (const node of element.childNodes) {
    if (out.length >= MAX_ELEMENT_ENTRIES) break;
    if (node.nodeType === Node.ELEMENT_NODE) out.push({ handle: handleFor(node as Element) });
    else if (node.nodeType === Node.TEXT_NODE) out.push({ text: cut(node.textContent) });
  }
  return out;
}

function describeElement(element: Element): EditingElementDescription {
  const selector = buildStableSelector(element);
  const rect = element.getBoundingClientRect();
  return {
    handle: handleFor(element),
    parent: element.parentElement ? handleFor(element.parentElement) : null,
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    selector: selector ?? null,
    matchesBefore: matchesBefore(element, selector),
    source: readElementSource(element),
    locked: element.closest("[data-timeline-locked]") !== null,
    attributes: Array.from(element.attributes)
      .filter((attribute) => attribute.name !== "style")
      .slice(0, MAX_ELEMENT_ENTRIES)
      .map((attribute) => [attribute.name, attribute.value]),
    inlineStyles: inlineStyles(element),
    text: cut(element.textContent),
    children: children(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

export function describeElementsAtPoint(x: number, y: number): EditingElementDescription[] {
  return document.elementsFromPoint(x, y).slice(0, MAX_POINT_STACK).map(describeElement);
}

export function describeHandles(
  requested: readonly EditingElementHandle[],
): Array<EditingElementDescription | null> {
  return requested.map((handle) => {
    const element = elementForHandle(handle);
    return element ? describeElement(element) : null;
  });
}
