import type { PointerEvent as ReactPointerEvent } from "react";
import type { OverlayRect } from "./domEditOverlayGeometry";

/** Rotate grab-handle above the selection. Anchors to the crop outline when
 *  the element is cropped so it stays next to what's visible on screen. */
export function DomEditRotateHandle({
  overlayRect,
  cropOutlineInsetPx,
  onStartRotate,
}: {
  overlayRect: OverlayRect;
  cropOutlineInsetPx?: { top: number; right: number; bottom: number; left: number };
  onStartRotate: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const inset = cropOutlineInsetPx ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const visibleLeft = overlayRect.left + inset.left;
  const visibleWidth = Math.max(0, overlayRect.width - inset.left - inset.right);
  const visibleTop = overlayRect.top + inset.top;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: visibleLeft + visibleWidth / 2,
        top: visibleTop - 34,
        width: 28,
        height: 34,
        transform: "translateX(-50%)",
      }}
    >
      <div className="absolute left-1/2 top-3 bottom-0 w-px -translate-x-1/2 bg-studio-accent/60" />
      <button
        type="button"
        className="pointer-events-auto absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full border border-studio-accent bg-studio-accent p-0 shadow-[0_0_0_2px_rgba(60,230,172,0.18)]"
        style={{ cursor: "grab", touchAction: "none" }}
        title="Rotate"
        aria-label="Rotate selection"
        onPointerDown={onStartRotate}
      />
    </div>
  );
}
