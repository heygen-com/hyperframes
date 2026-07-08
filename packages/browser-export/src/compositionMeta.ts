export interface CompositionMeta {
  id: string | null;
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

export function findCompositionRoot(scope: ParentNode): Element | null {
  const asElement = scope as Element;
  if (
    typeof asElement.hasAttribute === "function" &&
    asElement.hasAttribute("data-composition-id")
  ) {
    return asElement;
  }
  return scope.querySelector("[data-composition-id]") ?? scope.querySelector("#root");
}

function parsePositiveNumber(value: string | null, fallback: number): number {
  const parsed = value == null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readCompositionMeta(root: Element): CompositionMeta {
  return {
    id: root.getAttribute("data-composition-id"),
    width: parsePositiveNumber(root.getAttribute("data-width"), DEFAULT_WIDTH),
    height: parsePositiveNumber(root.getAttribute("data-height"), DEFAULT_HEIGHT),
  };
}
