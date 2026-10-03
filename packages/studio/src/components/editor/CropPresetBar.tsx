import { useEffect } from "react";
import type { ClipPathInsetSides } from "./clipPathHelpers";
import { CROP_ASPECT_PRESETS, centredCropInsets } from "./cropPresets";

interface CropPresetBarProps {
  left: number;
  top: number;
  drawnFrom: { left: number; top: number };
  elementWidth: number;
  elementHeight: number;
  /** Centred insets for a ratio, or `null` to remove the crop. */
  onApply: (insets: ClipPathInsetSides | null) => void;
  onDone: () => void;
}

const CHIP =
  "rounded-sm border border-white/20 px-1.5 py-0.5 text-[10px] text-white/85 hover:bg-white/10";

/** Free · aspect presets · Reset · Done, floating above the element being cropped. */
export function CropPresetBar({
  left,
  top,
  drawnFrom,
  elementWidth,
  elementHeight,
  onApply,
  onDone,
}: CropPresetBarProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);

  return (
    <div
      role="toolbar"
      aria-label="Crop presets"
      data-dom-edit-crop-bar="true"
      className="pointer-events-auto absolute z-20 flex gap-1 rounded-md border border-white/15 bg-neutral-900/95 p-1 shadow-lg"
      style={{
        left: `calc(${left}px + var(--hf-sel-x, ${drawnFrom.left}px) - ${drawnFrom.left}px)`,
        top: `max(4px, calc(${top - 34}px + var(--hf-sel-y, ${drawnFrom.top}px) - ${drawnFrom.top}px))`,
        transform: "translateX(-50%)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" className={CHIP} title="Drag the edges freely">
        Free
      </button>
      {CROP_ASPECT_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={CHIP}
          onClick={() => onApply(centredCropInsets(elementWidth, elementHeight, preset.ratio))}
        >
          {preset.label}
        </button>
      ))}
      <button type="button" className={CHIP} onClick={() => onApply(null)}>
        Reset
      </button>
      <button
        type="button"
        className="rounded-sm border border-studio-accent bg-studio-accent px-1.5 py-0.5 text-[10px] font-semibold text-black"
        onClick={onDone}
      >
        Done
      </button>
    </div>
  );
}
