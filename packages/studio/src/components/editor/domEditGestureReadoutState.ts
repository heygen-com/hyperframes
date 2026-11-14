import { computeOverlayRootScale, type OverlayRootScale } from "./domEditOverlayBasis";
import type { OverlayRect } from "./domEditOverlayGeometry";
export type GestureReadoutSide = "below" | "right" | "left" | "above";

export interface GestureReadoutState {
  basis: OverlayRootScale;
  viewportWidth: number;
  viewportHeight: number;
  text: string;
  rect: OverlayRect;
  baseRect: OverlayRect;
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

function setReadout(readout: GestureReadoutState, rect: OverlayRect, text?: string): void {
  const { basis } = readout;
  const x = (rect.left - (basis.iframeRect.left - basis.overlayRect.left)) / basis.rootScaleX;
  const y = (rect.top - (basis.iframeRect.top - basis.overlayRect.top)) / basis.rootScaleY;
  readout.text = text ?? `X ${Math.round(x)} · Y ${Math.round(y)}`;
  readout.rect = rect;
}

export function updateGestureReadout(
  readout: GestureReadoutState | undefined,
  rect: OverlayRect,
  text?: string,
): void {
  if (readout) setReadout(readout, { ...rect, angle: readout.baseRect.angle }, text);
}

export function updateGestureReadoutAngle(
  readout: GestureReadoutState | undefined,
  angle: number,
  startAngle = 0,
): void {
  if (!readout) return;
  const turned = (readout.baseRect.angle ?? 0) + angle - startAngle;
  setReadout(readout, { ...readout.baseRect, angle: turned }, `↻ ${Math.round(angle)}°`);
}

export function updateGestureReadoutSize(
  readout: GestureReadoutState | undefined,
  rect: OverlayRect,
  size: { width: number; height: number },
): void {
  updateGestureReadout(readout, rect, `W ${Math.round(size.width)} · H ${Math.round(size.height)}`);
}
