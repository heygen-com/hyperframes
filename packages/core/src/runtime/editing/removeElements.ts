// `remove-elements`: a timeline delete takes its clips out of the frame before the save's reload, as
// Studio does in a frame it can script. Only clips the frame named, never the root or the page itself.
import type { EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { isCompositionHost } from "../editingLayers";

const NEVER_CLIPS = new Set([
  "html",
  "head",
  "body",
  "script",
  "style",
  "link",
  "meta",
  "template",
]);

const isRootComposition = (element: Element) =>
  element.hasAttribute("data-composition-id") &&
  !element.parentElement?.closest("[data-composition-id]");

function removableClip(element: Element | null): element is Element {
  if (!element || NEVER_CLIPS.has(element.localName) || isRootComposition(element)) return false;
  return (
    element.hasAttribute("data-start") ||
    element.hasAttribute("data-composition-id") ||
    isCompositionHost(element)
  );
}

/** Removes every named clip, or none when any handle is stale or names something that is not a clip. */
export function removeElements({ handles }: { handles: EditingElementHandle[] }): {
  removed: number;
} {
  const elements = handles.map(elementForHandle);
  if (!elements.every(removableClip)) return { removed: 0 };
  for (const element of elements) element.remove();
  return { removed: elements.length };
}
