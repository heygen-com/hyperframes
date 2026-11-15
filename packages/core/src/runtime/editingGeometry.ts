/**
 * Where an element sits on screen, read in the frame's CSS pixels: the overlay geometry the editing
 * channel's `geometry` request answers with. Studio measures a frame it can script with these same
 * functions, so both kinds of frame draw an element's selection chrome by one rule.
 */
import { COLOR_GRADING_SOURCE_HIDDEN_ATTR } from "../colorGrading";
import { getLogicalOpacity } from "../studioPreviewMark";
import {
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_VALUE,
  type EditingElementHandle,
  type EditingRect,
} from "./editingElement";
import { elementForHandle } from "./editingHandles";
import { composeElementTransform, type PlanarTransformOps } from "./elementTransform";

export type EditingCorner = "nw" | "ne" | "sw" | "se";
export type EditingCorners = Record<EditingCorner, { x: number; y: number }>;

export interface EditingElementBox {
  rect: EditingRect;
  /** The rotation it paints under, in degrees; 0 below ROTATION_GATE_EPSILON_DEG. */
  angle: number;
  /** Set for a rotated element only. */
  corners: EditingCorners | null;
  /** The nearest source-file boundary's rect and declared `data-width`/`data-height`. */
  source: {
    width: number;
    height: number;
    declaredWidth: number | null;
    declaredHeight: number | null;
  } | null;
  /** Inline `clip-path`, else the computed one; null when longer than MAX_ELEMENT_VALUE. */
  clipPath: string | null;
}

export interface EditingElementGeometry extends EditingElementBox {
  /** It and every ancestor render: displayed, not hidden, not transparent. */
  visible: boolean;
  /** A `data-hf-group` wrapper's members' rects, up to MAX_ELEMENT_ENTRIES; null for other elements. */
  members: EditingRect[] | null;
}

export const MAX_GEOMETRY_CHILDREN = 60;

/** Below this the element reads as unrotated: matrix noise, not a rotation. */
export const ROTATION_GATE_EPSILON_DEG = 1e-4;

/** Does this node render AT ALL, ignoring what it inherits? Sole owner of the
 *  rule; the walk below only decides which nodes to ask it about. */
function elementRendersItself(win: Window, el: HTMLElement): boolean {
  const computed = win.getComputedStyle(el);
  if (computed.display === "none" || computed.visibility === "hidden") return false;
  const opacity = Number.parseFloat(getLogicalOpacity(el, computed));
  return !(
    Number.isFinite(opacity) &&
    opacity <= 0.01 &&
    !el.hasAttribute(COLOR_GRADING_SOURCE_HIDDEN_ATTR)
  );
}

/**
 * Does `el` render, given everything above it? `memo` serves one synchronous pass over many
 * elements, where siblings share their chain; the caller drops it after the pass.
 */
export function isElementVisibleThroughAncestors(
  el: HTMLElement,
  memo?: Map<HTMLElement, boolean>,
): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  // Up to the first node already answered for, then back down: a node needs its ancestors' answer.
  const pending: HTMLElement[] = [];
  let inherited = true;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const answered = memo?.get(node);
    if (answered !== undefined) {
      inherited = answered;
      break;
    }
    pending.push(node);
  }
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const node = pending[i]!;
    // Once an ancestor is out, its descendants are too: no style read for them.
    inherited = inherited && elementRendersItself(win, node);
    memo?.set(node, inherited);
  }
  return inherited;
}

export interface ElementTransformSnapshot {
  matrix: DOMMatrix;
  cs: CSSStyleDeclaration;
}

export function readElementTransformSnapshot(
  win: Window,
  element: HTMLElement,
  memo?: Map<HTMLElement, DOMMatrix | null>,
): ElementTransformSnapshot | null {
  const DOMMatrixCtor = (win as Window & typeof globalThis).DOMMatrix;
  if (!DOMMatrixCtor) return null;
  const cs = win.getComputedStyle(element);
  // The corner math transforms points, so this keeps the full matrix, translation included.
  const ops: PlanarTransformOps<DOMMatrix> = {
    identity: () => new DOMMatrixCtor(),
    fromTransform: (value) => new DOMMatrixCtor(value),
    fromRotate: (degrees) => new DOMMatrixCtor().rotateSelf(degrees),
    compose: (outer, inner) => outer.multiply(inner),
  };
  try {
    const matrix = composeElementTransform(
      element,
      ops,
      (node) => (node === element ? cs : win.getComputedStyle(node)),
      memo,
    );
    return matrix ? { matrix, cs } : null;
  } catch {
    return null;
  }
}

/** The matrix's rotation in degrees, clockwise positive: atan2(b, a), whatever its scale or skew. */
export function rotationDegreesFromMatrix(matrix: Pick<DOMMatrix, "a" | "b" | "c" | "d">): number {
  const a = Number.isFinite(matrix.a) ? matrix.a : 1;
  const b = Number.isFinite(matrix.b) ? matrix.b : 0;
  const c = Number.isFinite(matrix.c) ? matrix.c : 0;
  const d = Number.isFinite(matrix.d) ? matrix.d : 1;
  const fromX = (Math.atan2(b, a) * 180) / Math.PI;
  const determinant = a * d - b * c;
  // A reflection reads one basis direction 180° off; take the angle nearer zero, so a mirrored
  // element's rotate handle stays on its own side.
  const fromY = (Math.atan2(-c, d) * 180) / Math.PI;
  const deg = determinant < 0 && Math.abs(fromY) < Math.abs(fromX) ? fromY : fromX;
  return Number.isFinite(deg) ? deg : 0;
}

