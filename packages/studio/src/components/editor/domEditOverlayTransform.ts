/**
 * One walk from an element up to its composition root, composing the transform
 * it actually paints under.
 *
 * The overlay measures an element's angle in two places — the selection box and
 * the crop frame — and they need different arithmetic: one works in DOMMatrix
 * because it goes on to transform corner points, the other in plain 2D
 * components because it only needs an angle and a scale. What they must never
 * differ on is *which* transforms count and in what order, because when they
 * disagree the chrome disagrees with itself: the selection box drawn at one
 * angle and the crop outline at another, on the same element.
 *
 * So the walk lives here once and takes the arithmetic as a parameter. Adding
 * an individual property CSS grew later — `translate`, `scale` — means adding
 * one step here and one method to each algebra, rather than finding both walks
 * and hoping.
 */

/** The composition's own root; the walk stops there rather than at the document. */
const COMPOSITION_ROOT_ATTR = "data-composition-id";

/**
 * The arithmetic the walk needs, whatever the caller's matrix type is.
 *
 * `fromTransform` returns null for a transform the caller cannot use — a
 * perspective matrix, say — which aborts the walk rather than composing a
 * matrix that describes something other than what is painted.
 */
export interface PlanarTransformOps<M> {
  identity(): M;
  fromTransform(value: string): M | null;
  fromRotate(degrees: number): M;
  /** `outer` applied around `inner`, as an ancestor composes over a child. */
  compose(outer: M, inner: M): M;
}

/**
 * The planar rotation in the CSS `rotate` property, in degrees.
 *
 * Computes to `none`, an angle (`-22deg`), or an axis plus an angle
 * (`0 0 1 -22deg`). Only a rotation about z stays in the overlay's plane; any
 * other axis is 3D and reports 0, which leaves the caller on its axis-aligned
 * fallback rather than drawing a box at a plausible-looking wrong angle.
 */
export function individualRotateDegrees(value: string | undefined): number {
  if (!value || value === "none") return 0;
  const parts = value.trim().split(/\s+/);
  const angle = parts.at(-1);
  if (!angle?.endsWith("deg")) return 0;
  if (parts.length === 4) {
    const [x, y, z] = parts;
    if (Number(x) !== 0 || Number(y) !== 0 || Math.abs(Number(z)) !== 1) return 0;
    const deg = Number.parseFloat(angle);
    return Number.isFinite(deg) ? deg * Math.sign(Number(z)) : 0;
  }
  if (parts.length !== 1) return 0;
  const deg = Number.parseFloat(angle);
  return Number.isFinite(deg) ? deg : 0;
}

/**
 * The element's transform composed with every ancestor's, up to the composition
 * root.
 *
 * Within a node, CSS applies the individual properties before `transform`, so
 * `rotate` composes on the left of it. Between nodes, an ancestor applies
 * outside its child. Null means some node's transform was unusable and the
 * caller should fall back rather than guess.
 */
export function composeElementTransform<M>(
  element: HTMLElement,
  ops: PlanarTransformOps<M>,
  getStyle: (node: HTMLElement) => CSSStyleDeclaration | null,
): M | null {
  let acc = ops.identity();
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getStyle(node);
    if (!style) return null;
    const transform = style.transform;
    let own = transform && transform !== "none" ? ops.fromTransform(transform) : ops.identity();
    if (!own) return null;
    const spin = individualRotateDegrees(style.rotate);
    if (spin !== 0) own = ops.compose(ops.fromRotate(spin), own);
    acc = ops.compose(own, acc);
    if (node.hasAttribute(COMPOSITION_ROOT_ATTR)) break;
  }
  return acc;
}
