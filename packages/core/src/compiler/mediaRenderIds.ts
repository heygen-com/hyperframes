/**
 * Document-unique identity for media elements in a compiled render document.
 *
 * Element `id`s are only unique within one composition FILE. The render
 * document is the inlined union of every file, so ids collide there in two
 * ways an author cannot avoid:
 *
 * 1. Two scenes each declare `<video id="clip">` — legal per file, duplicated
 *    once inlined.
 * 2. Two scenes each declare a bare `<video>` — the timing compiler numbers
 *    auto-ids per file, so both become `hf-video-0`.
 *
 * The render pipeline keys media on that id (extract, inject, visibility,
 * bounds), so a collision collapses N elements into one entry and every
 * lookup resolves to whichever element happens to come first in the document.
 * The surviving clip's frames land on the wrong element and the visible scene
 * paints without footage.
 *
 * This module is the single owner of the fix: after inlining, every media
 * element gets a document-unique `data-hf-render-id`. It equals the element's
 * own id whenever that id is already unique, so uncolliding documents keep
 * byte-identical pipeline keys and log output. Author-visible `id` attributes
 * are never rewritten — 158 of the 161 registry blocks reference their own ids
 * from `#id` CSS or `getElementById`, so renaming would break scene styling to
 * fix scene footage.
 */

export const MEDIA_RENDER_ID_ATTR = "data-hf-render-id";

/** Elements the render pipeline addresses by id. */
const MEDIA_SELECTOR = "video[src], audio[src], img[src]";

interface MediaElementLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface DocumentLike {
  querySelectorAll(selector: string): Iterable<MediaElementLike>;
}

/**
 * Derive a document-unique render id from an element's own id.
 *
 * `taken` accumulates every id handed out so far, including the plain ids of
 * elements that have not been visited yet is NOT required: a later element
 * whose plain id was already claimed simply gets a suffix. Document order
 * therefore decides who keeps the plain id, which keeps the first (and, in the
 * overwhelmingly common single-occurrence case, only) element stable.
 */
function uniqueRenderId(baseId: string, taken: Set<string>): string {
  if (!taken.has(baseId)) return baseId;
  let suffix = 2;
  while (taken.has(`${baseId}__hf${suffix}`)) suffix += 1;
  return `${baseId}__hf${suffix}`;
}

/**
 * Stamp `data-hf-render-id` on every media element in a compiled document.
 *
 * Idempotent: an element that already carries the attribute keeps it, so
 * re-compiling a document (the resolved-durations recompile path) does not
 * renumber ids out from under an in-flight extraction.
 */
export function assignMediaRenderIds(document: DocumentLike): void {
  const taken = new Set<string>();
  const pending: MediaElementLike[] = [];

  for (const el of document.querySelectorAll(MEDIA_SELECTOR)) {
    const existing = el.getAttribute(MEDIA_RENDER_ID_ATTR);
    if (existing) {
      taken.add(existing);
      continue;
    }
    pending.push(el);
  }

  for (const el of pending) {
    const baseId = el.getAttribute("id");
    // An element with no id yet is numbered by the timing compiler before this
    // runs. If one slips through, fall back to a positional id rather than
    // stamping an empty string that every other id-less element would share.
    const renderId = uniqueRenderId(baseId || `hf-media-${taken.size}`, taken);
    taken.add(renderId);
    el.setAttribute(MEDIA_RENDER_ID_ATTR, renderId);
  }
}
