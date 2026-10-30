import { basename } from "node:path";
import { parseHTML } from "linkedom";
import {
  readAuthoredDurationSeconds,
  readMediaOffsetSeconds,
  readPlaybackRate,
} from "@hyperframes/parsers/media-duration";

/** Kept either side of a played window, so a decoder has frames to seek from. */
const TRIM_MARGIN_SECONDS = 0.5;

export interface PlayedSegment {
  start: number;
  end: number;
}

// Script that can write a clip's in-point, length, rate, loop or source moves what it plays.
const RETIMING_SCRIPT_RE =
  /data-(?:playback-start|media-start|start|duration|end|playback-rate)|\b(?:dataset|setAttribute|currentTime|playbackRate)\b|\.(?:src|loop)\b/;

type AttrReader = (name: string) => string | null;

function mediaSources(el: Element): string[] {
  const own = el.getAttribute("src");
  const nested = [...el.querySelectorAll("source[src]")].map((s) => s.getAttribute("src")!);
  return [...(own ? [own] : []), ...nested];
}

// A host composition or in-point above the element moves what it plays; only root-level uses are bounded here.
function hasTimedAncestor(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const get: AttrReader = (name) => p.getAttribute(name);
    if (readMediaOffsetSeconds(get) > 0) return true;
    if (
      p.hasAttribute("data-composition-id") &&
      p.parentElement?.closest("[data-composition-id]")
    ) {
      return true;
    }
  }
  return false;
}

function playedWindow(el: Element): PlayedSegment | null {
  // A data-var-src clip's source is only known at render time, so neither a cut nor a shift holds.
  if (
    el.hasAttribute("loop") ||
    el.hasAttribute("data-automation") ||
    el.hasAttribute("data-var-src") ||
    hasTimedAncestor(el)
  ) {
    return null;
  }
  const get: AttrReader = (name) => el.getAttribute(name);
  const start = readMediaOffsetSeconds(get);
  const duration = readAuthoredDurationSeconds(get, Number(get("data-start") ?? 0));
  if (duration === null || !(duration > 0)) return null;
  return { start, end: start + duration * readPlaybackRate(get) };
}

/** Merged windows with margin, on the source's frame grid so shifted starts land on the same frames. */
function mergeWindows(windows: PlayedSegment[], gridPerSecond: number): PlayedSegment[] {
  const down = (t: number) => Math.floor(t * gridPerSecond) / gridPerSecond;
  const up = (t: number) => Math.ceil(t * gridPerSecond) / gridPerSecond;
  const merged: PlayedSegment[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const start = down(Math.max(0, w.start - TRIM_MARGIN_SECONDS));
    const end = up(w.end + TRIM_MARGIN_SECONDS);
    const last = merged.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

function shiftMediaStart(el: Element, segments: PlayedSegment[]): void {
  const get: AttrReader = (name) => el.getAttribute(name);
  const start = readMediaOffsetSeconds(get);
  let offset = 0;
  for (const segment of segments) {
    if (start >= segment.start && start < segment.end) {
      // Write back to whichever attribute readMediaOffsetSeconds read.
      const attr =
        Number.parseFloat(get("data-playback-start") ?? "") >= 0
          ? "data-playback-start"
          : "data-media-start";
      el.setAttribute(attr, String(offset + (start - segment.start)));
      return;
    }
    offset += segment.end - segment.start;
  }
}

/**
 * The parts of `path` the entry composition plays, with the composition shifted to match a file cut
 * to those parts. `null` when any use is not a bounded <video>/<audio> clip, so the whole file is kept.
 */
export function planTrim(input: {
  entryHtml: string;
  path: string;
  resolveKey: (rawSrc: string) => string | null;
  gridPerSecond: number;
  mentionedElsewhere: boolean;
  /** Every script the page runs, entry inline scripts included. */
  scriptCode: string;
}): { segments: PlayedSegment[]; html: string } | null {
  if (input.mentionedElsewhere || RETIMING_SCRIPT_RE.test(input.scriptCode)) return null;
  const { document } = parseHTML(input.entryHtml);
  const uses: Element[] = [];
  let sources = 0;
  for (const el of document.querySelectorAll("video, audio")) {
    const matching = mediaSources(el).filter((src) => input.resolveKey(src) === input.path);
    if (matching.length === 0) continue;
    // A media fragment (#t=) names times in the uncut file.
    if (matching.some((src) => src.includes("#"))) return null;
    uses.push(el);
    sources += matching.length;
  }
  // Every mention of the file in the page must be one of these clips' sources.
  if (uses.length === 0 || input.entryHtml.split(basename(input.path)).length - 1 !== sources) {
    return null;
  }
  const windows = uses.map(playedWindow);
  if (windows.some((w) => w === null)) return null;
  const segments = mergeWindows(windows as PlayedSegment[], input.gridPerSecond);
  for (const el of uses) shiftMediaStart(el, segments);
  return { segments, html: document.toString() };
}
