/**
 * Resolve the injected render-frame `<img>` that stands in for a `<video>`
 * during render.
 *
 * The producer's frame-injection pipeline hides each `<video>` and paints from
 * a sibling `<img id="__render_frame_<renderId>__">`. That id is derived from
 * the element's *render* id, not its author id: author ids are only unique
 * within one composition file, and the render document is the inlined union of
 * many, so two scenes can carry the same `<video id="clip">`. Deriving from
 * `el.id` there resolves every collider to the first one's frame — the reader
 * silently reads another clip's pixels.
 *
 * This module owns that derivation for the runtime. The engine mirrors the same
 * rule in-page (`mediaRenderIdBridge`), because code shipped into
 * `page.evaluate` cannot import; `renderFrameElementId` is the definition both
 * sides follow, and its format is pinned by test.
 */

import { MEDIA_RENDER_ID_ATTR } from "../compiler/mediaRenderIds.js";

/**
 * The render id an element is addressed by: its stamped, document-unique id
 * when the producer compiled this document, else its author id. The two are
 * the same string whenever no collision forced a suffix.
 */
export function readMediaRenderId(media: Element): string | null {
  return media.getAttribute(MEDIA_RENDER_ID_ATTR) || media.id || null;
}

/**
 * Affixes of the sibling id. Exported so the engine can build the same id
 * inside `page.evaluate`, where it cannot import: it passes these through as
 * evaluate arguments rather than repeating the literals. Keeping them here is
 * what makes this module the one definition of the format.
 */
export const RENDER_FRAME_ID_PREFIX = "__render_frame_";
export const RENDER_FRAME_ID_SUFFIX = "__";

/** The id of the render-frame `<img>` paired with a given render id. */
export function renderFrameIdForRenderId(renderId: string): string {
  return `${RENDER_FRAME_ID_PREFIX}${renderId}${RENDER_FRAME_ID_SUFFIX}`;
}

/** The id of the render-frame `<img>` paired with a media element. */
export function renderFrameElementId(media: Element): string | null {
  const renderId = readMediaRenderId(media);
  return renderId ? renderFrameIdForRenderId(renderId) : null;
}

/**
 * The injected render-frame `<img>` for a media element, or null in preview
 * (where the producer never creates one).
 */
export function findInjectedRenderFrame(media: Element): HTMLImageElement | null {
  const frameId = renderFrameElementId(media);
  if (!frameId) return null;
  const frame = document.getElementById(frameId);
  return frame instanceof HTMLImageElement ? frame : null;
}
