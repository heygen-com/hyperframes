/**
 * Shared between the build-time bundler (htmlBundler) and the runtime
 * composition loader: when a sub-composition's inner root is flattened into
 * its host, these timing/identity attributes must be stripped and the
 * authored id preserved as data — identical semantics in both worlds.
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

/** Strip timing attrs, demote the authored id, and mark the flattened root. */
export function markFlattenedInnerRoot(prepared: Element): void {
  const authoredRootId = prepared.getAttribute("id")?.trim();
  for (const attrName of FLATTENED_INNER_ROOT_STRIP_ATTRS) {
    prepared.removeAttribute(attrName);
  }
  if (authoredRootId) {
    prepared.removeAttribute("id");
    prepared.setAttribute("data-hf-authored-id", authoredRootId);
  }
  prepared.setAttribute("data-hf-inner-root", "true");
}
