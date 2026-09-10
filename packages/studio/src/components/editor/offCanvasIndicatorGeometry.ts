import type React from "react";
import type { OffCanvasRect } from "./OffCanvasIndicators";
import { hugRectForElement } from "./domEditOverlayCrop";
import { computeOverlayRootScale, orientedGroupAwareOverlayRect } from "./domEditOverlayGeometry";
import { isElementComputedVisible } from "./domEditingElement";
import type { DomEditLayerWalkCache } from "./domEditLayerWalkCache";
import { collectDomEditLayerItems } from "./domEditingLayers";

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function offCanvasSignature(rects: OffCanvasRect[]): string {
  return rects
    .map(
      (rect) =>
        `${rect.key}:${rounded(rect.left)},${rounded(rect.top)},${rounded(rect.width)},${rounded(rect.height)},${rounded(rect.angle ?? 0)}`,
    )
    .join("|");
}

function extendsOutside(
  rect: Omit<OffCanvasRect, "key">,
  comp: { left: number; top: number; width: number; height: number },
): boolean {
  const radians = ((rect.angle ?? 0) * Math.PI) / 180;
  const halfWidth =
    (Math.abs(Math.cos(radians)) * rect.width + Math.abs(Math.sin(radians)) * rect.height) / 2;
  const halfHeight =
    (Math.abs(Math.sin(radians)) * rect.width + Math.abs(Math.cos(radians)) * rect.height) / 2;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return (
    centerX - halfWidth < comp.left ||
    centerX + halfWidth > comp.left + comp.width ||
    centerY - halfHeight < comp.top ||
    centerY + halfHeight > comp.top + comp.height
  );
}

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
  /** Reuses the previous rebuild's per-element derivations for the elements no
   *  mutation touched. Omitted (tests, one-off callers) => a full derivation. */
  walkCache?: DomEditLayerWalkCache,
): void {
  if (comp.width <= 0 || !doc) {
    sigRef.current = "";
    elementsRef.current = new Map();
    setRects([]);
    return;
  }

  const root = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.body;
  const acp = activeCompositionPath ?? "index.html";
  const items = collectDomEditLayerItems(
    root,
    { activeCompositionPath: acp, isMasterView: !acp || acp === "index.html" },
    undefined,
    walkCache,
  );
  // The iframe→overlay basis is a property of the composition and the canvas
  // zoom, not of the element, and this loop neither writes to the DOM nor lets
  // the canvas move under it — so it is resolved ONCE here instead of inside
  // every `orientedGroupAwareOverlayRect` call. Unhoisted it cost a
  // `querySelector("[data-composition-id]")` plus three layout reads per item,
  // which on a preview of a few hundred elements is the bulk of the rebuild.
  const scale = computeOverlayRootScale(overlay, iframe, doc);
  const rects: OffCanvasRect[] = [];
  const elMap = new Map<string, HTMLElement>();
  for (const item of items) {
    if (!isElementComputedVisible(item.element)) continue;
    // Groups use their members' union (where they actually render), so a group
    // whose members sit inside the canvas isn't flagged off-canvas by a stale
    // wrapper box. Crop-hug the result so an inset crop that keeps the visible
    // part on-canvas doesn't flag the element either.
    const base = orientedGroupAwareOverlayRect(overlay, iframe, item.element, scale);
    const r = base ? { ...base, ...hugRectForElement(base, item.element) } : null;
    if (!r) continue;
    // Any edge crossing the composition border → gray-zone indicator (the
    // in-canvas portion is clipped away below, so only the sliver shows).
    if (extendsOutside(r, comp)) {
      rects.push({
        key: item.key,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        angle: r.angle,
      });
      elMap.set(item.key, item.element);
    }
  }

  const nextSig = offCanvasSignature(rects);
  if (nextSig === sigRef.current) return;
  sigRef.current = nextSig;
  elementsRef.current = elMap;
  setRects(rects);
}
