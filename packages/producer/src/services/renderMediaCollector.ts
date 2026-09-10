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
import {
  IDENTITY_HOST_WINDOW,
  MEDIA_RENDER_ID_ATTR,
  boundsOnly,
  mapClipThroughHostWindow,
  resolveNestedHostWindow,
  type MappedClip,
  type NestedHostWindow,
} from "@hyperframes/core";
import { MEDIA_START_BASIS_ATTR, readMediaStartBasis } from "@hyperframes/core/media-timing";
import {
  parseVideoElements,
  parseImageElements,
  parseAudioElements,
  resolveReferencedStart,
  type RefResolverEl,
  type VideoElement,
  type ImageElement,
  type AudioElement,
} from "@hyperframes/engine";

/**
 * Map each render id to the window of the composition hosts it is nested in.
 * Keyed on the render id rather than document position so the caller never has
 * to assume two separate parses walk the document in the same order.
 *
 * Host `data-start` goes through `resolveReferencedStart`, the same resolver
 * media uses, so an id-ref to a sibling slot (`data-start="hook"`) lands where
 * that slot ends instead of at `parseFloat("hook")`.
 *
 * Legacy media authored in root time (`data-hf-media-start-basis="global"`)
 * keeps its own start: the hosts only bound it, they do not shift it.
 */
function collectHostWindows(html: string): Map<string, NestedHostWindow> {
  const { document } = parseHTML(html);
  const startCache = new Map<RefResolverEl, number>();
  const visiting = new Set<RefResolverEl>();
  const hostStart = (host: RefResolverEl): number =>
    resolveReferencedStart(document, host, startCache, visiting);

  const windows = new Map<string, NestedHostWindow>();
  for (const element of document.querySelectorAll(`[${MEDIA_RENDER_ID_ATTR}]`)) {
    const renderId = element.getAttribute(MEDIA_RENDER_ID_ATTR);
    if (!renderId) continue;
    const window = resolveNestedHostWindow(element, hostStart) ?? IDENTITY_HOST_WINDOW;
    const global = readMediaStartBasis(element.getAttribute(MEDIA_START_BASIS_ATTR)) === "global";
    windows.set(renderId, global ? boundsOnly(window) : window);
  }
  return windows;
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
  const windowFor = (id: string): NestedHostWindow => windows.get(id) ?? IDENTITY_HOST_WINDOW;

  // A clip mapped to a zero-width window falls outside its slot: nothing to render.
  const isVisible = (clip: MappedClip): boolean => clip.end > clip.start;

  const videos: VideoElement[] = [];
  for (const video of parseVideoElements(html)) {
    const mapped = mapClipThroughHostWindow(
      video.start,
      video.end,
      windowFor(video.id),
      video.playbackRate,
    );
    if (isVisible(mapped)) videos.push({ ...video, ...mapped });
  }

  const images: ImageElement[] = [];
  for (const image of parseImageElements(html)) {
    const mapped = mapClipThroughHostWindow(image.start, image.end, windowFor(image.id));
    if (isVisible(mapped)) images.push({ ...image, start: mapped.start, end: mapped.end });
  }

  // A <video data-has-audio> track is reported as "<renderId>-audio"; strip the
  // suffix to look the element's host window back up.
  const audios: AudioElement[] = [];
  for (const audio of parseAudioElements(html)) {
    const elementId = audio.type === "video" ? audio.id.replace(/-audio$/, "") : audio.id;
    // The mixer reads end === 0 as "run to the natural media length", so an
    // unbounded track must stay unbounded rather than collapse onto its start.
    const authoredEnd = audio.end > 0 ? audio.end : Infinity;
    const mapped = mapClipThroughHostWindow(
      audio.start,
      authoredEnd,
      windowFor(elementId),
      audio.playbackRate,
    );
    if (!isVisible(mapped)) continue;
    audios.push({ ...audio, ...mapped, end: Number.isFinite(mapped.end) ? mapped.end : 0 });
  }

  return { videos, audios, images };
}
