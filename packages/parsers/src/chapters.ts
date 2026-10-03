/**
 * Authored chapter markers (`data-chapter` on timed clips).
 *
 * Chapter start is the clip's resolved `data-start`. Clip duration does not
 * close the chapter — the marker runs until the next chapter or composition end.
 */

import {
  COMPOSITION_ATTRIBUTES,
  parseNumeric,
  readClipTiming,
  type ClipAttributeReader,
  type ReadClipTimingOptions,
} from "./compositionContract.js";

/** Two chapter starts that differ by at most this many seconds are duplicates. */
export const CHAPTER_START_EQUALITY_EPSILON_SECONDS = 0.001;

export type ChapterDiagnosticCode =
  | "chapter_empty"
  | "chapter_missing_timing"
  | "chapter_duplicate_start"
  | "chapter_out_of_range";

export interface ChapterDiagnostic {
  code: ChapterDiagnosticCode;
  elementId: string;
  title: string;
  start: number | null;
}

export interface ParsedChapter {
  start: number | null;
  title: string;
  elementId: string;
  diagnostics: ChapterDiagnostic[];
}

export interface ChapterListing {
  index: number;
  start: number;
  title: string;
  elementId: string;
}

export interface ParseChaptersOptions {
  resolveReferenceEnd?: ReadClipTimingOptions["resolveReferenceEnd"];
  rootDuration?: number | null;
}

export interface TimedElementLike extends ClipAttributeReader {
  id?: string;
  getAttribute(name: string): string | null;
  hasAttribute?(name: string): boolean;
  parentElement?: TimedElementLike | null;
}

export interface ChapterQueryRoot {
  querySelectorAll(selectors: string): ArrayLike<TimedElementLike>;
  querySelector?(selectors: string): TimedElementLike | null;
  getAttribute?(name: string): string | null;
}

function readAttr(el: TimedElementLike, name: string): string | null {
  return el.getAttribute(name);
}

function elementIdOf(el: TimedElementLike): string {
  return el.id || readAttr(el, "data-hf-id") || "";
}

function isCompositionHost(el: TimedElementLike): boolean {
  return Boolean(readAttr(el, "data-composition-id") || readAttr(el, "data-composition-src"));
}

function isTimedQueryRoot(
  root: ChapterQueryRoot,
): root is ChapterQueryRoot & TimedElementLike {
  return typeof root.getAttribute === "function";
}

function hostCompositionRoot(root: ChapterQueryRoot): TimedElementLike | null {
  if (isTimedQueryRoot(root) && root.getAttribute("data-composition-id")) {
    return root;
  }
  if (typeof root.querySelector !== "function") return null;
  return root.querySelector("[data-composition-id]");
}

/**
 * Descendants of an inlined sub-composition do not contribute host chapters.
 * The nested host itself may carry `data-chapter`.
 */
function isNestedCompositionDescendant(
  el: TimedElementLike,
  hostRoot: TimedElementLike | null,
): boolean {
  let parent = el.parentElement ?? null;
  while (parent && parent !== hostRoot) {
    if (isCompositionHost(parent)) return true;
    parent = parent.parentElement ?? null;
  }
  return false;
}

export function createDocumentReferenceEndResolver(
  root: ChapterQueryRoot,
): (refId: string) => number | null {
  const timed = Array.from(root.querySelectorAll("[data-start]"));
  const timedById = new Map<string, TimedElementLike>();
  for (const element of timed) {
    const id = element.id;
    if (id) timedById.set(id, element);
    const hfId = readAttr(element, "data-hf-id");
    if (hfId) timedById.set(hfId, element);
    const compositionId = readAttr(element, "data-composition-id");
    if (compositionId) timedById.set(compositionId, element);
  }

  const resolveEnd = (refId: string, visiting: ReadonlySet<string>): number | null => {
    if (visiting.has(refId)) return null;
    const referenced = timedById.get(refId);
    if (!referenced) return null;
    const next = new Set(visiting);
    next.add(refId);
    return readClipTiming(referenced, {
      defaultStart: null,
      resolveReferenceEnd: (nestedId) => resolveEnd(nestedId, next),
    }).end;
  };

  return (refId) => resolveEnd(refId, new Set());
}

