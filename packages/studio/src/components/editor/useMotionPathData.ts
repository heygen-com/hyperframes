import { useEffect, useRef, useState, type RefObject } from "react";
import { readRuntimeKeyframes } from "../../hooks/gsapRuntimeKeyframes";
import { isElementVisibleForOverlay } from "./domEditOverlayGeometry";
import { buildMotionPathGeometry, type MotionPathGeometry } from "./motionPathGeometry";

type Rect = { left: number; top: number; width: number; height: number };

export function elementHome(el: HTMLElement): { x: number; y: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
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
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const [geometry, setGeometry] = useState<MotionPathGeometry | null>(null);
  const resolvedForRef = useRef<string | null>(null);
  const geometryResolved = resolvedForRef.current === selector;
  const [visibleInPreview, setVisibleInPreview] = useState(true);
  const [home, setHome] = useState<{ x: number; y: number } | null>(null);

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
      const read = readRuntimeKeyframes(iframeRef.current, selector);
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

  return { rect, geometry, geometryResolved, visibleInPreview, home };
}
