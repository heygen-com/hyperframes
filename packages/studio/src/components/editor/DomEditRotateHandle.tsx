import type { PointerEvent as ReactPointerEvent } from "react";

/** Rotate handle 12px below the selection, past the bottom crop handle's hit strip, placed from the chrome's
 *  geometry variables and anchored to the crop outline when cropped. Presentation only: the rotation gesture
 *  measures pointer angles from the element CENTER (resolveDomEditRotationGesture), so its position doesn't
 *  affect the math. */
export function DomEditRotateHandle({
  cropOutlineInsetPx,
  onStartRotate,
}: {
  cropOutlineInsetPx?: { top: number; right: number; bottom: number; left: number };
  onStartRotate: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const inset = cropOutlineInsetPx ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const visibleCenterX = `var(--hf-sel-x) + ${inset.left}px + max(0px, var(--hf-sel-w) - ${inset.left + inset.right}px) / 2`;
  const visibleBottom = `var(--hf-sel-y) + var(--hf-sel-h) - ${inset.bottom}px`;
  return (
    <button
      type="button"
      className="pointer-events-auto absolute flex items-center justify-center border-0 bg-transparent p-0"
      style={{
        left: 0,
        top: 0,
        width: 22,
        height: 22,
        transform: `translate(calc(${visibleCenterX}), calc(${visibleBottom} + 12px)) translateX(-50%)`,
        touchAction: "none",
        // Closed-hand grab cursor: this handle is grabbed and dragged to rotate.
        cursor: "grabbing",
      }}
      title="Rotate"
      aria-label="Rotate selection"
      onPointerDown={onStartRotate}
    >
      <span className="pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-full border border-studio-accent/70 bg-studio-surface text-accent-ink shadow-[0_0_3px_rgba(0,0,0,0.45)]">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </span>
    </button>
  );
}
