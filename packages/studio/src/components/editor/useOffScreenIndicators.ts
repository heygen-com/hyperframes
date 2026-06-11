/**
 * Detects GSAP-animated elements whose center is outside the visible composition
 * area and returns edge-clamped indicator positions for each.
 */
import { useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

export interface OffScreenIndicator {
  key: string;
  elementId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CompRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

type TimelineLike = { getChildren?: (nested: boolean) => Array<{ targets?: () => Element[] }> };

function isHtmlElement(node: unknown): node is HTMLElement {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as HTMLElement).getBoundingClientRect === "function" &&
    typeof (node as HTMLElement).tagName === "string"
  );
}

function collectGsapTargetElements(iframe: HTMLIFrameElement): HTMLElement[] {
  const win = iframe.contentWindow as
    | (Window & { __timelines?: Record<string, TimelineLike> })
    | null;
  if (!win) return [];

  let timelines: Record<string, TimelineLike> | undefined;
  try {
    timelines = win.__timelines;
  } catch {
    return [];
  }
  if (!timelines) return [];

  const seen = new Set<HTMLElement>();
  for (const tl of Object.values(timelines)) {
    if (!tl?.getChildren) continue;
    try {
      for (const child of tl.getChildren(true)) {
        if (!child.targets) continue;
        for (const t of child.targets()) {
          if (isHtmlElement(t)) seen.add(t);
        }
      }
    } catch {
      // cross-origin or detached timeline — skip
    }
  }
  return Array.from(seen);
}

function indicatorsEqual(a: OffScreenIndicator[], b: OffScreenIndicator[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (
      ai.key !== bi.key ||
      Math.abs(ai.left - bi.left) > 0.5 ||
      Math.abs(ai.top - bi.top) > 0.5 ||
      Math.abs(ai.width - bi.width) > 0.5 ||
      Math.abs(ai.height - bi.height) > 0.5
    )
      return false;
  }
  return true;
}

export function useOffScreenIndicators({
  iframeRef,
  overlayRef,
  compRect,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  compRect: CompRect;
}): OffScreenIndicator[] {
  const [indicators, setIndicators] = useState<OffScreenIndicator[]>([]);
  const prevRef = useRef<OffScreenIndicator[]>([]);
  const compRectRef = useRef(compRect);
  compRectRef.current = compRect;

  useMountEffect(() => {
    let frame = 0;

    const update = () => {
      frame = requestAnimationFrame(update);

      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      const cr = compRectRef.current;
      if (!iframe || !overlayEl || cr.width <= 0 || cr.height <= 0) {
        if (prevRef.current.length > 0) {
          prevRef.current = [];
          setIndicators([]);
        }
        return;
      }

      const iframeRect = iframe.getBoundingClientRect();
      const overlayRect = overlayEl.getBoundingClientRect();

      const doc = iframe.contentDocument;
      const root =
        doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement ?? null;
      if (!root) return;

      const declaredWidth =
        Number.parseFloat(root.getAttribute("data-width") ?? "") || iframeRect.width;
      const declaredHeight =
        Number.parseFloat(root.getAttribute("data-height") ?? "") || iframeRect.height;
      const rootScaleX = iframeRect.width / declaredWidth;
      const rootScaleY = iframeRect.height / declaredHeight;

      const targets = collectGsapTargetElements(iframe);
      if (targets.length === 0) {
        if (prevRef.current.length > 0) {
          prevRef.current = [];
          setIndicators([]);
        }
        return;
      }

      // Composition bounds in overlay coordinates
      const compLeft = cr.left;
      const compTop = cr.top;
      const compRight = compLeft + cr.width;
      const compBottom = compTop + cr.height;

      const next: OffScreenIndicator[] = [];
      const keyCounts = new Map<string, number>();

      for (const el of targets) {
        if (!el.isConnected) continue;

        const elRect = el.getBoundingClientRect();
        if (elRect.width <= 0 && elRect.height <= 0) continue;

        // Element rect in overlay coordinates
        const elLeft = iframeRect.left - overlayRect.left + elRect.left * rootScaleX;
        const elTop = iframeRect.top - overlayRect.top + elRect.top * rootScaleY;
        const elW = elRect.width * rootScaleX;
        const elH = elRect.height * rootScaleY;

        // Check if the element is fully inside the composition
        if (
          elLeft >= compLeft &&
          elTop >= compTop &&
          elLeft + elW <= compRight &&
          elTop + elH <= compBottom
        ) {
          continue;
        }

        // Only elements with a real id attribute can be selected via getElementById
        if (!el.id) continue;
        const count = keyCounts.get(el.id) ?? 0;
        keyCounts.set(el.id, count + 1);
        const key = count > 0 ? `${el.id}:${count}` : el.id;
        next.push({
          key,
          elementId: el.id,
          left: elLeft,
          top: elTop,
          width: elW,
          height: elH,
        });
      }

      if (!indicatorsEqual(prevRef.current, next)) {
        prevRef.current = next;
        setIndicators(next);
      }
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  });

  return indicators;
}
