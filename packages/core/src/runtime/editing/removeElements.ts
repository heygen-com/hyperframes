// `remove-elements`: a timeline delete takes its clips out of the frame before the save's reload, as
// Studio does in a frame it can script. Only clips the frame named, never the root or the page itself.
import type { EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import { CLIP_NODES } from "../clipNodes";

const NEVER_CLIPS = new Set([
  "html",
  "head",
  "body",
  "script",
  "style",
  "link",
  "meta",
  "template",
  "noscript",
]);

const isRootComposition = (element: Element) =>
  element.hasAttribute("data-composition-id") &&
  !element.parentElement?.closest("[data-composition-id]");

export function isRemovableNode(element: Element | null): element is Element {
  return Boolean(element && !NEVER_CLIPS.has(element.localName) && !isRootComposition(element));
}

function removableClip(element: Element | null): element is Element {
  return isRemovableNode(element) && element.matches(CLIP_NODES);
}

/** Deduplicates handles so a node inside another named node leaves with it and counts once. */
export function outermostElements(elements: readonly Element[]): Element[] {
  return [...new Set(elements)].filter(
    (element, _, all) => !all.some((other) => other !== element && other.contains(element)),
  );
}

/** Removes every named clip, or none when any handle is stale or names something that is not a clip. */
export function removeElements({ handles }: { handles: EditingElementHandle[] }): {
  removed: number;
} {
  const elements = handles.map(elementForHandle);
  if (!elements.every(removableClip)) return { removed: 0 };
  const outermost = outermostElements(elements);
  for (const element of outermost) element.remove();
  return { removed: outermost.length };
}
