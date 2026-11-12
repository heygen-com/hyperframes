import { parsePx } from "./domEditingDom";

const COMPOSITION_ROOT_LAYER_EPSILON_PX = 1;

function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function approximatelyEqual(a: number, b: number) {
  return Math.abs(a - b) <= COMPOSITION_ROOT_LAYER_EPSILON_PX;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CompositionRootFacts {
  rect: Box;
  width: string | null;
  height: string | null;
}

export function coversCompositionRoot(
  layer: { rect: Box; computedStyles: Record<string, string> },
  root: CompositionRootFacts | null,
): boolean {
  if (isExplicitFullBleedLayer(layer.computedStyles)) return false;
  const rootWidth = readPositiveDimension(root?.width ?? null);
  const rootHeight = readPositiveDimension(root?.height ?? null);
  if (!root || !rootWidth || !rootHeight) return false;
  const width = layer.rect.width || parsePx(layer.computedStyles.width);
  const height = layer.rect.height || parsePx(layer.computedStyles.height);
  return Boolean(
    width &&
    height &&
    approximatelyEqual(layer.rect.left, root.rect.left) &&
    approximatelyEqual(layer.rect.top, root.rect.top) &&
    approximatelyEqual(width, rootWidth) &&
    approximatelyEqual(height, rootHeight),
  );
}

function isExplicitFullBleedLayer(computedStyles: Record<string, string>) {
  return computedStyles.position === "absolute" || computedStyles.position === "fixed";
}

export function isCompositionRootLayer(
  element: HTMLElement,
  doc: Document,
  computedStyles: Record<string, string>,
) {
  if (element.parentElement !== doc.body) return false;
  if (element.hasAttribute("data-hf-allow-root-edit")) return false;
  const root =
    doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement ?? null;
  return coversCompositionRoot(
    { rect: element.getBoundingClientRect(), computedStyles },
    root && {
      rect: root.getBoundingClientRect(),
      width: root.getAttribute("data-width"),
      height: root.getAttribute("data-height"),
    },
  );
}
