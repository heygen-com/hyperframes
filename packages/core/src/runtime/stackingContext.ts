export const ROOT_CSS_STACKING_CONTEXT_ID = "css:root";

const NON_NONE_STACKING_CONTEXT_PROPERTIES = [
  "backdrop-filter",
  "clip-path",
  "filter",
  "mask",
  "mask-border-source",
  "mask-image",
  "perspective",
  "rotate",
  "scale",
  "transform",
  "translate",
  "-webkit-mask-image",
] as const;
const STACKING_CONTEXT_WILL_CHANGE_PROPERTIES = new Set([
  ...NON_NONE_STACKING_CONTEXT_PROPERTIES,
  "contain",
  "isolation",
  "mask-border",
  "mix-blend-mode",
  "opacity",
]);
const Z_INDEXED_POSITIONS = new Set(["absolute", "relative"]);
const Z_INDEXED_PARENT_DISPLAYS = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
const CONTAINMENT_VALUES = new Set(["layout", "paint", "strict", "content"]);
const STACKING_CONTAINER_TYPES = new Set(["size", "inline-size"]);

function createsPositionedStackingContext(style: CSSStyleDeclaration): boolean {
  return style.position === "fixed" || style.position === "sticky";
}

function createsZIndexedStackingContext(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (style.zIndex === "auto" || style.zIndex === "") return false;
  if (Z_INDEXED_POSITIONS.has(style.position)) return true;
  const parentDisplay = element.parentElement
    ? element.ownerDocument.defaultView?.getComputedStyle(element.parentElement).display
    : null;
  return parentDisplay != null && Z_INDEXED_PARENT_DISPLAYS.has(parentDisplay);
}

function createsVisualEffectStackingContext(style: CSSStyleDeclaration): boolean {
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity < 1) return true;
  if (style.getPropertyValue("isolation") === "isolate") return true;
  const mixBlendMode = style.getPropertyValue("mix-blend-mode");
  if (mixBlendMode && mixBlendMode !== "normal") return true;
  return NON_NONE_STACKING_CONTEXT_PROPERTIES.some((property) => {
    const value = style.getPropertyValue(property);
    return value !== "" && value !== "none";
  });
}

function createsContainmentStackingContext(style: CSSStyleDeclaration): boolean {
  const contain = style.getPropertyValue("contain").split(/\s+/);
  if (contain.some((value) => CONTAINMENT_VALUES.has(value))) return true;
  return STACKING_CONTAINER_TYPES.has(style.getPropertyValue("container-type"));
}

function createsWillChangeStackingContext(style: CSSStyleDeclaration): boolean {
  return style
    .getPropertyValue("will-change")
    .split(",")
    .map((property) => property.trim())
    .some((property) => STACKING_CONTEXT_WILL_CHANGE_PROPERTIES.has(property));
}

function createsCssStackingContext(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (createsPositionedStackingContext(style)) return true;
  if (createsZIndexedStackingContext(element, style)) return true;
  if (createsVisualEffectStackingContext(style)) return true;
  if (createsContainmentStackingContext(style)) return true;
  return createsWillChangeStackingContext(style);
}

/** Stable within one DOM revision and unique even when authors duplicate ids. */
function cssStackingContextPath(element: Element): string {
  const indexes: number[] = [];
  let cursor: Element | null = element;
  while (cursor?.parentElement) {
    indexes.push(Array.prototype.indexOf.call(cursor.parentElement.children, cursor));
    cursor = cursor.parentElement;
  }
  return `css:${indexes.reverse().join(".")}`;
}

/**
 * Leaf z-index participates in the nearest ANCESTOR stacking context. Exclude
 * the leaf itself: an element that establishes a context still compares its own
 * z-index with siblings in its parent's context.
 */
export function resolveCssStackingContextId(node: Element): string {
  const win = node.ownerDocument.defaultView;
  if (!win) return ROOT_CSS_STACKING_CONTEXT_ID;
  let cursor = node.parentElement;
  while (cursor && cursor !== node.ownerDocument.documentElement) {
    try {
      if (createsCssStackingContext(cursor, win.getComputedStyle(cursor))) {
        return cssStackingContextPath(cursor);
      }
    } catch {
      return ROOT_CSS_STACKING_CONTEXT_ID;
    }
    cursor = cursor.parentElement;
  }
  return ROOT_CSS_STACKING_CONTEXT_ID;
}
