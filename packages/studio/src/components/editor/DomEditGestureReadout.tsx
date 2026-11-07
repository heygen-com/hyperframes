import { useRef, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import type { GestureState } from "./domEditOverlayGestures";
import { subscribeOverlayFrame } from "./overlayFrameLoop";

type ReadoutGesture = Pick<GestureState, "readout" | "travelled">;

interface DomEditGestureReadoutProps {
  gestureRef: RefObject<ReadoutGesture | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

function positionGestureReadout(label: HTMLDivElement, gesture: ReadoutGesture): void {
  const readout = gesture.readout;
  if (!readout) return;
  const bounds = readout.basis.overlayRect;
  const rect = readout.rect;
  const minX = Math.max(0, -bounds.left) + 4;
  const minY = Math.max(0, -bounds.top) + 4;
  const maxX = Math.min(bounds.width, readout.viewportWidth - bounds.left) - 4;
  const maxY = Math.min(bounds.height, readout.viewportHeight - bounds.top) - 4;
  const x = Math.max(minX, Math.min(maxX, rect.left + rect.width + 8));
  const y = Math.max(minY, Math.min(maxY, rect.top - 8));
  label.style.left = `${x}px`;
  label.style.top = `${y}px`;
  label.style.maxWidth = `${Math.max(0, maxX - minX)}px`;
  // CSS resolves the label's own size without a synchronous layout read after its text changes.
  label.style.transform = `translate(max(-100%, ${minX - x}px), max(-100%, ${minY - y}px))`;
}

export function DomEditGestureReadout({ gestureRef }: DomEditGestureReadoutProps) {
  const labelRef = useRef<HTMLDivElement | null>(null);
  useMountEffect(() =>
    subscribeOverlayFrame(() => {
      const label = labelRef.current;
      if (!label) return;
      const gesture = gestureRef.current;
      const text = gesture?.travelled && gesture.readout?.text;
      if (!gesture || !text) {
        label.style.display = "none";
        return;
      }
      if (label.textContent !== text) label.textContent = text;
      label.style.display = "block";
      positionGestureReadout(label, gesture);
    }),
  );
  return (
    <div
      ref={labelRef}
      aria-hidden="true"
      data-dom-edit-gesture-readout="true"
      className="pointer-events-none absolute z-50 overflow-hidden rounded bg-studio-surface px-2 py-1 font-mono text-xs whitespace-nowrap text-studio-text shadow-md"
      style={{ display: "none" }}
    />
  );
}
