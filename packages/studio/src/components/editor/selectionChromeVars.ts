import type { OverlayRect } from "./domEditOverlayGeometry";

/** The selection chrome's geometry, as the custom properties its CSS positions every part from. */
export function selectionChromeVars(rect: OverlayRect): Record<`--${string}`, string> {
  return {
    "--hf-sel-x": `${rect.left}px`,
    "--hf-sel-y": `${rect.top}px`,
    "--hf-sel-w": `${rect.width}px`,
    "--hf-sel-h": `${rect.height}px`,
    "--hf-sel-angle": `${rect.angle ?? 0}deg`,
  };
}

/** A gesture's per-move update: one element's properties, no render of the overlay. */
export function writeSelectionChromeVars(chrome: HTMLElement, rect: OverlayRect): void {
  for (const [name, value] of Object.entries(selectionChromeVars(rect))) {
    chrome.style.setProperty(name, value);
  }
}

/** A gesture's rect between commits; what the chrome shows without a React render of the overlay. */
export interface OverlayRectDraft {
  get: () => OverlayRect | null;
  subscribe: (listener: () => void) => () => void;
}

export const NO_OVERLAY_RECT_DRAFT: OverlayRectDraft = {
  get: () => null,
  subscribe: () => () => {},
};
