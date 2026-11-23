/**
 * HTML serializer — walks the live linkedom Document and generates clean HF HTML.
 *
 * Phase 3a: generates from the live DOM. The DOM IS the mutable state.
 * Phase 3b: GSAP script section will use the meriyah/offset-splice path once available.
 */

import {
  findById,
  getElementStyles,
  setElementStyles,
  type KeptDelete,
  type ParsedDocument,
} from "./model.js";

// A kept delete is not a clip: without these the renderer would still schedule its media and stretch the film.
const CLIP_ATTRIBUTES = ["data-start", "data-duration", "data-end", "data-track-index"];
// A hidden copy still gets its media fetched, and extracted when it is a video, so it keeps no source.
const MEDIA_SOURCE_ATTRIBUTES = ["src", "srcset", "poster"];

/** The deleted node, hidden and no longer a clip, so a script that looks it up still finds it. */
function hiddenCopy(doc: Document, kept: KeptDelete): Element | null {
  const holder = doc.createElement("div");
  holder.innerHTML = kept.html;
  const node = holder.firstElementChild;
  if (!node) return null;
  for (const el of [node, ...Array.from(node.querySelectorAll("*"))]) {
    for (const name of CLIP_ATTRIBUTES) el.removeAttribute(name);
    for (const name of MEDIA_SOURCE_ATTRIBUTES) el.removeAttribute(name);
    const remote = Object.entries(getElementStyles(el)).filter(([, v]) => v.includes("url("));
    if (remote.length > 0) setElementStyles(el, Object.fromEntries(remote.map(([k]) => [k, null])));
  }
  setElementStyles(node, { display: "none" });
  node.setAttribute("data-hidden", "");
  return node;
}

/** Put the hidden copy back where the node was; null when an undo already made it live or its parent is gone. */
function placeKeptDelete(doc: Document, kept: KeptDelete): Element | null {
  if (kept.hfId && findById(doc, kept.hfId)) return null;
  const node = hiddenCopy(doc, kept);
  const parent = kept.parentId ? findById(doc, kept.parentId) : (doc.body as Element | null);
  if (!node || !parent) return null;
  parent.insertBefore(node, parent.children[kept.siblingIndex] ?? null);
  return node;
}

function withKeptDeletes<T>(parsed: ParsedDocument, serialize: () => T): T {
  const placed = (parsed.keptDeletes ?? []).flatMap(
    (kept) => placeKeptDelete(parsed.document, kept) ?? [],
  );
  try {
    return serialize();
  } finally {
    for (const node of placed) node.remove();
  }
}

/**
 * Serialize the live document back to HTML.
 *
 * If the original input was a fragment (wrapped=true), returns only body content.
 * If the original input had a full HTML shell (wrapped=false), returns the full document.
 */
export function serializeDocument(parsed: ParsedDocument): string {
  return withKeptDeletes(parsed, () => {
    const doc = parsed.document;
    if (parsed.wrapped) {
      return (doc.body as HTMLBodyElement).innerHTML ?? "";
    }
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  });
}
