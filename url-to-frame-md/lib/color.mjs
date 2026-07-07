// color.mjs — CSS color parsing + comparison, shared by the generator and verifier.
// Parses hex / #rgb / rgb()/rgba() / hsl() / oklch() → "#RRGGBB" (modern sites emit oklch/hsl).

export const HEX6 = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v) => HEX6.test(String(v).trim());
export const upper = (h) => String(h).trim().toUpperCase();
export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
// perceptual-ish weighted RGB distance (cheap, good enough for nearest-key); non-hex → Infinity.
export const colorDist = (a, b) => {
  if (!isHex(a) || !isHex(b)) return Infinity;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt(
    (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2,
  );
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const to255 = (x) =>
  Math.max(0, Math.min(255, Math.round(x)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
const rgbHex = (r, g, b) => `#${to255(r)}${to255(g)}${to255(b)}`;
const hslToRgb = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};
const oklchToRgb = (Lraw, C, H) => {
  const L = String(Lraw).endsWith("%") ? parseFloat(Lraw) / 100 : parseFloat(Lraw);
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const lin2srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const R = lin2srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const G = lin2srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const B = lin2srgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return [clamp01(R) * 255, clamp01(G) * 255, clamp01(B) * 255];
};
export const toHex = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (HEX6.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s))
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  let m;
  if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)))
    return rgbHex(+m[1], +m[2], +m[3]);
  if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(s)))
    return rgbHex(...hslToRgb(+m[1], +m[2], +m[3]));
  if ((m = /^oklch\(\s*([\d.]+%?)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:deg)?/i.exec(s)))
    return rgbHex(...oklchToRgb(m[1], +m[2], +m[3]));
  return null;
};
// luminance 0..255 of a #RRGGBB (Rec.601), for "near-white?" checks; null for non-hex.
export const lumOf = (hex) => {
  if (!isHex(hex)) return null;
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
