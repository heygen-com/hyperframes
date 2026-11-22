/**
 * The one matrix every overlay measure reads: each node's `rotate`, `scale` and `transform`, in CSS's
 * order, parsed and composed by the browser's `DOMMatrix`; null once a node or the chain leaves the plane. `translate`
 * never changes a shape (callers re-anchor to the measured box) and `DOMMatrix` refuses its `50%`.
 */

/** The composition's own root; the walk stops there rather than at the document. */
const COMPOSITION_ROOT_ATTR = "data-composition-id";

/** Computed `rotate` (`45deg`, `x 30deg`, `1 1 0 30deg`) as its transform function; "" for none. */
export function rotateFunction(value: string | undefined): string {
  const parts = value && value !== "none" ? value.trim().split(/\s+/) : [];
  const angle = parts.pop();
  if (!angle) return "";
  if (parts.length === 0) return `rotate(${angle})`;
  if (parts.length === 1) return `rotate${parts[0]!.toUpperCase()}(${angle})`;
  return `rotate3d(${parts.join(", ")}, ${angle})`;
}

/** Computed `scale` (`2`, `2 3`, `1 1 2`) as its transform function; "" for none. */
export function scaleFunction(value: string | undefined): string {
  const parts = value && value !== "none" ? value.trim().split(/\s+/) : [];
  if (parts.length === 0) return "";
  return `${parts.length === 3 ? "scale3d" : "scale"}(${parts.join(", ")})`;
}

function ownNodeTransform(
  node: HTMLElement,
  Matrix: typeof DOMMatrix,
  getStyle: (node: HTMLElement) => CSSStyleDeclaration | null,
): DOMMatrix | null {
  const style = getStyle(node);
  if (!style || inThreeDContext(node, getStyle)) return null;
  const transform = style.transform && style.transform !== "none" ? style.transform : "";
  const list = [rotateFunction(style.rotate), scaleFunction(style.scale), transform];
  try {
    const own = new Matrix(list.filter(Boolean).join(" "));
    return planar(own) ? own : null;
  } catch {
    return null;
  }
}

/** A parent's `perspective` or `preserve-3d` projects its children in ways a matrix product does not show. */
function inThreeDContext(
  node: HTMLElement,
  getStyle: (node: HTMLElement) => CSSStyleDeclaration | null,
) {
  const parent = node.parentElement && getStyle(node.parentElement);
  if (!parent) return false;
  return (
    (!!parent.perspective && parent.perspective !== "none") ||
    parent.transformStyle === "preserve-3d"
  );
}

/** Keeps the layer's plane flat and unprojected; anything else is left to the box the browser paints. */
const planar = (m: DOMMatrix) =>
  [m.m13, m.m23, m.m14, m.m24, m.m44 - 1].every((v) => Math.abs(v) < 1e-9);

/**
 * The element's transform composed with every ancestor's, up to the composition root; an ancestor
 * applies outside its child. Null when some node's transform cannot be parsed, so the caller falls back.
 *
 * `memo` holds each node's composed chain for a caller walking many elements in one synchronous pass:
 * siblings share everything above them. Valid only for that pass, which is why the caller owns it.
 */
export function composeElementTransform(
  element: HTMLElement,
  Matrix: typeof DOMMatrix,
  getStyle: (node: HTMLElement) => CSSStyleDeclaration | null,
  memo?: Map<HTMLElement, DOMMatrix | null>,
): DOMMatrix | null {
  const pending: HTMLElement[] = [];
  let above: DOMMatrix | null | undefined;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    above = memo?.get(node);
    if (above !== undefined) break;
    pending.push(node);
    if (node.hasAttribute(COMPOSITION_ROOT_ATTR)) break;
  }

  let acc: DOMMatrix | null = above === undefined ? new Matrix() : above;
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const node = pending[i]!;
    if (acc !== null) {
      const own = ownNodeTransform(node, Matrix, getStyle);
      const composed = own && acc.multiply(own);
      acc = composed && planar(composed) ? composed : null;
    }
    memo?.set(node, acc);
  }
  return acc;
}
