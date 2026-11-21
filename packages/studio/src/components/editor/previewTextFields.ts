// Text fields of an element in a frame Studio cannot script, read from its runtime's descriptions.
import { previewComputedStyles } from "../../player/lib/previewChannel";
import { describePreviewElements, type PreviewElement } from "../../player/lib/previewElements";
import { isEditableTextLeaf, isHtmlElement } from "./domEditingDom";
import { collectDomEditTextFields } from "./domEditingLayers";
import { CURATED_STYLE_PROPERTIES, type DomEditTextField } from "./domEditingTypes";

let probeDocument: Document | undefined;

function probe(element: PreviewElement): HTMLElement {
  const doc = (probeDocument ??= document.implementation.createHTMLDocument(""));
  let el: HTMLElement;
  try {
    el = doc.createElement(element.tag);
  } catch {
    el = doc.createElement("div");
  }
  for (const [name, value] of element.attributes) {
    try {
      el.setAttribute(name, value);
    } catch {
      // A name the parser took but setAttribute refuses; no field reads such a name.
    }
  }
  for (const [name, value] of Object.entries(element.inlineStyles))
    el.style.setProperty(name, value);
  return el;
}

/** `collectDomEditTextFields` for the frame's element; none when any description was cut. */
export async function previewTextFields(
  iframe: HTMLIFrameElement,
  element: PreviewElement,
): Promise<DomEditTextField[]> {
  const handles = element.children.flatMap((child) => ("handle" in child ? [child.handle] : []));
  const described = handles.length ? await describePreviewElements(iframe, handles) : [];
  if (element.truncated || !described?.every((child) => child && !child.truncated)) return [];
  const root = probe(element);
  const handleOf = new Map<Element, string>([[root, element.handle]]);
  let next = 0;
  for (const child of element.children) {
    if ("text" in child) {
      root.append(child.text);
      continue;
    }
    const description = described[next++]!;
    const el = probe(description);
    if (description.children.some((grandchild) => "handle" in grandchild))
      el.append(el.ownerDocument.createElement("span"));
    else el.textContent = description.text;
    root.append(el);
    handleOf.set(el, description.handle);
  }
  const leaves = Array.from(root.children).filter(isHtmlElement).filter(isEditableTextLeaf);
  const fields = collectDomEditTextFields(root);
  let leaf = 0;
  const sources = fields.map((field): Element | undefined => {
    if (field.source === "self") return root;
    if (field.source === "child") return leaves[leaf++];
    return undefined;
  });
  return Promise.all(
    fields.map(async (field, index) => {
      const source = sources[index];
      const handle = source && handleOf.get(source);
      if (!handle) return field;
      const styles = await previewComputedStyles(iframe, { handle }, [...CURATED_STYLE_PROPERTIES]);
      return { ...field, computedStyles: styles ?? {} };
    }),
  );
}
