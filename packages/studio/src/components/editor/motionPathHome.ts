import type { MotionPathHome } from "./motionPathGeometry";

// An element's computed transform translate: a group wrapper GSAP moved carries its offset here.
function transformTranslate(el: HTMLElement): { x: number; y: number } {
  const t = el.ownerDocument?.defaultView?.getComputedStyle(el).transform;
  if (!t || t === "none") return { x: 0, y: 0 };
  const m3 = t.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const v = m3[1].split(",").map(Number);
    return { x: v[12] || 0, y: v[13] || 0 };
  }
  const m = t.match(/matrix\(([^)]+)\)/);
  if (m) {
    const v = m[1].split(",").map(Number);
    return { x: v[4] || 0, y: v[5] || 0 };
  }
  return { x: 0, y: 0 };
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
  // GSAP's own cache, set once it owns the transform: asking GSAP folds a plain CSS translate into it.
  const cache = (el as { _gsap?: { xPercent?: unknown; yPercent?: unknown } })._gsap;
  const percent = (p: unknown) => (Number(p) || 0) / 100;
  const [px, py] = [percent(cache?.xPercent), percent(cache?.yPercent)];
  let x = left + el.offsetWidth * (0.5 + px);
  let y = top + el.offsetHeight * (0.5 + py);
  const { ax, ay } = growShares(el, px, py);
  if ((el.style.translate ?? "").includes("var(")) {
    x += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-x")) || 0;
    y += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-y")) || 0;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, ax, ay };
}
