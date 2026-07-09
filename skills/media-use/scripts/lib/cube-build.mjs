const DEFAULT_SIZE = 33;
const MAX_SIZE = 64;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

function clampUnit(value) {
  return clamp(value, 0, 1);
}

function readParam(params, key, min, max) {
  return clamp(Number(params?.[key] ?? 0), min, max);
}

function luma([r, g, b]) {
  // Rec.709 luma weightings (matches the color space the grading runtime uses).
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function smoothstep(edge0, edge1, value) {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function applyLiftGain(color, params) {
  const y = luma(color);
  const blacks = readParam(params, "blacks", -1, 1);
  const shadows = readParam(params, "shadows", -1, 1);
  const highlights = readParam(params, "highlights", -1, 1);
  const whites = readParam(params, "whites", -1, 1);
  const shadowMask = 1 - smoothstep(0.18, 0.62, y);
  const highlightMask = smoothstep(0.38, 0.82, y);
  const offset =
    blacks * 0.08 + shadows * 0.12 * shadowMask + highlights * 0.12 * highlightMask + whites * 0.08;
  return color.map((channel) => clampUnit(channel + offset));
}

function applyExposure(color, params) {
  const exposure = readParam(params, "exposure", -2, 2);
  const gain = 2 ** exposure;
  const lift = Math.max(0, exposure) * 0.015;
  return color.map((channel) => clampUnit(channel * gain + lift));
}

function applyContrast(color, params) {
  const contrast = readParam(params, "contrast", -1, 1);
  if (contrast === 0) return color;
  const factor = 1 + contrast * 1.2;
  return color.map((channel) => clampUnit(0.5 + (channel - 0.5) * factor));
}

function applyWhiteBalance(color, params) {
  const temperature = readParam(params, "temperature", -1, 1);
  const tint = readParam(params, "tint", -1, 1);
  const redScale = 1 + temperature * 0.28 + tint * 0.08;
  const greenScale = 1 - Math.abs(tint) * 0.1 - tint * 0.08;
  const blueScale = 1 - temperature * 0.28 + tint * 0.08;
  return [
    clampUnit(color[0] * redScale),
    clampUnit(color[1] * greenScale),
    clampUnit(color[2] * blueScale),
  ];
}

function applySplitTone(color, params) {
  const split = params?.splitTone;
  if (!split) return color;
  const intensity = clampUnit(Number(split.intensity ?? 0));
  if (intensity === 0) return color;
  const balance = clampUnit(Number(split.balance ?? 0.5));
  const y = luma(color);
  const shadowMask = 1 - smoothstep(balance - 0.25, balance + 0.2, y);
  const highlightMask = smoothstep(balance - 0.2, balance + 0.25, y);
  const shadows = Array.isArray(split.shadows) ? split.shadows : [0, 0, 0];
  const highlights = Array.isArray(split.highlights) ? split.highlights : [0, 0, 0];
  return color.map((channel, i) =>
    clampUnit(
      channel +
        Number(shadows[i] ?? 0) * shadowMask * intensity +
        Number(highlights[i] ?? 0) * highlightMask * intensity,
    ),
  );
}

function applySaturation(color, params) {
  const saturation = readParam(params, "saturation", -1, 1);
  const vibrance = readParam(params, "vibrance", -1, 1);
  if (saturation === 0 && vibrance === 0) return color;
  const y = luma(color);
  const currentSat = Math.max(
    Math.abs(color[0] - y),
    Math.abs(color[1] - y),
    Math.abs(color[2] - y),
  );
  const vibranceWeight = 1 - clampUnit(currentSat * 2);
  const factor = clamp(1 + saturation + vibrance * vibranceWeight, 0, 2.5);
  return color.map((channel) => clampUnit(y + (channel - y) * factor));
}

function applyParams(color, params) {
  let out = applyLiftGain(color, params);
  out = applyExposure(out, params);
  out = applyContrast(out, params);
  out = applyWhiteBalance(out, params);
  out = applySplitTone(out, params);
  out = applySaturation(out, params);
  return out;
}

function formatNumber(value) {
  return clampUnit(value).toFixed(6);
}

export function buildCube(params = {}, size = DEFAULT_SIZE) {
  if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE) {
    throw new Error(`LUT size must be an integer from 2 to ${MAX_SIZE}`);
  }
  const lines = [
    `TITLE "media-use parametric grade"`,
    "DOMAIN_MIN 0 0 0",
    "DOMAIN_MAX 1 1 1",
    `LUT_3D_SIZE ${size}`,
  ];
  const denom = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = applyParams([r / denom, g / denom, b / denom], params);
        lines.push(`${formatNumber(out[0])} ${formatNumber(out[1])} ${formatNumber(out[2])}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function paramsFromIntent(intent) {
  const text = String(intent ?? "").toLowerCase();
  const params = {};
  let matched = false;

  if (/\b(warm|golden|sunlit|sunny)\b/.test(text)) {
    params.temperature = 0.18;
    matched = true;
  } else if (/\b(cool|blue|icy|crisp)\b/.test(text)) {
    params.temperature = -0.16;
    matched = true;
  }

  if (/\b(cinematic|film|movie)\b/.test(text)) {
    params.contrast = 0.08;
    params.saturation = 0.04;
    matched = true;
  }
  if (/\b(punchy|contrast|dramatic|bold)\b/.test(text)) {
    params.contrast = Math.max(params.contrast ?? 0, 0.22);
    matched = true;
  }
  if (/\b(bright|airy|lift)\b/.test(text)) {
    params.exposure = 0.16;
    params.shadows = 0.08;
    matched = true;
  }
  if (/\b(dark|moody|low-key)\b/.test(text)) {
    params.exposure = -0.12;
    params.contrast = Math.max(params.contrast ?? 0, 0.12);
    matched = true;
  }
  if (/\b(vibrant|saturated|colorful)\b/.test(text)) {
    params.saturation = Math.max(params.saturation ?? 0, 0.16);
    params.vibrance = 0.12;
    matched = true;
  }
  if (/\b(muted|desaturated|washed)\b/.test(text)) {
    params.saturation = Math.min(params.saturation ?? 0, -0.16);
    matched = true;
  }

  return matched ? params : null;
}
