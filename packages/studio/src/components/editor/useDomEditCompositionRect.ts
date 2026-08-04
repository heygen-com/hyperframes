import { useState, type MutableRefObject, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { createOverlayFrameLoop, type OverlayFrameLoop } from "./overlayFrameLoop";

export interface DomEditCompositionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

function sameRect(a: DomEditCompositionRect, b: DomEditCompositionRect): boolean {
  const d = (k: keyof DomEditCompositionRect) => Math.abs(a[k] - b[k]);
  return (
    d("left") < 0.5 &&
    d("top") < 0.5 &&
    d("width") < 0.5 &&
    d("height") < 0.5 &&
    d("scaleX") < 0.001 &&
    d("scaleY") < 0.001
  );
}

export function useDomEditCompositionRect({
  iframeRef,
  overlayRef,
  loopRef,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** Filled with this loop so the overlay can re-arm it; see DomEditOverlay. */
  loopRef: MutableRefObject<OverlayFrameLoop | null>;
}): DomEditCompositionRect {
  const [compRect, setCompRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
  });

  useMountEffect(() => {
    // Every input below changes on an observable event: the iframe or overlay
    // resizing, the preview stage's zoom/pan transform (written as `style` on
    // an ancestor of the iframe, so no ResizeObserver sees it), or the iframe
    // loading a different composition. Idle, this hook read layout twice and
    // queried the preview document once on every single frame, forever.
    //
    // Being armed IS the dirty flag now: each observer arms the loop, the loop
    // measures once and parks. `refreshOverlayGeometry` in DomEditOverlay arms
    // it for the events no observer here sees — chiefly React swapping the
    // iframe element, which the preview Player does on composition switch.
    let observed: HTMLIFrameElement | null = null;
    let loop: OverlayFrameLoop | null = null;
    const armLoop = () => loop?.arm();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(armLoop);
    const stageObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(armLoop);

    const observe = (iframe: HTMLIFrameElement | null) => {
      if (iframe === observed) return;
      observed?.removeEventListener("load", armLoop);
      resizeObserver?.disconnect();
      stageObserver?.disconnect();
      observed = iframe;
      if (!iframe) return;
      iframe.addEventListener("load", armLoop);
      resizeObserver?.observe(iframe);
      const overlayEl = overlayRef.current;
      if (overlayEl) resizeObserver?.observe(overlayEl);
      for (let node = iframe.parentElement; node; node = node.parentElement) {
        stageObserver?.observe(node, { attributes: true, attributeFilter: ["style", "class"] });
        if (node === document.body) break;
      }
    };

    // fallow-ignore-next-line complexity
    const update = (): boolean => {
      const iframe = iframeRef.current;
      observe(iframe);
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) return false;
      const iRect = iframe.getBoundingClientRect();
      const oRect = overlayEl.getBoundingClientRect();
      const left = iRect.left - oRect.left;
      const top = iRect.top - oRect.top;
      if (iRect.width <= 0 || iRect.height <= 0) return false;
      const doc = iframe.contentDocument;
      const root = doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement;
      const dw = Number.parseFloat(root?.getAttribute("data-width") ?? "");
      const dh = Number.parseFloat(root?.getAttribute("data-height") ?? "");
      const scaleX = dw > 0 ? iRect.width / dw : 1;
      const scaleY = dh > 0 ? iRect.height / dh : 1;
      const next = { left, top, width: iRect.width, height: iRect.height, scaleX, scaleY };
      setCompRect((prev) => (sameRect(prev, next) ? prev : next));
      return false;
    };

    loop = createOverlayFrameLoop(update);
    loopRef.current = loop;
    loop.arm();
    const started = loop;
    return () => {
      started.stop();
      loopRef.current = null;
      resizeObserver?.disconnect();
      stageObserver?.disconnect();
      observed?.removeEventListener("load", armLoop);
    };
  });

  return compRect;
}
