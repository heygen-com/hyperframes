interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, "0");
}

export function parseCssColor(value: string): ParsedColor | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return {
      red: Number.parseInt(r + r, 16),
      green: Number.parseInt(g + g, 16),
      blue: Number.parseInt(b + b, 16),
      alpha: 1,
    };
  }

  const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      red: Number.parseInt(hex[1].slice(0, 2), 16),
      green: Number.parseInt(hex[1].slice(2, 4), 16),
      blue: Number.parseInt(hex[1].slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgba) {
    return {
      red: clampChannel(Number.parseFloat(rgba[1])),
      green: clampChannel(Number.parseFloat(rgba[2])),
      blue: clampChannel(Number.parseFloat(rgba[3])),
      alpha: clampAlpha(rgba[4] != null ? Number.parseFloat(rgba[4]) : 1),
    };
  }

  return null;
}

export function toColorPickerValue(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return "#000000";
  return `#${toHex(parsed.red)}${toHex(parsed.green)}${toHex(parsed.blue)}`;
}

export function mergeColorWithExistingAlpha(nextHex: string, previousValue: string): string {
  const hex = nextHex.trim();
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return previousValue;

  const previous = parseCssColor(previousValue);
  const red = Number.parseInt(match[1].slice(0, 2), 16);
  const green = Number.parseInt(match[1].slice(2, 4), 16);
  const blue = Number.parseInt(match[1].slice(4, 6), 16);
  const alpha = previous?.alpha ?? 1;

  if (alpha >= 1) {
    return `rgb(${red}, ${green}, ${blue})`;
  }

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
