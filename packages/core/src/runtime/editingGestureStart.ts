/**
 * What a drag or resize needs from the frame as it starts, in one read for the editing channel: each
 * pressed element's overlay geometry, layout size, how far it moves per px of translate, and GSAP's
 * x/y when GSAP owns its position; and the boxes it can snap to. A parent that cannot script the
 * frame takes these here rather than off the elements.
 */
import { isStylableElement, type StylableElement } from "./domRealm";
import type { EditingElementHandle } from "./editingElement";
import {
  computedTranslateAxes,
  measureGrowResponse,
  MIN_PROBE_RESPONSE,
  movedTranslate,
  PROBE_PX,
  type Grow,
} from "./drawnBox";
import { readCssRotationStart, type CssRotationStart } from "./editing/cssRotation";
import {
  boxOf,
  elementGeometry,
  readElementTransformSnapshot,
  snapCandidates,
  MAX_SNAP_TARGETS,
  type EditingElementBox,
  type EditingElementGeometry,
} from "./editingGeometry";
import { elementForHandle } from "./editingHandles";

export interface EditingGestureStart extends EditingElementGeometry {
  /** Frame px its centre moves per px of translate, columns `a, b` (x) and `c, d` (y); null when it does not move measurably. */
  move: { a: number; b: number; c: number; d: number } | null;
  /** Frame px its centre moves per px of drawn width, `a, b`, and height, `c, d`; null when it has no box. */
  grow: Grow;
  /** Set when GSAP owns its position: x/y, whether a tween moves it. `gsapAt`: read when null; 0, 0 with no GSAP. */
  gsap: { x: number; y: number; moving: boolean; drawsTranslate: true } | null;
  gsapAt: { x: number; y: number };
  /** GSAP's rotation now when it owns the element's turn; null when it turns by its own CSS `rotate`. */
  gsapRotation: number | null;
  cssRotation: CssRotationStart | null;
  planar: { a: number; b: number; c: number; d: number } | null;
}

type Point = { x: number; y: number };

/**
 * Frame px the element's centre moves per px of translate a draft draws, one column per axis
 * (`a, b` for x, `c, d` for y): every transform above it applied. Null when it has no box or does
 * not move measurably. Its inline translate is put back as it was.
 */
function measureMoveResponse(element: StylableElement): EditingGestureStart["move"] {
  const { style } = element;
  const value = style.getPropertyValue("translate");
  const priority = style.getPropertyPriority("translate");
  const base = computedTranslateAxes(element);
  const centre = (offset: Point): Point | null => {
    style.setProperty("translate", movedTranslate(base, offset));
    const { left, top, width, height } = element.getBoundingClientRect();
    return width > 0 || height > 0 ? { x: left + width / 2, y: top + height / 2 } : null;
  };
  try {
    const origin = centre({ x: 0, y: 0 });
    const alongX = centre({ x: PROBE_PX, y: 0 });
    const alongY = centre({ x: 0, y: PROBE_PX });
    if (!origin || !alongX || !alongY) return null;
    const column = (p: Point) => ({
      x: (p.x - origin.x) / PROBE_PX,
      y: (p.y - origin.y) / PROBE_PX,
    });
    const [x, y] = [column(alongX), column(alongY)];
    const usable = (p: Point) =>
      Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.x, p.y) >= MIN_PROBE_RESPONSE;
    return usable(x) && usable(y) ? { a: x.x, b: x.y, c: y.x, d: y.y } : null;
  } finally {
    if (value) style.setProperty("translate", value, priority);
    else style.removeProperty("translate");
  }
}

type GsapTween = {
  vars?: Record<string, unknown>;
  targets?: () => unknown[];
  duration?: () => number;
};
type GsapWindow = {
  gsap?: { getProperty?: (element: Element, property: string) => unknown };
  __timelines?: Record<string, { getChildren?: (nested?: boolean) => GsapTween[] } | undefined>;
};

// The channels Studio's move route and drag commit read as GSAP moving an element.
const POSITION = ["x", "y", "xPercent", "yPercent", "left", "top", "translateX", "translateY"];
export const MOVES = [...POSITION, "motionPath"];
const TURNS = [
  "rotation",
  "rotationX",
  "rotationY",
  "rotationZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
];

function carries(vars: Record<string, unknown>, channels: string[]): boolean {
  if (channels.some((channel) => channel in vars)) return true;
  const keyframes = vars.keyframes;
  if (!keyframes || typeof keyframes !== "object") return false;
  const steps = Array.isArray(keyframes) ? keyframes : [keyframes, ...Object.values(keyframes)];
  return steps.some(
    (step) =>
      !!step &&
      typeof step === "object" &&
      channels.some((channel) => Object.prototype.hasOwnProperty.call(step, channel)),
  );
}

function tweensOn(element: Element): GsapTween[] {
  const timelines = Object.values((window as GsapWindow).__timelines ?? {});
  return timelines.flatMap((timeline) =>
    (timeline?.getChildren?.(true) ?? []).filter((tween) =>
      (tween.targets?.() ?? []).some(
        (target) =>
          target === element || (!!element.id && (target as Element | null)?.id === element.id),
      ),
    ),
  );
}

