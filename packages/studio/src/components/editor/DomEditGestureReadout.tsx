import { useRef, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import type { GestureReadoutSide } from "./domEditGestureReadoutState";
import type { GestureState } from "./domEditOverlayGestures";
import { GAP_PX as TOOLBAR_GAP_PX, TOOLBAR_HEIGHT_PX } from "./InlineTextToolbar";
import { subscribeOverlayFrame } from "./overlayFrameLoop";

type ReadoutGesture = Pick<GestureState, "readout" | "travelled">;

interface DomEditGestureReadoutProps {
  gestureRef: RefObject<ReadoutGesture | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/** Clear of the element on every side the chip takes. */
const GAP_PX = 8;
/** h-8: the chip's height is fixed, so placing it needs no layout read. */
const CHIP_HEIGHT_PX = 32;
/** The chip's width is estimated from its text; only the side checks use it. */
const CHAR_PX = 8;
const CHIP_PADDING_PX = 36;

const SIDES: readonly GestureReadoutSide[] = ["below", "right", "left", "above"];

/** Below the element, else beside it, else above the toolbar's band; a side is kept while it still fits. */
function positionGestureReadout(
  label: HTMLDivElement,
  gesture: ReadoutGesture,
  text: string,
): void {
  const readout = gesture.readout;
  if (!readout) return;
  const bounds = readout.basis.overlayRect;
  const rect = readout.rect;
  const minX = Math.max(0, -bounds.left) + 4;
  const minY = Math.max(0, -bounds.top) + 4;
  const maxX = Math.min(bounds.width, readout.viewportWidth - bounds.left) - 4;
  const maxY = Math.min(bounds.height, readout.viewportHeight - bounds.top) - 4;
  const width = text.length * CHAR_PX + CHIP_PADDING_PX;
  const right = rect.left + rect.width;
  const middle = rect.top + rect.height / 2 - CHIP_HEIGHT_PX / 2;
  // The text toolbar sits above the element, or below it when the element is too near the top of the window.
  const toolbarBelow = bounds.top + rect.top - TOOLBAR_GAP_PX < TOOLBAR_HEIGHT_PX;
  const beside = middle >= minY && middle + CHIP_HEIGHT_PX <= maxY;
  const spots: Record<GestureReadoutSide, { x: number; y: number; fits: boolean }> = {
    below: {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height + GAP_PX,
      fits: !toolbarBelow && rect.top + rect.height + GAP_PX + CHIP_HEIGHT_PX <= maxY,
    },
    right: { x: right + GAP_PX, y: middle, fits: beside && right + GAP_PX + width <= maxX },
    left: { x: rect.left - GAP_PX, y: middle, fits: beside && rect.left - GAP_PX - width >= minX },
    above: {
      x: rect.left + rect.width / 2,
      y:
        rect.top -
        GAP_PX -
        (toolbarBelow ? 0 : TOOLBAR_GAP_PX + TOOLBAR_HEIGHT_PX) -
        CHIP_HEIGHT_PX,
      fits: true,
    },
  };
  const kept = readout.side && spots[readout.side].fits ? readout.side : undefined;
  const side = kept ?? SIDES.find((each) => spots[each].fits) ?? "above";
  readout.side = side;
  const spot = spots[side];
  const centred = side === "below" || side === "above";
  const x = centred ? Math.max(minX + width / 2, Math.min(maxX - width / 2, spot.x)) : spot.x;
  label.style.left = `${x}px`;
  label.style.top = `${Math.min(maxY - CHIP_HEIGHT_PX, Math.max(minY, spot.y))}px`;
  // CSS resolves the chip's own width, so centring and the left side need no layout read.
  label.style.transform = centred
    ? "translateX(-50%)"
    : side === "left"
      ? "translateX(-100%)"
      : "none";
}

/** "X 70 · Y 41" is two fields; each is a quiet label and a figure. */
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
