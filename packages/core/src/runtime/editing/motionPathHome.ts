import { isHtmlElement } from "../domRealm";
import { isElementVisibleThroughAncestors } from "../editingGeometry";

/** The layer's centre with no animation, its size, and how far its centre moves per px it grows. */
export type MotionPathHome = { x: number; y: number; w: number; h: number; ax: number; ay: number };

const computedTransform = (el: HTMLElement): string =>
  el.ownerDocument?.defaultView?.getComputedStyle(el).transform ?? "none";

function matrixTranslate(transform: string): [string | undefined, string | undefined] {
  const match = /(matrix3d|matrix)\(([^)]+)\)/.exec(transform);
  const values = match?.[2]?.split(",") ?? [];
  return match?.[1] === "matrix3d" ? [values[12], values[13]] : [values[4], values[5]];
}

function transformTranslate(el: HTMLElement): { x: number; y: number } {
  const [x, y] = matrixTranslate(computedTransform(el));
  return { x: Number(x) || 0, y: Number(y) || 0 };
}

function cssTranslate(el: HTMLElement): [number, number] {
  const raw = el.ownerDocument?.defaultView?.getComputedStyle(el).translate ?? "none";
  const [x = "0", y = "0"] = raw === "none" ? [] : raw.split(" ");
  const px = (v: string, size: number) =>
    v.endsWith("%") ? (Number.parseFloat(v) / 100) * size : Number.parseFloat(v) || 0;
  return [px(x, el.offsetWidth), px(y, el.offsetHeight)];
}

/** Centre shift per px grown: 0.5 from a set left/top, -0.5 from a set right/bottom, plus the percent.
 *  ponytail: in-flow layers get 0 (layout may centre them); read their anchor if one draws off. */
function growShares(el: HTMLElement, px: number, py: number): { ax: number; ay: number } {
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  if (!style || !/^(absolute|fixed)$/.test(style.position)) return { ax: 0, ay: 0 };
  const map = el.computedStyleMap?.();
  const auto = (side: string) => String(map?.get(side) ?? "") === "auto";
  const share = (start: string, end: string) => (auto(start) && !auto(end) ? -0.5 : 0.5);
  return { ax: share("left", "right") + px, ay: share("top", "bottom") + py };
}

export function elementHome(el: HTMLElement): MotionPathHome {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    // Ancestor transforms (a group wrapper GSAP moved) shift where the layer renders; its own
    // transform is the animated offset the path itself draws, so it is left out.
    if (node !== el) {
      const t = transformTranslate(node);
      left += t.x;
      top += t.y;
    }
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent || parent.hasAttribute("data-composition-id")) break;
    node = parent;
  }
  // A translate composes once GSAP has parsed the layer; before, its parse sums translate and transform,
  // makes minus half the size xPercent -50 and folds the rest into x, which a path sets (_parseTransform).
  const cache = (
    el as { _gsap?: { x?: unknown; uncache?: unknown; xPercent?: unknown; yPercent?: unknown } }
  )._gsap;
  const parsed = cache !== undefined && "x" in cache && !cache.uncache;
  const [tx, ty] = cssTranslate(el);
  const share = (cached: unknown, t: number, size: number) =>
    parsed ? (Number(cached) || 0) / 100 : t && Math.round(size / 2) === Math.round(-t) ? -0.5 : 0;
  const own = parsed ? { x: 0, y: 0 } : transformTranslate(el);
  const [px, py] = [
    share(cache?.xPercent, tx + own.x, el.offsetWidth),
    share(cache?.yPercent, ty + own.y, el.offsetHeight),
  ];
  const x = left + el.offsetWidth * (0.5 + px) + (parsed ? tx : 0);
  const y = top + el.offsetHeight * (0.5 + py) + (parsed ? ty : 0);
  const { ax, ay } = growShares(el, px, py);
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, ax, ay };
}

// A depth element (matrix3d m44) renders 1/m44 larger, so its path's offsets travel 1/m44 further on screen.
export function transformWDivisor(el: HTMLElement): number {
  const t = el.ownerDocument?.defaultView?.getComputedStyle(el).transform;
  if (!t || !t.startsWith("matrix3d(")) return 1;
  const v = t.slice("matrix3d(".length, -1).split(",");
  const w = Number.parseFloat(v[15] ?? "");
  return Number.isFinite(w) && w > 0 ? w : 1;
}

export interface MotionPathFrameHome {
  home: MotionPathHome | null;
  /** 1/m44 of the element's own transform: how much a depth element magnifies its path. */
  perspective: number;
  visible: boolean;
  plugin: boolean;
}

export function motionPathHome(selector: string): MotionPathFrameHome {
  const plugin = Boolean((window as { MotionPathPlugin?: unknown }).MotionPathPlugin);
  const element = document.querySelector(selector);
  if (!isHtmlElement(element)) return { home: null, perspective: 1, visible: true, plugin };
  return {
    home: elementHome(element),
    perspective: 1 / transformWDivisor(element),
    visible: isElementVisibleThroughAncestors(element),
    plugin,
  };
}
