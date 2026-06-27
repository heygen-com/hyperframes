import { useEffect, useRef, useState, type RefObject } from "react";
import { readRuntimeKeyframes } from "../../hooks/gsapRuntimeKeyframes";
import { isElementVisibleForOverlay } from "./domEditOverlayGeometry";
import { buildMotionPathGeometry, type MotionPathGeometry } from "./motionPathGeometry";

type Rect = { left: number; top: number; width: number; height: number };

// The translate (e/f) components of an element's computed transform, in comp px.
// A group wrapper dragged via GSAP carries its offset here, not in offsetLeft/Top.
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

// Perspective foreshortening of the element's OWN transform (matrix3d m44). A
// depth element (translateZ toward the viewer) renders 1/m44× larger, so its
// animated x/y offsets travel 1/m44× further on screen than the flat preview
// scale implies. Returns 1 for 2D transforms. The motion path magnifies its
// offset points by 1/m44 (and de-magnifies pointer→offset) so the drawn path and
// its draggable nodes track the projected element instead of drifting off it.
export function transformWDivisor(el: HTMLElement): number {
  const t = el.ownerDocument?.defaultView?.getComputedStyle(el).transform;
  if (!t || !t.startsWith("matrix3d(")) return 1;
  const v = t.slice("matrix3d(".length, -1).split(",");
  const w = Number.parseFloat(v[15] ?? "");
  return Number.isFinite(w) && w > 0 ? w : 1;
}

export function elementHome(el: HTMLElement): { x: number; y: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    // Ancestor transforms (e.g. a group wrapper moved via GSAP) shift where the
    // element actually renders, so the path must anchor on top of them. The element's
    // OWN transform is excluded — that's the animated offset the path itself draws.
    if (node !== el) {
      const t = transformTranslate(node);
      left += t.x;
      top += t.y;
    }
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent || parent.hasAttribute("data-composition-id")) break;
    node = parent;
  }
  let x = left + el.offsetWidth / 2;
  let y = top + el.offsetHeight / 2;
  if ((el.style.translate ?? "").includes("var(")) {
    x += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-x")) || 0;
    y += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-y")) || 0;
  }
  return { x, y };
}

export function isPreviewHtmlElement(
  node: Element | null | undefined,
  iframe: HTMLIFrameElement | null,
): node is HTMLElement {
  const Ctor = (iframe?.contentWindow as unknown as { HTMLElement?: typeof HTMLElement } | null)
    ?.HTMLElement;
  return Boolean(node && Ctor && node instanceof Ctor);
}

function rectsClose(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function hasMotionPathPlugin(iframe: HTMLIFrameElement | null): boolean {
  try {
    return Boolean(
      (iframe?.contentWindow as unknown as { MotionPathPlugin?: unknown })?.MotionPathPlugin,
    );
  } catch {
    return false;
  }
}

export function useMotionPathData(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  selector: string | null,
): {
  rect: Rect | null;
  geometry: MotionPathGeometry | null;
  geometryResolved: boolean;
  visibleInPreview: boolean;
  home: { x: number; y: number } | null;
  pScale: number;
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const [geometry, setGeometry] = useState<MotionPathGeometry | null>(null);
  const resolvedForRef = useRef<string | null>(null);
  const geometryResolved = resolvedForRef.current === selector;
  const [visibleInPreview, setVisibleInPreview] = useState(true);
  const [home, setHome] = useState<{ x: number; y: number } | null>(null);
  // Perspective magnification (1/m44) of the selected element — applied to the
  // path's offset points so depth (translateZ) elements' paths track on screen.
  const [pScale, setPScale] = useState(1);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      setHome(null);
      return;
    }
    setHome(null);
    let raf = 0;
    const tick = () => {
      const el = iframeRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const surface = el.ownerDocument?.querySelector("[data-preview-pan-surface]");
        const sRect = surface?.getBoundingClientRect();
        const next = {
          left: sRect ? r.left - sRect.left : r.left,
          top: sRect ? r.top - sRect.top : r.top,
          width: r.width,
          height: r.height,
        };
        setRect((prev) => (prev && rectsClose(prev, next) ? prev : next));
        let target: Element | null = null;
        try {
          target = el.contentDocument?.querySelector(selector) ?? null;
        } catch {
          /* cross-origin guard */
        }
        const live = isPreviewHtmlElement(target, el) ? target : null;
        const vis = live ? isElementVisibleForOverlay(live) : true;
        setVisibleInPreview((prev) => (prev === vis ? prev : vis));
        if (live) {
          const h = elementHome(live);
          setHome((prev) =>
            prev && Math.abs(prev.x - h.x) < 0.5 && Math.abs(prev.y - h.y) < 0.5 ? prev : h,
          );
          const ps = 1 / transformWDivisor(live);
          setPScale((p) => (Math.abs(p - ps) < 0.001 ? p : ps));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selector, iframeRef]);

  useEffect(() => {
    if (!selector) {
      setGeometry(null);
      return;
    }
    const recompute = () => {
      // Position-only: never let a co-located size/scale tween shadow the path.
      const read = readRuntimeKeyframes(iframeRef.current, selector, undefined, ["x", "y"]);
      const next = buildMotionPathGeometry(read);
      setGeometry((prev) =>
        prev?.points === next?.points && prev?.kind === next?.kind ? prev : next,
      );
      resolvedForRef.current = selector;
    };
    recompute();
    const id = window.setInterval(recompute, 250);
    return () => window.clearInterval(id);
  }, [selector, iframeRef]);

  return { rect, geometry, geometryResolved, visibleInPreview, home, pScale };
}
