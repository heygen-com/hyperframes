export interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
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

function formatAlpha(value: number): string {
  return `${Math.round(clampAlpha(value) * 100) / 100}`;
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
  return toHexColor(parsed);
}

export function toHexColor(color: Pick<ParsedColor, "red" | "green" | "blue">): string {
  return `#${toHex(color.red)}${toHex(color.green)}${toHex(color.blue)}`;
}

export function formatCssColor(color: ParsedColor): string {
  const red = clampChannel(color.red);
  const green = clampChannel(color.green);
  const blue = clampChannel(color.blue);
  const alpha = clampAlpha(color.alpha);

  if (alpha >= 1) {
    return `rgb(${red}, ${green}, ${blue})`;
  }

  return `rgba(${red}, ${green}, ${blue}, ${formatAlpha(alpha)})`;
}

export function rgbToHsv(color: Pick<ParsedColor, "red" | "green" | "blue">): HsvColor {
  const red = clampChannel(color.red) / 255;
  const green = clampChannel(color.green) / 255;
  const blue = clampChannel(color.blue) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  if (hue < 0) hue += 360;

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function hsvToRgb(color: HsvColor): Pick<ParsedColor, "red" | "green" | "blue"> {
  const hue = (((color.hue % 360) + 360) % 360) / 60;
  const saturation = Math.max(0, Math.min(1, color.saturation));
  const value = Math.max(0, Math.min(1, color.value));
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue >= 0 && hue < 1) {
    red = chroma;
    green = x;
  } else if (hue >= 1 && hue < 2) {
    red = x;
    green = chroma;
  } else if (hue >= 2 && hue < 3) {
    green = chroma;
    blue = x;
  } else if (hue >= 3 && hue < 4) {
    green = x;
    blue = chroma;
  } else if (hue >= 4 && hue < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    red: clampChannel((red + m) * 255),
    green: clampChannel((green + m) * 255),
    blue: clampChannel((blue + m) * 255),
  };
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

  return formatCssColor({ red, green, blue, alpha });
}
