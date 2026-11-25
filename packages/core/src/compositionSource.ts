export const COMPOSITION_SRC_ATTR = "data-composition-src";

export const CODE_LOADING_ATTRS: ReadonlySet<string> = new Set([COMPOSITION_SRC_ATTR]);

const COMPOSITION_FILE_ATTR = "data-composition-file";
export const SOURCE_HOST_ATTRS = [COMPOSITION_FILE_ATTR, COMPOSITION_SRC_ATTR] as const;

export const COMPOSITION_ROOT_ATTRS = [
  "data-composition-id",
  "data-hf-original-composition-id",
] as const;

function nextInDocumentOrder(element: Element, root: ParentNode): Element | null {
  if (element.firstElementChild) return element.firstElementChild;
  for (let at: Element | null = element; at && at !== root; at = at.parentElement)
    if (at.nextElementSibling) return at.nextElementSibling;
  return null;
}

export function dropAuthoredCompositionFiles(root: ParentNode): void {
  for (let el = root.firstElementChild; el; el = nextInDocumentOrder(el, root)) {
    for (const name of el.getAttributeNames())
      if (name.toLowerCase() === COMPOSITION_FILE_ATTR) el.removeAttribute(name);
    const browserTemplateContent =
      el.localName === "template" && !el.hasChildNodes()
        ? (el as { content?: ParentNode }).content
        : null;
    if (browserTemplateContent) dropAuthoredCompositionFiles(browserTemplateContent);
  }
}
