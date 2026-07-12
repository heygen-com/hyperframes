function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toHexByte(channel: number): string {
  return Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/** figma {r,g,b,a?} floats (0..1) → #RRGGBB, or rgba() when translucent. */
export function figmaColorToCss(value: unknown, extraOpacity = 1): string | null {
  if (!isRecord(value)) return null;
  const { r, g, b, a } = value;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return null;
  const alpha = (typeof a === "number" ? a : 1) * extraOpacity;
  if (alpha >= 1) return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  const c = (n: number) => Math.round(n * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Number(alpha.toFixed(4))})`;
}
