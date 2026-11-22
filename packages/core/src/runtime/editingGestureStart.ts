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
  movedTranslate,
  SIZE_PROPERTIES,
  writeDrawnSize,
} from "./editingDraft";
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
  grow: { a: number; b: number; c: number; d: number } | null;
  /** Set when GSAP owns its position: its x/y now, and whether a tween with a duration moves it. */
  gsap: { x: number; y: number; moving: boolean } | null;
  /** GSAP's rotation now when it owns the element's turn; null when it turns by its own CSS `rotate`. */
  gsapRotation: number | null;
  cssRotation: CssRotationStart | null;
  planar: { a: number; b: number; c: number; d: number } | null;
}

const PROBE_PX = 100;
const MIN_PROBE_RESPONSE = 0.01;
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

/** Where its centre goes as a draft draws its size, so a resize can pin it; its inline size put back. */
function measureGrowResponse(
  element: StylableElement,
  layout: { width: number; height: number },
): EditingGestureStart["grow"] {
  const { style } = element;
  const kept = SIZE_PROPERTIES.map(
    (name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const,
  );
  const centre = (width: number, height: number): Point | null => {
    writeDrawnSize(style, { width, height });
    const box = element.getBoundingClientRect();
    return box.width > 0 || box.height > 0
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : null;
  };
  try {
    if (layout.width < 1 || layout.height < 1) return null;
    const origin = centre(layout.width, layout.height);
    const wider = centre(layout.width + PROBE_PX, layout.height);
    const taller = centre(layout.width, layout.height + PROBE_PX);
    if (!origin || !wider || !taller) return null;
    const per = (p: Point) => [(p.x - origin.x) / PROBE_PX, (p.y - origin.y) / PROBE_PX];
    const [[a, b], [c, d]] = [per(wider), per(taller)] as [number[], number[]];
    return [a, b, c, d].every(Number.isFinite) ? { a: a!, b: b!, c: c!, d: d! } : null;
  } finally {
    for (const [name, value, priority] of kept) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
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
const MOVES = [...POSITION, "motionPath"];
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

const rendersTransform = (element: Element) =>
  !!(element as { _gsap?: { renderTransform?: unknown } })._gsap?.renderTransform;
// Read only once GSAP owns it: asking GSAP for x makes it fold a CSS translate into its transform.
const readGsap = (element: Element, property: string) =>
  Number((window as GsapWindow).gsap?.getProperty?.(element, property)) || 0;

/** GSAP's x/y when it owns the element's position: it renders its transform, or a tween writes it. */
function gsapPosition(element: Element): EditingGestureStart["gsap"] {
  const tweens = tweensOn(element).filter((tween) => tween.vars && carries(tween.vars, MOVES));
  if (!rendersTransform(element) && !tweens.length) return null;
  const moving = tweens.some((tween) => (tween.duration?.() ?? 0) > 0);
  return { x: readGsap(element, "x"), y: readGsap(element, "y"), moving };
}

function gsapRotation(element: Element): number | null {
  const turned = tweensOn(element).some((tween) => tween.vars && carries(tween.vars, TURNS));
  return rendersTransform(element) || turned ? readGsap(element, "rotation") : null;
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
