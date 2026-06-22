// dimensions.mjs — canvas size + caption-band geometry for the product-launch
// pipeline. Single source of truth = the STORYBOARD frontmatter `format` global
// ("1920x1080" / "1080x1920" / "1080x1080", or a named orientation). Every
// script and the index assembler reads the size from here; none hardcodes it.

// Named orientation presets. Square/portrait are 1080-based so they share the
// long-edge pixel budget with landscape (same render-cost ballpark).
export const ORIENTATION_PRESETS = {
  landscape: { width: 1920, height: 1080 }, // 16:9 — default
  portrait: { width: 1080, height: 1920 }, // 9:16 — reels / shorts / TikTok
  square: { width: 1080, height: 1080 }, // 1:1 — feed
};

export const DEFAULT_DIMENSIONS = ORIENTATION_PRESETS.landscape;

function sane(w, h) {
  return Number.isFinite(w) && Number.isFinite(h) && w >= 240 && h >= 240 && w <= 8192 && h <= 8192;
}

// Parse a STORYBOARD `format` global into { width, height, source }. Accepts
// "WxH" (e.g. "1920x1080"; `x` or `×`, any inner spacing) or a named orientation;
// falls back to landscape so a storyboard with a missing/garbled format still
// renders (no behavior change vs the old landscape lock).
export function parseFormat(format) {
  const s = typeof format === "string" ? format.trim().toLowerCase() : "";
  if (ORIENTATION_PRESETS[s]) return { ...ORIENTATION_PRESETS[s], source: `orientation=${s}` };
  const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (m) {
    const w = parseInt(m[1] ?? "", 10);
    const h = parseInt(m[2] ?? "", 10);
    if (sane(w, h)) return { width: w, height: h, source: "format" };
  }
  return { ...DEFAULT_DIMENSIONS, source: "default(landscape)" };
}

// Caption band geometry, derived from canvas height: the bottom ~16.67% (180px
// at h=1080). Frame content must end `safetyPx` above the band top. Holds even
// when captions are disabled (bottom-edge consistency).
export const CAPTION_BAND_FRACTION = 0.1667;
export function captionBand(height, safetyPx = 20) {
  const h = Number.isFinite(height) ? height : DEFAULT_DIMENSIONS.height;
  const bandHeight = Math.round(h * CAPTION_BAND_FRACTION);
  const bandTopY = h - bandHeight; // foreground must end at/above this y
  return { bandHeight, bandTopY, foregroundMaxY: bandTopY - safetyPx };
}
