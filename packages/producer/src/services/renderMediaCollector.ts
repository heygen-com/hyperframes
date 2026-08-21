/**
 * Collect the render pipeline's media list from the fully inlined document.
 *
 * Sub-composition media used to be gathered from each composition FILE before
 * inlining, then merged with the main document's media and deduplicated by
 * element id. That merge is unsound: ids are unique per file, not per render
 * document, so two scenes that both declare `<video id="clip">` — or that both
 * declare a bare `<video>` and get the per-file auto-id `hf-video-0` — collapse
 * into a single entry. See mediaRenderIds.ts for the full failure.
 *
 * Reading the inlined document instead makes the render document the single
 * source of truth for what media exists: every element is present exactly once,
 * `assignMediaRenderIds` has already given it a document-unique key, and the
 * timeline offsets are recoverable from the composition hosts it sits inside.
 */

import { parseHTML } from "linkedom";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import {
  parseVideoElements,
  parseImageElements,
  parseAudioElements,
  type VideoElement,
  type ImageElement,
  type AudioElement,
} from "@hyperframes/engine";

/**
 * Marks a host element that `inlineSubCompositions` hoisted a composition into.
 * Set unconditionally on every inlined host, which makes it the reliable signal
 * for "this ancestor shifts its children along the timeline".
 */
const COMPOSITION_HOST_ATTR = "data-composition-file";

interface HostWindow {
  /** Seconds to add to a descendant's authored, scene-relative start. */
  offset: number;
  /** Absolute time past which a descendant is outside its host, or Infinity. */
  limit: number;
}

const ROOT_WINDOW: HostWindow = { offset: 0, limit: Infinity };

function parseNumeric(value: string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fold a media element's chain of composition hosts into one window.
 *
 * Mirrors the offset arithmetic `parseSubCompositions` applied while walking
 * the composition file tree, so a document that has no id collisions produces
 * exactly the timings it did before. Only `data-end` bounds a host: a host
 * carrying just `data-duration` was unbounded there too, and widening that here
 * would silently retime existing compositions rather than fix identity.
 */
function resolveHostWindow(element: Element): HostWindow {
  const hosts: Element[] = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hasAttribute(COMPOSITION_HOST_ATTR)) hosts.push(ancestor);
  }
  if (hosts.length === 0) return ROOT_WINDOW;

  let offset = 0;
  let limit = Infinity;
  // parentElement walks leaf → root; the offsets accumulate root → leaf.
  for (const host of hosts.reverse()) {
    const hostStart = parseNumeric(host.getAttribute("data-start")) ?? 0;
    const hostEnd = parseNumeric(host.getAttribute("data-end"));
    if (hostEnd != null) limit = Math.min(limit, offset + hostEnd);
    offset += hostStart;
  }
  return { offset, limit };
}

/**
 * Map each render id to the window of the composition hosts it is nested in.
 * Keyed on the render id rather than document position so the caller never has
 * to assume two separate parses walk the document in the same order.
 */
function collectHostWindows(html: string): Map<string, HostWindow> {
  const { document } = parseHTML(html);
  const windows = new Map<string, HostWindow>();
  for (const element of document.querySelectorAll(`[${MEDIA_RENDER_ID_ATTR}]`)) {
    const renderId = element.getAttribute(MEDIA_RENDER_ID_ATTR);
    if (!renderId) continue;
    windows.set(renderId, resolveHostWindow(element as unknown as Element));
  }
  return windows;
}

/**
 * Shift a scene-relative window onto the root timeline.
 * Returns null when the clip starts after its host has already ended, matching
 * the `start < absoluteEnd` drop the file-tree walk applied.
 */
function toAbsoluteWindow(
  start: number,
  end: number,
  window: HostWindow,
): { start: number; end: number } | null {
  const absoluteStart = start + window.offset;
  if (absoluteStart >= window.limit) return null;
  const absoluteEnd = end + window.offset;
  return { start: absoluteStart, end: Math.min(absoluteEnd, window.limit) };
}

export interface RenderMedia {
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
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

  const videos: VideoElement[] = [];
  for (const video of parseVideoElements(html)) {
    const absolute = toAbsoluteWindow(video.start, video.end, windowFor(video.id));
    if (absolute) videos.push({ ...video, ...absolute });
  }

  const images: ImageElement[] = [];
  for (const image of parseImageElements(html)) {
    const absolute = toAbsoluteWindow(image.start, image.end, windowFor(image.id));
    if (absolute) images.push({ ...image, ...absolute });
  }

  // A <video data-has-audio> track is reported as "<renderId>-audio"; strip the
  // suffix to look the element's host window back up.
  const audios: AudioElement[] = [];
  for (const audio of parseAudioElements(html)) {
    const elementId = audio.type === "video" ? audio.id.replace(/-audio$/, "") : audio.id;
    // The mixer reads end === 0 as "run to the natural media length", so an
    // unbounded track must stay unbounded rather than collapse onto its start.
    const authoredEnd = audio.end > 0 ? audio.end : Infinity;
    const absolute = toAbsoluteWindow(audio.start, authoredEnd, windowFor(elementId));
    if (!absolute) continue;
    audios.push({
      ...audio,
      start: absolute.start,
      end: Number.isFinite(absolute.end) ? absolute.end : 0,
    });
  }

  return { videos, audios, images };
}
