/**
 * Opaque element handles: the one thing reads mint and writes consume.
 *
 * `TimelineElement.id` cannot do this job. It is a SYNTHESISED identity built
 * from label, index, selector and source file when the clip has no authored id
 * (`timelineElementHelpers.buildTimelineElementIdentity`), so
 * `getElementById(element.id)` misses most elements. The real addressing fields
 * are separate: `hfId` (the `data-hf-id` the codebase calls the stable primary
 * patch target), `domId`, and a `selector` plus occurrence index.
 *
 * Handles are strings so they survive a JSON round trip through the agent
 * untouched. The agent never builds one; it passes back what a read gave it.
 */

import type { TimelineElement } from "../player/store/timelineElement";
import type { PatchTarget } from "../utils/sourcePatcher";

const SEPARATOR = ":";
const INDEX_SEPARATOR = "#";

/**
 * How to find one element. `TimelineElement` calls the DOM id `domId` and
 * `PatchTarget` calls it `id`, so both adapt into this rather than the minter
 * knowing about either.
 */
export interface ElementAddress {
  hfId?: string;
  domId?: string | null;
  selector?: string;
  selectorIndex?: number;
}

/**
 * Address an element the same way Studio's own patcher does, most stable first.
 * `data-hf-id` survives edits that renumber or reorder; a bare selector does not.
 */
export function mintElementHandle(address: ElementAddress): string | null {
  if (address.hfId) return `hf${SEPARATOR}${address.hfId}`;
  if (address.domId) return `dom${SEPARATOR}${address.domId}`;
  if (address.selector) {
    const index = address.selectorIndex ?? 0;
    return `sel${SEPARATOR}${address.selector}${INDEX_SEPARATOR}${index}`;
  }
  return null;
}

export function timelineElementAddress(element: TimelineElement): ElementAddress {
  return {
    hfId: element.hfId,
    domId: element.domId,
    selector: element.selector,
    selectorIndex: element.selectorIndex,
  };
}

export function patchTargetAddress(target: PatchTarget): ElementAddress {
  return {
    hfId: target.hfId,
    domId: target.id,
    selector: target.selector,
    selectorIndex: target.selectorIndex,
  };
}

interface ParsedHandle {
  scheme: "hf" | "dom" | "sel";
  value: string;
  index: number;
}

export function parseElementHandle(handle: string): ParsedHandle | null {
  const separatorAt = handle.indexOf(SEPARATOR);
  if (separatorAt <= 0) return null;
  const scheme = handle.slice(0, separatorAt);
  const rest = handle.slice(separatorAt + 1);
  if (!rest) return null;
  if (scheme === "hf" || scheme === "dom") return { scheme, value: rest, index: 0 };
  if (scheme !== "sel") return null;

  // Only the LAST `#` splits the index off: CSS selectors contain `#` themselves.
  const indexAt = rest.lastIndexOf(INDEX_SEPARATOR);
  if (indexAt <= 0) return { scheme, value: rest, index: 0 };
  const index = Number(rest.slice(indexAt + 1));
  if (!Number.isInteger(index) || index < 0) return { scheme, value: rest, index: 0 };
  return { scheme, value: rest.slice(0, indexAt), index };
}

/**
 * Resolve a handle against the preview document.
 *
 * Always re-resolve per call rather than holding an element across calls: a
 * preview reload replaces the document, and a node from the destroyed one is
 * detached but still looks like an element.
 */
export function resolveElementHandle(doc: Document, handle: string): HTMLElement | null {
  const parsed = parseElementHandle(handle);
  if (!parsed) return null;

  if (parsed.scheme === "dom") return asHtmlElement(doc, doc.getElementById(parsed.value));
  if (parsed.scheme === "hf") {
    return asHtmlElement(doc, doc.querySelector(`[data-hf-id="${cssEscape(parsed.value)}"]`));
  }

  let matches: NodeListOf<Element>;
  try {
    matches = doc.querySelectorAll(parsed.value);
  } catch {
    // A selector minted from a previous document can be invalid in this one.
    return null;
  }
  return asHtmlElement(doc, matches.item(parsed.index));
}

function cssEscape(value: string): string {
  // ponytail: happy-dom and jsdom don't always ship CSS.escape; quoting the two
  // characters that can break out of an attribute selector covers this use.
  return typeof CSS?.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

/**
 * `instanceof HTMLElement` is checked against the OWNING document's realm.
 * The preview lives in an iframe, so Studio's own `HTMLElement` is a different
 * constructor and the naive check fails on every real preview element.
 */
function asHtmlElement(doc: Document, node: Element | null): HTMLElement | null {
  if (!node) return null;
  const ctor = doc.defaultView?.HTMLElement;
  return ctor && node instanceof ctor ? node : null;
}
