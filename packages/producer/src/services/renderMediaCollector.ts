/**
 * Collect the render pipeline's media list from the fully inlined document.
 *
 * Ids are unique per composition file, not per render document (see mediaRenderIds.ts), so media is
 * read from the inlined document: each element once, keyed by its render id or else its author id,
 * and placed by the composition hosts it sits inside.
 */

import { parseHTML } from "linkedom";
import {
  MEDIA_RENDER_ID_ATTR,
  normalizeRateSpec,
  resolveAuthoredTimingWindow,
  shiftRateLane,
  sourceTimeAt,
} from "@hyperframes/core";
import {
  MEDIA_START_BASIS_ATTR,
  compositionOriginSeconds,
  cutToHostSlots,
  hostInPointSeconds,
  type HostSlot,
  readMediaStartBasis,
  resolveAbsoluteMediaStartSeconds,
  type MediaStartBasis,
} from "@hyperframes/core/media-timing";
import {
  parseVideoElements,
  parseImageElements,
  parseAudioElements,
  isSelfOrAncestorHidden,
  resolveReferencedStart,
  type RefResolverEl,
  type RefResolverDoc,
  type VideoElement,
  type ImageElement,
  type AudioElement,
} from "@hyperframes/engine";

/**
 * Where a composition host closes in its parent's time, or null when unbounded.
 * Delegates to `resolveAuthoredTimingWindow`, the same window the runtime uses to hide descendants.
 */
function resolveHostEnd(host: Element, hostStart: number): number | null {
  return (
    resolveAuthoredTimingWindow({
      start: hostStart,
      duration: host.getAttribute("data-duration"),
      end: host.getAttribute("data-end"),
    })?.end ?? null
  );
}

interface HostWindow {
  /** Seconds to add to a descendant's authored, scene-relative start. */
  offset: number;
  /** Absolute time past which a descendant is outside its host, or Infinity. */
  limit: number;
  /** Whether authored media time is composition-local or legacy root-global. */
  basis: MediaStartBasis;
  /** Root-time slots of the enclosing hosts with an in-point. */
  slots: HostSlot[];
}

const ROOT_WINDOW: HostWindow = { offset: 0, limit: Infinity, basis: "local", slots: [] };

// Every composition host shifts what it holds, inline or inlined from a file, as in core's start resolver.
const COMPOSITION_HOST_SELECTOR =
  "[data-composition-id], [data-composition-src], [data-composition-file]";

/** Composition hosts that place `element`, root first. */
function enclosingHosts(element: Element): Element[] {
  const hosts: Element[] = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.matches(COMPOSITION_HOST_SELECTOR)) {
      hosts.unshift(ancestor);
    }
  }
  return hosts;
}

/**
 * Fold a media element's chain of composition hosts into one window.
 *
 * Host `data-start` is resolved the same way media is (`resolveReferencedStart`):
 * numeric literals, or an id / `data-composition-id` ref to a sibling slot's
 * end (`data-start="hook"`). `parseFloat("hook")` is 0, which stacked every
 * chained scene at 0–2s. Each host's end comes from `resolveHostEnd`, which
 * shares the runtime's timing resolver, so the planner's media windows match
 * the window in which the runtime shows the host's descendants.
 */
function resolveHostWindow(
  element: Element,
  document: RefResolverDoc,
  startCache: Map<RefResolverEl, number>,
  visiting: Set<RefResolverEl>,
): HostWindow {
  const hosts = enclosingHosts(element);
  if (hosts.length === 0) return ROOT_WINDOW;

  let offset = 0;
  let limit = Infinity;
  const slots: HostSlot[] = [];
  for (const [index, host] of hosts.entries()) {
    const hostStart = resolveReferencedStart(document, host, startCache, visiting);
    const hostEnd = resolveHostEnd(host, hostStart);
    if (hostEnd != null && !isRootComposition(host, index)) {
      limit = Math.min(limit, offset + hostEnd);
    }
    if (hostInPointSeconds(host) > 0) {
      slots.push({ start: offset + hostStart, end: offset + (hostEnd ?? Infinity) });
    }
    offset += compositionOriginSeconds(hostStart, host);
  }
  return { offset, limit, basis: mediaStartBasis(element), slots };
}

// The root composition's end is the render's length, not a cut: a cut would move clip fade-outs.
const isRootComposition = (host: Element, depth: number): boolean =>
  depth === 0 && !host.matches("[data-composition-src], [data-composition-file]");

function mediaStartBasis(element: Element): MediaStartBasis {
  const tag = element.tagName.toLowerCase();
  return tag === "video" || tag === "audio"
    ? readMediaStartBasis(element.getAttribute(MEDIA_START_BASIS_ATTR))
    : "local";
}

/**
 * Map each media id the parsers report (render id, else author id: render ids are only stamped
 * when files are inlined) to its hosts' window, keyed on id so two parses need not walk in step.
 */
function collectHostWindows(html: string): Map<string, HostWindow> {
  const { document } = parseHTML(html);
  const windows = new Map<string, HostWindow>();
  const startCache = new Map<RefResolverEl, number>();
  const visiting = new Set<RefResolverEl>();
  // What the parsers report; an author id never displaces a render id, or another author id.
  for (const element of document.querySelectorAll("video, audio, img[src]")) {
    const renderId = element.getAttribute(MEDIA_RENDER_ID_ATTR);
    const id = renderId || element.getAttribute("id");
    if (!id || (!renderId && windows.has(id))) continue;
    windows.set(
      id,
      resolveHostWindow(element as unknown as Element, document, startCache, visiting),
    );
  }
  return windows;
}

