import type { CSSProperties } from "react";
import { RESIZE_HANDLE_HIT_PX } from "./domEditOverlayGeometry";

export type CropInset = { top: number; right: number; bottom: number; left: number };
const NO_CROP_INSET: CropInset = { top: 0, right: 0, bottom: 0, left: 0 };

/** A handle's place in the handles' wrapper, which sits exactly over the box. Each handle is pinned to its corner's
 *  edges, and a small box's outward slide is computed by CSS from the wrapper's own size, so a move that writes the
 *  wrapper's rect carries every handle with it. */
export function resizeHandleLayout(
  def: { x: "left" | "right"; y: "top" | "bottom"; cursor: string },
  overlayRect: { width: number; height: number },
  cropInset?: CropInset,
): { style: CSSProperties; anchor: CSSProperties } {
  const half = RESIZE_HANDLE_HIT_PX / 2;
  const inset = cropInset ?? NO_CROP_INSET;
  const slideOutToFreeMiddleX =
    (def.x === "left" ? -1 : 1) *
    Math.max(0, half - (overlayRect.width - inset.left - inset.right) / 4);
  const slideOutToFreeMiddleY =
    (def.y === "top" ? -1 : 1) *
    Math.max(0, half - (overlayRect.height - inset.top - inset.bottom) / 4);
  const slid = (edge: number, crossInsets: number) =>
    `calc(${edge - half}px - max(0px, ${half}px - (100% - ${crossInsets}px) / 4))`;
  return {
    style: {
      cursor: def.cursor,
      touchAction: "none",
      [def.x]: slid(inset[def.x], inset.left + inset.right),
      [def.y]: slid(inset[def.y], inset.top + inset.bottom),
    },
    anchor: { left: half - slideOutToFreeMiddleX, top: half - slideOutToFreeMiddleY },
  };
}

export function rotateHandleLayout(cropInset?: CropInset): CSSProperties {
  const inset = cropInset ?? NO_CROP_INSET;
  return {
    left: `calc(${inset.left}px + max(0px, 100% - ${inset.left + inset.right}px) / 2)`,
    top: `calc(100% - ${inset.bottom}px + 12px)`,
  };
}
