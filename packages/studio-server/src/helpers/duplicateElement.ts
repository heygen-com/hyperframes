import { sameInstant } from "@hyperframes/core/clip-facts";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import {
  findTargetElement,
  dedupeClonedCompositionId,
  isHTMLElement,
  nextUniqueId,
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
  fallbackDuration = 0,
): DuplicateElementResult {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const element = findTargetElement(document, target);
  if (!element || !element.parentElement) return { html: source, matched: false, newId: null };
  const duration = element.hasAttribute("data-duration")
    ? numericAttribute(element, "data-duration")
    : fallbackDuration;
  const start = numericAttribute(element, "data-start");
  const track = numericAttribute(element, "data-track-index") ?? 0;
  if (duration === null || start === null) {
    return { html: source, matched: false, newId: null };
  }
  const uniqueId = nextUniqueId(document, newId);
  rippleElements(document, element, at, duration, track);
  const clone = element.cloneNode(true);
  if (!isHTMLElement(clone)) return { html: source, matched: false, newId: null };
  clone.setAttribute("id", uniqueId);
  dedupeClonedCompositionId(document, clone);
  stripStableIds(clone);
  moveElementStart(clone, start, at);
  element.parentElement.insertBefore(clone, element.nextSibling);
  const html = wrappedFragment ? document.body.innerHTML || "" : document.toString();
  return { html: ensureHfIds(html), matched: true, newId: uniqueId };
}

function rippleElements(
  document: Document,
  element: Element,
  at: number,
  duration: number,
  track: number,
): void {
  for (const candidate of Array.from(document.querySelectorAll("[data-start]"))) {
    if (candidate === element || candidate.getAttribute("data-track-index") !== String(track)) {
      continue;
    }
    const start = numericAttribute(candidate, "data-start");
    if (start === null) continue;
    const metInsertionPoint = sameInstant(start, at);
    if (start < at && !metInsertionPoint) continue;
    moveElementStart(candidate, start, (metInsertionPoint ? at : start) + duration);
  }
}

function moveElementStart(element: Element, start: number, nextStart: number): void {
  element.setAttribute("data-start", String(nextStart));
  if (!element.hasAttribute("data-end")) return;
  const end = numericAttribute(element, "data-end");
  if (end !== null) element.setAttribute("data-end", String(end + (nextStart - start)));
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
