type PreviewRealm = { __hf?: { unproxiedSrc?: (el: Element) => string | null } };

export function authoredSrc(el: Element | null | undefined): string | null {
  if (!el) return null;
  const hf = (el.ownerDocument.defaultView as PreviewRealm | null)?.__hf;
  return hf?.unproxiedSrc ? hf.unproxiedSrc(el) : el.getAttribute("src");
}
