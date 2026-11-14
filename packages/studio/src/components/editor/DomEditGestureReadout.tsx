import { useRef, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { placeChip } from "./domEditGestureReadoutPlacement";
import type { GestureState } from "./domEditOverlayGestures";
import { subscribeOverlayFrame } from "./overlayFrameLoop";

type ReadoutGesture = Pick<GestureState, "readout" | "travelled">;

interface DomEditGestureReadoutProps {
  gestureRef: RefObject<ReadoutGesture | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

function positionGestureReadout(
  label: HTMLDivElement,
  gesture: ReadoutGesture,
  text: string,
): void {
  const readout = gesture.readout;
  if (!readout) return;
  const placed = placeChip(readout, text);
  readout.side = placed.side;
  label.style.left = `${placed.left}px`;
  label.style.top = `${placed.top}px`;
  label.style.transform = placed.transform;
}

function renderFields(label: HTMLDivElement, text: string): void {
  const fields = text.split(" · ").flatMap((field, index) => {
    const [name = "", ...value] = field.split(" ");
    const cells = document.createElement("span");
    cells.className = "flex items-baseline gap-1.5";
    const key = document.createElement("span");
    key.className = "text-text-4";
    key.textContent = name;
    const figure = document.createElement("span");
    figure.className = "min-w-[4ch] text-right font-medium";
    figure.textContent = value.join(" ");
    cells.append(key, figure);
    if (index === 0) return [cells];
    const divider = document.createElement("span");
    divider.className = "h-3.5 w-px bg-border";
    return [divider, cells];
  });
  label.replaceChildren(...fields);
  label.dataset.readoutText = text;
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
      if (label.dataset.readoutText !== text) renderFields(label, text);
      label.style.display = "flex";
      positionGestureReadout(label, gesture, text);
    }),
  );
  return (
    <div
      ref={labelRef}
      aria-hidden="true"
      data-dom-edit-gesture-readout="true"
      className="pointer-events-none absolute z-50 flex h-8 items-center gap-2 rounded-lg border border-border bg-raised px-3 text-xs whitespace-nowrap text-studio-text tabular-nums shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
      style={{ display: "none" }}
    />
  );
}
