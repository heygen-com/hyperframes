import { isHtmlElement } from "./domEditingDom";

// Layer-tree roots: the drilled-into group's element children, else the doc root.
export function groupScopedLayerRoots(
  root: HTMLElement,
  activeGroupElement: HTMLElement | null,
): HTMLElement[] {
  const els = activeGroupElement?.isConnected ? Array.from(activeGroupElement.children) : [root];
  return els.filter(isHtmlElement);
}
