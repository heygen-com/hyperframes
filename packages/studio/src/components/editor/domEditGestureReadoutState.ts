import { computeOverlayRootScale, type OverlayRootScale } from "./domEditOverlayBasis";
import type { OverlayRect } from "./domEditOverlayGeometry";

/** Where the chip sits against the element, in the order it is tried. */
export type GestureReadoutSide = "below" | "right" | "left" | "above";

export interface GestureReadoutState {
  basis: OverlayRootScale;
  viewportWidth: number;
  viewportHeight: number;
  /** The chip's fields, joined by " · ": "X 70 · Y 41", "W 100 · H 60", or "↻ 32°". */
  text: string;
  rect: OverlayRect;
  /** The rect at the start of the gesture; a rotation is measured from it. */
  baseRect: OverlayRect;
  /** The side the chip took. It keeps it for the whole gesture while it still fits, so it does not hop. */
  side?: GestureReadoutSide;
}

export function createGestureReadout(
  overlay: HTMLDivElement | null,
  iframe: HTMLIFrameElement | null,
  rect: OverlayRect,
): GestureReadoutState | undefined {
  const basis =
    overlay && iframe && computeOverlayRootScale(overlay, iframe, iframe.contentDocument);
  if (!basis || basis.rootScaleX <= 0 || basis.rootScaleY <= 0) return undefined;
  return {
    basis,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    text: "",
    rect,
    baseRect: rect,
  };
}

export function updateGestureReadout(
  readout: GestureReadoutState | undefined,
  rect: OverlayRect,
  text?: string,
): void {
  if (!readout) return;
  const { basis } = readout;
  const x = (rect.left - (basis.iframeRect.left - basis.overlayRect.left)) / basis.rootScaleX;
  const y = (rect.top - (basis.iframeRect.top - basis.overlayRect.top)) / basis.rootScaleY;
  readout.text = text ?? `X ${Math.round(x)} · Y ${Math.round(y)}`;
  readout.rect = rect;
}

/** While rotating, the chip clears the rotated box, which is wider and taller than the element's own rect. */
export function updateGestureReadoutAngle(
  readout: GestureReadoutState | undefined,
  angle: number,
): void {
  if (!readout) return;
  const { left, top, width, height } = readout.baseRect;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = width * cos + height * sin;
  const rotatedHeight = width * sin + height * cos;
  const rotated = {
    ...readout.baseRect,
    left: left + (width - rotatedWidth) / 2,
    top: top + (height - rotatedHeight) / 2,
    width: rotatedWidth,
    height: rotatedHeight,
  };
  updateGestureReadout(readout, rotated, `↻ ${Math.round(angle)}°`);
}

export function updateGestureReadoutSize(
  readout: GestureReadoutState | undefined,
  rect: OverlayRect,
  size: { width: number; height: number },
): void {
  updateGestureReadout(readout, rect, `W ${Math.round(size.width)} · H ${Math.round(size.height)}`);
}
