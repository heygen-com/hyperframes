/**
 * Realm-independent "what kind of node is this" tests for composition DOM.
 *
 * THE INVARIANT: the runtime never assumes the composition DOM was built by the
 * same JavaScript realm the runtime is running in. It asks what a node IS (node
 * type, namespace, tag name), never which window's constructor made it.
 *
 * Why that matters. `node instanceof HTMLElement` compares against the
 * `HTMLElement` of the realm this module was loaded into, so it answers "which
 * window built this node", not "what is this node". One document can hold
 * elements from several realms at once, and a node keeps the prototype chain of
 * whichever realm created it however it got there.
 *
 * MEASURED, in the Studio preview, on some loads: `<html>`, `<head>` and
 * `<script>` carry the preview frame's prototypes while `<body>` and every
 * element under it carry the editor window's. Tagging each realm's
 * `Element.prototype` before any page script ran and reading the tag back off
 * the live nodes is how that was established. NOT established: how the nodes
 * come to be there. No `adoptNode`, `importNode` or `document.write` call was
 * caught doing it, and the frame is populated by `src`/`srcdoc`, so treat the
 * mechanism as an open question and the mixed realms as a fact.
 *
 * Either way `instanceof` does not throw and does not warn. It just returns
 * false, forever, for every element in the composition, and every guard written
 * as `if (!(node instanceof HTMLElement)) continue;` silently skips the whole
 * document. A whole pass goes dark with no error: the timed-element visibility
 * pass stops writing, so every scene paints on top of every other.
 *
 * `doc.defaultView.HTMLElement` is not a sufficient repair, which is why this
 * module replaced two hand-rolled attempts at it. It fixes the case where the
 * nodes belong to the document's own realm and still fails when they belong to
 * a third one. A structural test has no such case to get wrong.
 *
 * Scope of ownership: these predicates own the RUNTIME's answer to "what kind of
 * node is this", for HTML and SVG, which is everything a composition contains.
 * `packages/studio` still hand-rolls its own checks in several places and is not
 * covered by this module or by the lint guard that keeps `src/runtime` clean
 * (`scripts/lint-runtime-preview-guards.ts`).
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface NodeLike {
  readonly nodeType?: unknown;
  readonly namespaceURI?: unknown;
  readonly localName?: unknown;
}

/** Any element node, from any realm (HTML, SVG, MathML). Mirrors `instanceof Element`. */
export function isElementNode(value: unknown): value is Element {
  return value != null && (value as NodeLike).nodeType === 1;
}

/**
 * An HTML element, from any realm. Mirrors `instanceof HTMLElement`, including
 * its exclusion of SVG/MathML: "is an HTMLElement" and "is an element in the
 * XHTML namespace" are the same set.
 */
export function isHtmlElement(value: unknown): value is HTMLElement {
  return isElementNode(value) && (value as NodeLike).namespaceURI === XHTML_NS;
}

/** Single tag, by value: a rest parameter here allocates on every call, and these
 *  predicates run per element per seek and per animation frame. */
function isHtmlTag(value: unknown, tag: string): boolean {
  return isHtmlElement(value) && (value as NodeLike).localName === tag;
}

/** `<video>`, from any realm. Mirrors `instanceof HTMLVideoElement`. */
export function isVideoElement(value: unknown): value is HTMLVideoElement {
  return isHtmlTag(value, "video");
}

/** `<audio>`, from any realm. Mirrors `instanceof HTMLAudioElement`. */
export function isAudioElement(value: unknown): value is HTMLAudioElement {
  return isHtmlTag(value, "audio");
}

/** `<video>` or `<audio>`, from any realm. Mirrors `instanceof HTMLMediaElement`. */
export function isMediaElement(value: unknown): value is HTMLMediaElement {
  return isVideoElement(value) || isAudioElement(value);
}

/** `<img>`, from any realm. Mirrors `instanceof HTMLImageElement`. */
export function isImageElement(value: unknown): value is HTMLImageElement {
  return isHtmlTag(value, "img");
}

/** `<style>`, from any realm. Mirrors `instanceof HTMLStyleElement`. */
export function isStyleElement(value: unknown): value is HTMLStyleElement {
  return isHtmlTag(value, "style");
}

/** `<link>`, from any realm. Mirrors `instanceof HTMLLinkElement`. */
export function isLinkElement(value: unknown): value is HTMLLinkElement {
  return isHtmlTag(value, "link");
}

/**
 * An element that carries a CSS `style` map: HTML **or** SVG. Position edits and
 * transform writes apply to both (authored SVG `<text>`/shapes honour the CSS
 * `translate` longhand exactly as HTML does).
 */
export function isStylableElement(value: unknown): value is HTMLElement | SVGElement {
  return (
    isElementNode(value) &&
    ((value as NodeLike).namespaceURI === XHTML_NS ||
      (value as NodeLike).namespaceURI === "http://www.w3.org/2000/svg")
  );
}