function readRootDuration(root: ChapterQueryRoot, explicit?: number | null): number | null {
  if (explicit != null && Number.isFinite(explicit)) return explicit;
  const host = hostCompositionRoot(root);
  if (!host) return null;
  return parseNumeric(readAttr(host, COMPOSITION_ATTRIBUTES.duration));
}

function diagnoseChapter(
  title: string,
  start: number | null,
  elementId: string,
  rawStart: string | null,
  rootDuration: number | null,
): ChapterDiagnostic[] {
  const diagnostics: ChapterDiagnostic[] = [];
  const push = (code: ChapterDiagnosticCode) => {
    diagnostics.push({ code, elementId, title, start });
  };
  if (!title) push("chapter_empty");
  if (rawStart == null || rawStart.trim() === "" || start == null) {
    push("chapter_missing_timing");
  }
  const rawAbsolute = parseNumeric(rawStart);
  if (rawAbsolute != null && rawAbsolute < 0) push("chapter_out_of_range");
  if (start != null && rootDuration != null && start > rootDuration) {
    push("chapter_out_of_range");
  }
  return diagnostics;
}

/**
 * Walk host-document chapter markers, resolve starts through `readClipTiming`,
 * and return document-order items later sorted by start.
 */
export function parseChapters(
  root: ChapterQueryRoot,
  options: ParseChaptersOptions = {},
): ParsedChapter[] {
  const resolveReferenceEnd =
    options.resolveReferenceEnd ?? createDocumentReferenceEndResolver(root);
  const rootDuration = readRootDuration(root, options.rootDuration);
  const hostRoot = hostCompositionRoot(root);
  const candidates = Array.from(root.querySelectorAll(`[${COMPOSITION_ATTRIBUTES.chapter}]`));

  const parsed: ParsedChapter[] = [];
  for (const el of candidates) {
    if (isNestedCompositionDescendant(el, hostRoot)) continue;
    const title = (readAttr(el, COMPOSITION_ATTRIBUTES.chapter) ?? "").trim();
    const rawStart = readAttr(el, COMPOSITION_ATTRIBUTES.start);
    const timing = readClipTiming(el, {
      defaultStart: null,
      resolveReferenceEnd,
    });
    const start = timing.start;
    const elementId = elementIdOf(el);
    parsed.push({
      start,
      title,
      elementId,
      diagnostics: diagnoseChapter(title, start, elementId, rawStart, rootDuration),
    });
  }

  parsed.sort((a, b) => {
    if (a.start == null && b.start == null) return 0;
    if (a.start == null) return 1;
    if (b.start == null) return -1;
    if (a.start !== b.start) return a.start - b.start;
    return 0;
  });

  for (let i = 0; i < parsed.length; i++) {
    const current = parsed[i];
    if (!current || current.start == null) continue;
    const currentStart = current.start;
    const duplicate = parsed.some((other, j) => {
      if (j === i || other.start == null) return false;
      return Math.abs(other.start - currentStart) <= CHAPTER_START_EQUALITY_EPSILON_SECONDS;
    });
    if (duplicate) {
      current.diagnostics.push({
        code: "chapter_duplicate_start",
        elementId: current.elementId,
        title: current.title,
        start: currentStart,
      });
    }
  }

  return parsed;
}

/** Valid navigational chapters: non-empty title and a resolved start. */
export function listAuthoredChapters(chapters: readonly ParsedChapter[]): ChapterListing[] {
  const listings: ChapterListing[] = [];
  for (const chapter of chapters) {
    if (chapter.start == null || chapter.title.length === 0) continue;
    listings.push({
      index: listings.length + 1,
      start: chapter.start,
      title: chapter.title,
      elementId: chapter.elementId,
    });
  }
  return listings;
}
