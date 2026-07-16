// Mirrors legacy `propertyPanelStyleSections.tsx`'s `SelectField` "Style" options —
// the single source of truth for which border-style tokens are valid.
export const STROKE_STYLE_OPTIONS: string[] = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "groove",
  "ridge",
  "inset",
  "outset",
];

export function formatStrokeSummary(widthPx: number, style: string): string {
  return `${widthPx}px ${style}`;
}

export function parseStrokeSummary(text: string): { widthPx: number; style: string } | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s+(\S+)\s*$/.exec(text);
  if (!match) return null;
  const widthPx = Number.parseFloat(match[1]);
  const style = match[2];
  if (!Number.isFinite(widthPx) || !style) return null;
  return { widthPx, style };
}
