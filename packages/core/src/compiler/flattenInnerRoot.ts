/**
 * Flattened inner-root preparation shared by the bundler (preview) and the
 * producer (render) inline paths.
 *
 * Lives in its own module — not htmlBundler.ts — so consumers that only need
 * the flattening contract (e.g. inlineSubCompositions tests, the producer)
 * don't drag in the bundler's esbuild/fs dependencies.
 *
 * NOTE: packages/core/src/runtime/compositionLoader.ts keeps a browser-side
 * copy of this logic (it works on live HTMLElements via document.importNode).
 * Keep the strip list and the id → data-hf-authored-id rename in sync.
 */

export const FLATTENED_INNER_ROOT_STRIP_ATTRS = [
  "data-composition-id",
  "data-composition-file",
  "data-start",
  "data-duration",
  "data-end",
  "data-track-index",
  "data-track",
  "data-composition-src",
  "data-hf-authored-duration",
  "data-hf-authored-end",
];

export function prepareFlattenedInnerRoot(innerRoot: Element): Element {
  const prepared = innerRoot.cloneNode(true) as Element;
  const authoredRootId = prepared.getAttribute("id")?.trim();
  for (const attrName of FLATTENED_INNER_ROOT_STRIP_ATTRS) {
    prepared.removeAttribute(attrName);
  }
  if (authoredRootId) {
    prepared.removeAttribute("id");
    prepared.setAttribute("data-hf-authored-id", authoredRootId);
  }
  prepared.setAttribute("data-hf-inner-root", "true");
  const w = prepared.getAttribute("data-width");
  const h = prepared.getAttribute("data-height");
  const widthVal = w ? `${w}px` : "100%";
  const heightVal = h ? `${h}px` : "100%";
  const existingStyle = (prepared.getAttribute("style") || "").trim();
  const fill = `width:${widthVal};height:${heightVal}`;
  prepared.setAttribute("style", existingStyle ? `${existingStyle};${fill}` : fill);
  return prepared;
}
