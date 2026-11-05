export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

export type MarqueeSelectionMode = "replace" | "add" | "subtract";

export interface MarqueeBand extends Rect {
  mode: MarqueeSelectionMode;
}

export interface MarqueeModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export function resolveMarqueeMode(
  modifiers: MarqueeModifiers,
  base: MarqueeSelectionMode = "replace",
): MarqueeSelectionMode {
  if (modifiers.altKey) return "subtract";
  if (modifiers.shiftKey) return "add";
  return base;
}
