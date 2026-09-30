import { create } from "zustand";

/** The clip the crop preset bar is open for, by timeline identity (`key ?? id`). */
interface CropPresetBarState {
  openFor: string | null;
  open: (clipIdentity: string) => void;
  close: () => void;
}

export const useCropPresetBarStore = create<CropPresetBarState>((set) => ({
  openFor: null,
  open: (clipIdentity) => set({ openFor: clipIdentity }),
  close: () => set({ openFor: null }),
}));

/**
 * The committed clip-path of an element whose crop the canvas handles have lifted to `none`
 * while it is selected, so readers of the live node still see the crop that will render.
 */
const liftedCrops = new WeakMap<Element, string>();

export function rememberLiftedCrop(element: Element, clipPath: string): void {
  liftedCrops.set(element, clipPath);
}

export function forgetLiftedCrop(element: Element): void {
  liftedCrops.delete(element);
}

export function committedClipPath(element: Element): string | null {
  return liftedCrops.get(element) ?? readInlineClipPath(element);
}

function readInlineClipPath(element: Element): string | null {
  const style = element.getAttribute("style") ?? "";
  const match = /(?:^|;)\s*clip-path\s*:\s*([^;]+)/i.exec(style);
  return match?.[1]?.trim() ?? null;
}