/**
 * The border box's corners as painted, in viewport px: each local corner through the transform,
 * then anchored by matching their bounding box to the element's real one. Null when unmeasurable.
 */
export function elementCornerPoints(
  win: Window,
  element: HTMLElement,
  { matrix, cs }: ElementTransformSnapshot,
): EditingCorners | null {
  const DOMPointCtor = (win as Window & typeof globalThis).DOMPoint;
  if (!DOMPointCtor) return null;
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  const originParts = cs.transformOrigin.split(" ").map((p) => Number.parseFloat(p));
  const ox = Number.isFinite(originParts[0]!) ? originParts[0]! : w / 2;
  const oy = Number.isFinite(originParts[1]!) ? originParts[1]! : h / 2;
  const rel = (lx: number, ly: number): { x: number; y: number } => {
    const p = matrix.transformPoint(new DOMPointCtor(lx - ox, ly - oy));
    return { x: p.x, y: p.y };
  };
  const relCorners = { nw: rel(0, 0), ne: rel(w, 0), se: rel(w, h), sw: rel(0, h) };
  const xs = [relCorners.nw.x, relCorners.ne.x, relCorners.se.x, relCorners.sw.x];
  const ys = [relCorners.nw.y, relCorners.ne.y, relCorners.se.y, relCorners.sw.y];
  const bcr = element.getBoundingClientRect();
  const dx = bcr.left - Math.min(...xs);
  const dy = bcr.top - Math.min(...ys);
  const at = (pt: { x: number; y: number }) => ({ x: pt.x + dx, y: pt.y + dy });
  return {
    nw: at(relCorners.nw),
    ne: at(relCorners.ne),
    se: at(relCorners.se),
    sw: at(relCorners.sw),
  };
}

const positive = (value: string | null) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const rectOf = (element: Element): EditingRect => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

function sourceOf(element: Element): EditingElementBox["source"] {
  const boundary = element.closest("[data-composition-file],[data-composition-src]");
  if (!boundary) return null;
  const { width, height } = boundary.getBoundingClientRect();
  return {
    width,
    height,
    declaredWidth: positive(boundary.getAttribute("data-width")),
    declaredHeight: positive(boundary.getAttribute("data-height")),
  };
}

function clipPathOf(element: HTMLElement): string | null {
  const value =
    element.style?.getPropertyValue("clip-path").trim() ||
    window.getComputedStyle(element).getPropertyValue("clip-path").trim();
  return value.length <= MAX_ELEMENT_VALUE ? value : null;
}

const finiteCorners = (corners: EditingCorners | null) =>
  corners && Object.values(corners).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ? corners
    : null;

export function boxOf(
  element: HTMLElement,
  memo: Map<HTMLElement, DOMMatrix | null>,
): EditingElementBox {
  const transform = readElementTransformSnapshot(window, element, memo);
  const turned = transform ? rotationDegreesFromMatrix(transform.matrix) : 0;
  const angle = Math.abs(turned) < ROTATION_GATE_EPSILON_DEG ? 0 : turned;
  const corners = angle && transform ? elementCornerPoints(window, element, transform) : null;
  return {
    rect: rectOf(element),
    angle,
    corners: finiteCorners(corners),
    source: sourceOf(element),
    clipPath: clipPathOf(element),
  };
}

export const MAX_SNAP_TARGETS = 80;
const NOT_SNAPPED = new Set(["script", "style", "link", "meta", "base", "template", "br", "wbr"]);

/**
 * The elements a moved box can snap to, in document order below `root`: each rendered element
 * outside `exclude`, not a nested composition's host, and not in a subtree that is hidden. Once
 * `max` are found no further subtree is entered; the children of one being walked are all listed.
 */
export function snapCandidates(
  root: Element,
  exclude: ReadonlySet<Element>,
  max = MAX_SNAP_TARGETS,
): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visible = new Map<HTMLElement, boolean>();
  const visit = (parent: Element) => {
    if (found.length >= max) return;
    for (const child of Array.from(parent.children)) {
      if (NOT_SNAPPED.has(child.tagName.toLowerCase())) continue;
      if (child.hasAttribute("data-composition-id") || exclude.has(child)) continue;
      const element = child as HTMLElement;
      if (!isElementVisibleThroughAncestors(element, visible)) continue;
      found.push(element);
      visit(element);
    }
  };
  visit(root);
  return found;
}

/** One entry per handle, null as in `describe`, and the boxes of `children`'s descendants. */
export function elementGeometry(
  handles: readonly EditingElementHandle[],
  children: EditingElementHandle | undefined,
): { elements: Array<EditingElementGeometry | null>; children: EditingElementBox[] | null } {
  const memo = new Map<HTMLElement, DOMMatrix | null>();
  const visible = new Map<HTMLElement, boolean>();
  const elements = handles.map((handle) => {
    const element = elementForHandle(handle) as HTMLElement | null;
    if (!element) return null;
    const members = element.hasAttribute("data-hf-group")
      ? Array.from(element.children).slice(0, MAX_ELEMENT_ENTRIES).map(rectOf)
      : null;
    return {
      ...boxOf(element, memo),
      visible: isElementVisibleThroughAncestors(element, visible),
      members,
    };
  });
  const parent = children === undefined ? null : elementForHandle(children);
  if (!parent) return { elements, children: null };
  const descendants = parent.querySelectorAll<HTMLElement>("*");
  const boxes =
    descendants.length <= MAX_GEOMETRY_CHILDREN
      ? Array.from(descendants, (child) => boxOf(child, memo))
      : [];
  return { elements, children: boxes };
}