export const rendersTransform = (element: Element) =>
  !!(element as { _gsap?: { renderTransform?: unknown } })._gsap?.renderTransform;

type Fields = Record<string, unknown>;
const isPlainFields = (value: unknown): value is Fields =>
  !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

function keptFields(fields: Fields, depth = 1): () => void {
  const values = { ...fields };
  const nested = depth > 0 ? Object.values(fields).filter(isPlainFields) : [];
  const inner = nested.map((value) => keptFields(value, depth - 1));
  return () => {
    for (const key of Object.keys(fields))
      if (!(key in values)) Reflect.deleteProperty(fields, key);
    Object.assign(fields, values);
    for (const restore of inner) restore();
  };
}

function keptAttributes(element: Element): () => void {
  const names = element.getAttributeNames();
  const attributes = new Map(names.map((name) => [name, element.getAttribute(name) ?? ""]));
  return () => {
    for (const name of element.getAttributeNames())
      if (!attributes.has(name)) element.removeAttribute(name);
    for (const [name, value] of attributes)
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
}

export function withoutGsapTakeover<T>(element: Element, read: () => T): T {
  if (rendersTransform(element)) return read();
  const host = element as { _gsap?: Fields };
  const cache = host._gsap;
  const restoreCache = cache ? keptFields(cache) : () => Reflect.deleteProperty(host, "_gsap");
  const restoreAttributes = keptAttributes(element);
  try {
    return read();
  } finally {
    restoreAttributes();
    restoreCache();
  }
}

export type EditingGestureBase = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  drawsProps?: true;
};

export function gestureBase(handle: EditingElementHandle): EditingGestureBase | null {
  const element = elementForHandle(handle);
  const gsap = (window as GsapWindow).gsap;
  if (!element) return null;
  if (!gsap?.getProperty) return { x: 0, y: 0, opacity: 1, scale: 1 };
  const read = (property: string) => Number(gsap.getProperty?.(element, property));
  const base = { x: read("x"), y: read("y"), opacity: read("opacity"), scale: read("scaleX") };
  return Object.values(base).every(Number.isFinite) ? { ...base, drawsProps: true } : null;
}

// Read only once GSAP owns it: asking GSAP for x makes it fold a CSS translate into its transform.
const readGsap = (element: Element, property: string) =>
  Number((window as GsapWindow).gsap?.getProperty?.(element, property)) || 0;

/** GSAP's x/y when it owns the element's position: it renders its transform, or a tween writes it. */
export function gsapPosition(element: Element): EditingGestureStart["gsap"] {
  const tweens = tweensOn(element).filter((tween) => tween.vars && carries(tween.vars, MOVES));
  if (!rendersTransform(element) && !tweens.length) return null;
  const moving = tweens.some((tween) => (tween.duration?.() ?? 0) > 0);
  return { x: readGsap(element, "x"), y: readGsap(element, "y"), moving, drawsTranslate: true };
}

function gsapRotation(element: Element): number | null {
  const turned = tweensOn(element).some((tween) => tween.vars && carries(tween.vars, TURNS));
  if (!rendersTransform(element) && !turned) return null;
  return withoutGsapTakeover(element, () => readGsap(element, "rotation"));
}

function planarOf(element: StylableElement): EditingGestureStart["planar"] {
  const matrix = readElementTransformSnapshot(window, element as HTMLElement)?.matrix;
  return matrix ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d } : null;
}

/** Each handle's gesture start, null as in `describe`, and the snap boxes of the page around them. */
export function gestureStart(handles: readonly EditingElementHandle[]): {
  elements: Array<EditingGestureStart | null>;
  snap: EditingElementBox[];
} {
  const pressed = handles.map(elementForHandle);
  const { elements } = elementGeometry(handles, undefined);
  const starts = elements.map((geometry, i) => {
    const element = pressed[i];
    if (!geometry || !isStylableElement(element)) return null;
    const rotation = gsapRotation(element);
    return {
      ...geometry,
      move: measureMoveResponse(element),
      grow: measureGrowResponse(element, geometry.layout),
      gsap: gsapPosition(element),
      gsapAt: withoutGsapTakeover(element, () => ({
        x: readGsap(element, "x"),
        y: readGsap(element, "y"),
      })),
      gsapRotation: rotation,
      cssRotation: rotation === null ? readCssRotationStart(element as HTMLElement) : null,
      planar: planarOf(element),
    };
  });
  const root = document.querySelector("[data-composition-id]") ?? document.documentElement;
  const exclude = new Set(pressed.filter((element): element is Element => !!element));
  const memo = new Map<HTMLElement, DOMMatrix | null>();
  const candidates = snapCandidates(root, exclude).slice(0, MAX_SNAP_TARGETS);
  const snap = candidates.map((element) => boxOf(element, memo));
  return { elements: starts, snap };
}
