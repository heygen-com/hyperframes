export interface FloatingRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveFloatingPanelPosition(
  anchor: FloatingRect,
  viewport: FloatingSize,
  panel: FloatingSize,
  options?: { offset?: number; margin?: number },
): FloatingPosition {
  const offset = options?.offset ?? 8;
  const margin = options?.margin ?? 12;
  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const preferredLeft = anchor.left + anchor.width / 2 - panel.width / 2;
  const left = clamp(preferredLeft, margin, maxLeft);
  const belowTop = anchor.bottom + offset;
  const aboveTop = anchor.top - panel.height - offset;
  const fitsBelow = belowTop + panel.height <= viewport.height - margin;
  const fitsAbove = aboveTop >= margin;

  if (fitsBelow || !fitsAbove) {
    return {
      left,
      top: clamp(belowTop, margin, Math.max(margin, viewport.height - panel.height - margin)),
      placement: "bottom",
    };
  }

  return {
    left,
    top: clamp(aboveTop, margin, Math.max(margin, viewport.height - panel.height - margin)),
    placement: "top",
  };
}
