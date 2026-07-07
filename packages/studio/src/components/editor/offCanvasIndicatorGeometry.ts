import type * as React from "react";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { groupAwareOverlayRect } from "./domEditOverlayGeometry";
import { isElementComputedVisible } from "./domEditingElement";
import { collectDomEditLayerItems } from "./domEditingLayers";

/**
 * Recompute the off-canvas dashed indicators against the LIVE preview layout.
 * Driven by a MutationObserver on the preview document (see the caller) rather
 * than a React effect: the things that move an element — a manual drag committed
 * via an in-place soft reload, a playhead seek, an async font/media reflow — change
 * element positions with NO React signal to key an effect on, so the indicators
 * would otherwise stay stale at the element's old position. `sigRef` diffs the
 * result so state (and the re-render) only updates when the rects actually change.
 */
// fallow-ignore-next-line complexity
export function recomputeOffCanvasIndicators(
  iframe: HTMLIFrameElement,
  overlay: HTMLDivElement,
  doc: Document | null | undefined,
  comp: { left: number; top: number; width: number; height: number },
  activeCompositionPath: string | null,
  sigRef: React.MutableRefObject<string>,
  elementsRef: React.MutableRefObject<Map<string, HTMLElement>>,
  setRects: (rects: OffCanvasRect[]) => void,
): void {
  if (comp.width <= 0 || !doc) {
    if (sigRef.current !== "") {
      sigRef.current = "";
      elementsRef.current = new Map();
      setRects([]);
    }
    return;
  }
  const root = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.body;
  const acp = activeCompositionPath ?? "index.html";
  const items = collectDomEditLayerItems(root, {
    activeCompositionPath: acp,
    isMasterView: !acp || acp === "index.html",
  });
  const rects: OffCanvasRect[] = [];
  const elMap = new Map<string, HTMLElement>();
  for (const item of items) {
    if (!isElementComputedVisible(item.element)) continue;
    // Groups use their members' union (where they actually render), so a group
    // whose members sit inside the canvas isn't flagged off-canvas by a stale
    // wrapper box.
    const r = groupAwareOverlayRect(overlay, iframe, item.element);
    if (!r) continue;
    // Any edge crossing the composition border → gray-zone indicator (the
    // in-canvas portion is clipped away at render, so only the sliver shows).
    const extendsOutsideComp =
      r.left < comp.left ||
      r.left + r.width > comp.left + comp.width ||
      r.top < comp.top ||
      r.top + r.height > comp.top + comp.height;
    if (extendsOutsideComp) {
      rects.push({ key: item.key, left: r.left, top: r.top, width: r.width, height: r.height });
      elMap.set(item.key, item.element);
    }
  }
  const sig = rects
    .map(
      (r) =>
        `${r.key}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`,
    )
    .join("|");
  if (sig === sigRef.current) return;
  sigRef.current = sig;
  elementsRef.current = elMap;
  setRects(rects);
}