/** Ids, as the parsers report them, of videos that are `data-hidden` or sit inside such an element. */
export function collectHiddenVideoIds(html: string): Set<string> {
  const { document } = parseHTML(html);
  const hidden = new Set<string>();
  for (const element of document.querySelectorAll("video")) {
    const id = element.getAttribute(MEDIA_RENDER_ID_ATTR) || element.getAttribute("id");
    if (id && isSelfOrAncestorHidden(element)) hidden.add(id);
  }
  return hidden;
}

/**
 * Shift a scene-relative window onto the root timeline; null when the clip starts after its host
 * ends (the file-tree walk's `start < absoluteEnd` drop) or its in-point hosts cut all of it.
 * `start` stays the clip's origin; `played` is the part the in-point hosts' slots keep.
 */
function toAbsoluteWindow(
  start: number,
  end: number,
  window: HostWindow,
): { start: number; end: number; played: { start: number; end: number } } | null {
  const absoluteStart = resolveAbsoluteMediaStartSeconds({
    authoredStart: start,
    hostStart: window.offset,
    basis: window.basis,
  });
  if (absoluteStart >= window.limit) return null;
  const absoluteEnd = resolveAbsoluteMediaStartSeconds({
    authoredStart: end,
    hostStart: window.offset,
    basis: window.basis,
  });
  const absolute = { start: absoluteStart, end: Math.min(absoluteEnd, window.limit) };
  const played = cutToHostSlots(absolute, window.slots);
  if (played.end === played.start && absolute.end > absolute.start) return null;
  return { start: absolute.start, end: played.end, played };
}

/** Start a clip where its in-point hosts let it play, that much further into its source. */
function startAtPlayed<T extends AudioElement | VideoElement>(
  clip: T,
  played: { start: number },
): T {
  const head = played.start - clip.start;
  if (head <= 0) return clip;
  // ponytail: a loop runs from mediaStart, so it only moves to its slot and keeps main's phase error;
  // an exact cut needs a visible start separate from the loop origin in the engine.
  if ("loop" in clip && clip.loop) return { ...clip, start: played.start };
  const rate = normalizeRateSpec(clip.playbackRate);
  return {
    ...clip,
    start: played.start,
    mediaStart: clip.mediaStart + sourceTimeAt(rate, head),
    playbackRate: shiftRateLane(rate, head),
  };
}

export interface RenderMedia {
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  /** Ids of clips in the document that never play; the browser probe must not add them back. */
  droppedMediaIds: Set<string>;
}

/**
 * Parse every media element in the inlined render document, with each clip's
 * window resolved onto the root timeline.
 *
 * Expects `assignMediaRenderIds` to have run: the parsers report the stamped
 * render id as each element's `id`, which is what the rest of the pipeline
 * keys on and what the engine resolves back to a DOM node.
 */
export function collectRenderMedia(html: string): RenderMedia {
  const windows = collectHostWindows(html);
  const windowFor = (id: string): HostWindow => windows.get(id) ?? ROOT_WINDOW;
  const droppedMediaIds = new Set<string>();

  // A hidden clip never shows, so it is not extracted or probed; its audio is the mixer's to mute.
  const hiddenIds = collectHiddenVideoIds(html);
  const videos: VideoElement[] = [];
  for (const video of parseVideoElements(html)) {
    if (hiddenIds.has(video.id)) {
      droppedMediaIds.add(video.id);
      continue;
    }
    const absolute = toAbsoluteWindow(video.start, video.end, windowFor(video.id));
    if (!absolute) {
      droppedMediaIds.add(video.id);
      continue;
    }
    videos.push(
      startAtPlayed({ ...video, start: absolute.start, end: absolute.end }, absolute.played),
    );
  }

  const images: ImageElement[] = [];
  for (const image of parseImageElements(html)) {
    const absolute = toAbsoluteWindow(image.start, image.end, windowFor(image.id));
    if (absolute) images.push({ ...image, start: absolute.start, end: absolute.end });
    else droppedMediaIds.add(image.id);
  }

  // A <video data-has-audio> track is reported as "<renderId>-audio"; strip the
  // suffix to look the element's host window back up.
  const audios: AudioElement[] = [];
  for (const audio of parseAudioElements(html)) {
    const elementId = audio.type === "video" ? audio.id.replace(/-audio$/, "") : audio.id;
    const placed = placeAudio(audio, windowFor(elementId));
    if (placed) audios.push(placed);
    else droppedMediaIds.add(elementId);
  }

  return { videos, audios, images, droppedMediaIds };
}

function placeAudio(audio: AudioElement, window: HostWindow): AudioElement | null {
  // The mixer reads end === 0 as "run to the natural media length", so an
  // unbounded track must stay unbounded rather than collapse onto its start.
  const authoredEnd = audio.end > 0 ? audio.end : Infinity;
  const absolute = toAbsoluteWindow(audio.start, authoredEnd, window);
  if (!absolute) return null;
  const end = Number.isFinite(absolute.end) ? absolute.end : 0;
  return startAtPlayed({ ...audio, start: absolute.start, end }, absolute.played);
}
