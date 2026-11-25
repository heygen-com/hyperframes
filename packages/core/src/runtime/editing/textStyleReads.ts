// Reads a text toolbar takes from the frame's own stylesheets and fonts, for a parent that cannot reach its document.
import type { EditingElementHandle } from "../editingElement";
import { MAX_ELEMENT_VALUE } from "../editingElement";
import { elementForHandle } from "../editingHandles";

export const MAX_FONT_FACES = 256;

const cut = (value: string) => value.slice(0, MAX_ELEMENT_VALUE);

function sameOriginRules(): CSSRule[] {
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules];
    } catch {
      return [];
    }
  });
}

const isStyleRule = (rule: CSSRule): rule is CSSStyleRule => "selectorText" in rule;
const isFontFaceRule = (rule: CSSRule): rule is CSSFontFaceRule =>
  rule.cssText.startsWith("@font-face");

function matches(element: Element, selector: string) {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Each property's inline value, else the last same-origin rule's that matches; null for an unknown handle. */
export function authoredStyles({
  handle,
  properties,
}: {
  handle: EditingElementHandle;
  properties: string[];
}): { styles: Record<string, string> | null } {
  const element = elementForHandle(handle);
  if (!element) return { styles: null };
  const inline = (element as Partial<ElementCSSInlineStyle>).style;
  const rules = sameOriginRules().filter(isStyleRule);
  const styles: Record<string, string> = {};
  for (const name of properties) {
    const ruled = rules.filter(
      (rule) => rule.style.getPropertyValue(name) && matches(element, rule.selectorText),
    );
    const value = inline?.getPropertyValue(name) || ruled.at(-1)?.style.getPropertyValue(name);
    if (value) styles[name] = cut(value);
  }
  return { styles };
}

/** The families the document's fonts draw, and each same-origin `@font-face` rule's family and src. */
export function fontFaces(): {
  families: string[];
  ownFaces: Array<{ family: string; src: string }>;
} {
  const families = new Set<string>();
  for (const face of document.fonts ?? []) {
    if (families.size >= MAX_FONT_FACES) break;
    families.add(cut(face.family));
  }
  const ownFaces = sameOriginRules()
    .filter(isFontFaceRule)
    .slice(0, MAX_FONT_FACES)
    .map((rule) => ({
      family: cut(rule.style.getPropertyValue("font-family")),
      src: cut(rule.style.getPropertyValue("src")),
    }));
  return { families: [...families], ownFaces };
}
