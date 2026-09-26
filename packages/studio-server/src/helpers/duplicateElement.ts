import { sameInstant } from "@hyperframes/core/clip-facts";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import {
  findTargetElement,
  dedupeClonedCompositionId,
  isHTMLElement,
  parseSourceDocument,
  type SourceMutationTarget,
} from "./sourceMutation.js";

export interface DuplicateElementResult {
  html: string;
  matched: boolean;
  newId: string | null;
}

export function duplicateElementInHtml(
  source: string,
  target: SourceMutationTarget,
  newId: string,
  at: number,
): DuplicateElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const element = findTargetElement(document, target);
  if (!element || !element.parentElement) return { html: source, matched: false, newId: null };
  const duration = numericAttribute(element, "data-duration");
  const track = numericAttribute(element, "data-track-index") ?? 0;
  if (duration === null || numericAttribute(element, "data-start") === null) {
    return { html: source, matched: false, newId: null };
  }
  const uniqueId = nextUniqueId(document, newId);
  rippleElements(document, element, at, duration, track);
  const clone = element.cloneNode(true);
  if (!isHTMLElement(clone)) return { html: source, matched: false, newId: null };
  clone.setAttribute("id", uniqueId);
  dedupeClonedCompositionId(document, clone);
  stripStableIds(clone);
  clone.setAttribute("data-start", String(at));
  element.parentElement.insertBefore(clone, element.nextSibling);
  const html = wrappedFragment ? document.body.innerHTML || "" : document.toString();
  return { html: ensureHfIds(html), matched: true, newId: uniqueId };
}

function nextUniqueId(document: Document, newId: string): string {
  let uniqueId = newId;
  let suffix = 2;
  while (document.getElementById(uniqueId)) uniqueId = `${newId}-${suffix++}`;
  return uniqueId;
}

function rippleElements(
  document: Document,
  element: Element,
  at: number,
  duration: number,
  track: number,
): void {
  for (const candidate of Array.from(document.querySelectorAll("[data-start][data-duration]"))) {
    if (candidate === element || candidate.getAttribute("data-track-index") !== String(track)) {
      continue;
    }
    const start = numericAttribute(candidate, "data-start");
    if (start === null) continue;
    const metInsertionPoint = sameInstant(start, at);
    if (start < at && !metInsertionPoint) continue;
    candidate.setAttribute("data-start", String((metInsertionPoint ? at : start) + duration));
  }
}

function stripStableIds(element: Element): void {
  element.removeAttribute("data-hf-id");
  for (const child of Array.from(element.querySelectorAll("[data-hf-id]"))) {
    child.removeAttribute("data-hf-id");
  }
}

function numericAttribute(element: Element, name: string): number | null {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : null;
}
