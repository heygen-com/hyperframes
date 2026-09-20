import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import type { SourceMutationTarget } from "@hyperframes/studio-server";
import { parseHTML } from "linkedom";

export type SetField = "volume" | "rate" | "track";

export interface SetAssignment {
  field: SetField;
  value: string;
}

export function stampHfIds(source: string): string {
  return ensureHfIds(source);
}

export function parseSetAssignments(values: readonly string[]):
  | { ok: true; assignments: SetAssignment[] }
  | { ok: false; reason: string; fix: string } {
  const assignments: SetAssignment[] = [];
  for (const value of values) {
    const match = /^(volume|rate|track)=(.+)$/.exec(value);
    if (!match) {
      return {
        ok: false,
        reason: `unsupported set assignment ${value}`,
        fix: "use volume=<number>, rate=<number>, or track=<number>",
      };
    }
    const field = match[1] as SetField;
    const number = Number(match[2]);
    if (!Number.isFinite(number) || (field === "track" && !Number.isInteger(number))) {
      return {
        ok: false,
        reason: `${field} must be a valid ${field === "track" ? "integer" : "number"}`,
        fix: `pass ${field}=<number>`,
      };
    }
    if (field === "rate" && number <= 0) {
      return { ok: false, reason: "rate must be positive", fix: "pass rate=<positive number>" };
    }
    assignments.push({ field, value: String(number) });
  }
  return { ok: true, assignments };
}

export function setAttributes(
  source: string,
  target: SourceMutationTarget,
  assignments: readonly SetAssignment[],
): { html: string; matched: boolean } {
  const document = parseHTML(source).document;
  const element = findTarget(document, target);
  if (!element) return { html: source, matched: false };
  for (const assignment of assignments) {
    const attribute =
      assignment.field === "volume"
        ? "data-volume"
        : assignment.field === "rate"
          ? "data-playback-rate"
          : "data-track-index";
    element.setAttribute(attribute, assignment.value);
  }
  return { html: document.toString(), matched: true };
}

export function duplicateElement(
  source: string,
  target: SourceMutationTarget,
  newId: string,
  at: number,
): { html: string; matched: boolean; newId: string | null } {
  const document = parseHTML(source).document;
  const element = findTarget(document, target);
  if (!element || !element.parentElement) return { html: source, matched: false, newId: null };
  const start = numericAttribute(element, "data-start");
  const duration = numericAttribute(element, "data-duration");
  const track = numericAttribute(element, "data-track-index") ?? 0;
  if (start === null || duration === null) return { html: source, matched: false, newId: null };
  let uniqueId = newId;
  let suffix = 2;
  while (document.getElementById(uniqueId)) uniqueId = `${newId}-${suffix++}`;
  for (const candidate of Array.from(document.querySelectorAll("[data-start][data-duration]"))) {
    if (candidate === element || candidate.getAttribute("data-track-index") !== String(track)) continue;
    const candidateStart = numericAttribute(candidate, "data-start");
    if (candidateStart !== null && candidateStart >= at) {
      candidate.setAttribute("data-start", String(candidateStart + duration));
    }
  }
  const clone = element.cloneNode(true);
  if (clone.nodeType !== 1) {
    return { html: source, matched: false, newId: null };
  }
  clone.setAttribute("id", uniqueId);
  clone.removeAttribute("data-hf-id");
  for (const child of Array.from(clone.querySelectorAll("[data-hf-id]"))) child.removeAttribute("data-hf-id");
  clone.setAttribute("data-start", String(at));
  element.parentElement.insertBefore(clone, element.nextSibling);
  return { html: document.toString(), matched: true, newId: uniqueId };
}

function numericAttribute(element: Element, name: string): number | null {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : null;
}

function findTarget(document: Document, target: SourceMutationTarget): Element | null {
  if (target.hfId) {
    const element = Array.from(document.querySelectorAll("[data-hf-id]")).find(
      (candidate) => candidate.getAttribute("data-hf-id") === target.hfId,
    );
    if (element) return element;
  }
  if (target.id) {
    const element = document.getElementById(target.id);
    if (element) return element;
  }
  if (!target.selector) return null;
  return document.querySelectorAll(target.selector)[target.selectorIndex ?? 0] ?? null;
}
