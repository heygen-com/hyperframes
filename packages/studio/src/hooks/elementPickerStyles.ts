import { getLogicalOpacity } from "../components/editor/domEditingDom";

export const PICKED_STYLE_PROPERTIES = [
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-size",
  "font-weight",
  "font-family",
  "color",
  "background-color",
  "background",
  "opacity",
  "border-radius",
  "transform",
  "z-index",
];

/** Read a subset of computed styles from an element in the iframe */
export function readComputedStyles(
  iframe: HTMLIFrameElement,
  selector: string,
): Record<string, string> {
  const styles: Record<string, string> = {};
  try {
    const doc = iframe.contentDocument;
    const el = doc?.querySelector(selector);
    if (!el) return styles;
    const computed = iframe.contentWindow?.getComputedStyle(el);
    if (!computed) return styles;

    for (const prop of PICKED_STYLE_PROPERTIES) {
      const val =
        prop === "opacity" ? getLogicalOpacity(el, computed) : computed.getPropertyValue(prop);
      if (val) styles[prop] = val;
    }
  } catch {
    /* cross-origin */
  }
  return styles;
}
