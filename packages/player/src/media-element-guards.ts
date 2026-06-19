export function isRealmElement(node: Node): node is Element {
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.Element) return true;
  return node instanceof Element;
}

export function isRealmHtmlMediaElement(node: Node): node is HTMLMediaElement {
  if (!isRealmElement(node)) return false;
  if (node.tagName !== "AUDIO" && node.tagName !== "VIDEO") return false;

  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.HTMLMediaElement) return true;
  return node instanceof HTMLMediaElement;
}
