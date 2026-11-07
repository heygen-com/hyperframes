import { computeOverlayRootScale, type OverlayRootScale } from "./domEditOverlayBasis";
import type { OverlayRect } from "./domEditOverlayGeometry";

export interface GestureReadoutState {
  basis: OverlayRootScale;
  viewportWidth: number;
  viewportHeight: number;
  text: string;
  rect: OverlayRect;
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
  readout.text = text ?? `Canvas X ${Math.round(x)} · Y ${Math.round(y)}`;
  readout.rect = rect;
}

export function updateGestureReadoutAngle(
  readout: GestureReadoutState | undefined,
  angle: number,
): void {
  if (readout) updateGestureReadout(readout, readout.rect, `${Math.round(angle)}°`);
}

export function updateGestureReadoutSize(
  readout: GestureReadoutState | undefined,
  rect: OverlayRect,
  size: { width: number; height: number },
): void {
  updateGestureReadout(readout, rect, `${Math.round(size.width)} × ${Math.round(size.height)}`);
}
