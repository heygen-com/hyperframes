// tokens.mjs — brand-token parsing + semantic color-role mapping (shared, pure node).

// Collect `key: value` pairs under the top-level `colors:` block (until dedent).
export function parseColors(md) {
  const out = [];
  let inBlock = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^colors:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break; // dedent to a top-level key → end of block
    const m = line.match(
      /^\s+([\w-]+):\s*(?:"([^"]+)"|'([^']+)'|(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[^#\s][^#\n]*?))\s*(?:#.*)?$/,
    );
    if (m) out.push([m[1], (m[2] ?? m[3] ?? m[4]).trim()]);
  }
  return out;
}

// relative luminance of a #rrggbb (null for non-hex like rgba()).
export function lum(v) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

// chroma (max−min channel) of a #rrggbb — a cheap "how colorful" proxy; −1 for non-hex.
export function chroma(v) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v).trim());
  if (!m) return -1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

// HSL hue (0–360) of a #rrggbb; −1 for non-hex or achromatic (chroma 0).
export function hueOf(v) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v).trim());
  if (!m) return -1;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d === 0) return -1;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// circular hue distance (0–180).
export function hueSep(a, b) {
  if (a < 0 || b < 0) return 360; // an achromatic anchor never blocks a chromatic candidate
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Loud, hue-distinct secondary brand hues from the full palette (the gradient/graphic colors usage
// stats miss). Hue-separated from the primary accent + each other; [] for mono-accent brands.
export function vividAccents(
  colors,
  {
    exclude = [],
    hueAnchors = [],
    max = 2,
    minChroma = 70,
    minHueSep = 40,
    maxRankFrac = 0.7,
  } = {},
) {
  const list = (colors ?? []).map(String);
  const ban = new Set([...exclude, ...UA_DEFAULT_COLORS].map((c) => String(c).toUpperCase()));
  // palette is frequency-ordered; keep the leading portion (tail = one-off illustration pixels).
  const rankLimit = Math.max(3, Math.ceil(list.length * maxRankFrac));
  const cand = list
    .map((h, i) => ({ h, i }))
    .filter(
      ({ h, i }) =>
        i < rankLimit &&
        /^#[0-9a-fA-F]{6}$/.test(h) &&
        !ban.has(h.toUpperCase()) &&
        chroma(h) >= minChroma,
    )
    .sort((a, b) => chroma(b.h) - chroma(a.h));
  const anchorHues = hueAnchors.filter((h) => chroma(h) >= 30).map(hueOf);
  const chosen = [];
  for (const { h } of cand) {
    if (chosen.length >= max) break;
    const hh = hueOf(h);
    const clear = [...anchorHues, ...chosen.map(hueOf)].every((a) => hueSep(a, hh) >= minHueSep);
    if (clear) chosen.push(h.toUpperCase());
  }
  return chosen;
}

// UA-default link colors — saturated but never a brand accent.
export const UA_DEFAULT_COLORS = new Set(
  ["#0000EE", "#0000FF", "#0000CC", "#1A0DAB", "#551A8B", "#EE0000"].map((c) => c.toUpperCase()),
);

// Brand accent: with stats, the chromatic color recurring across the most UI roles; else most chromatic.
export function pickAccent(stats, colors, exclude = []) {
  const ban = new Set([...exclude, ...UA_DEFAULT_COLORS].map((c) => String(c).toUpperCase()));
  const ok = (h) => /^#[0-9a-fA-F]{6}$/.test(String(h)) && !ban.has(String(h).toUpperCase());
  // palette prominence (index 0 = most used) breaks ties; a saturated tail color is a one-off.
  const rank = new Map((colors ?? []).map((h, i) => [String(h).toUpperCase(), i]));
  const inPalette = (h) => rank.has(String(h).toUpperCase());
  const prom = (h) => (inPalette(h) ? rank.get(String(h).toUpperCase()) : 1e9);
  if (Array.isArray(stats) && stats.length) {
    const roles = (s) =>
      ((s.interactiveBg || 0) > 0 ? 1 : 0) +
      ((s.textCount || 0) > 0 ? 1 : 0) +
      ((s.bgCount || 0) > 0 ? 1 : 0);
    // reject injected-widget/focus-ring strays: a real accent is in the palette, paints a bg, or recurs.
    const strayFree = (s) => inPalette(s.hex) || (s.areaBg || 0) > 0 || (s.count || 0) >= 5;
    const a = stats
      .filter((s) => ok(s?.hex) && chroma(s.hex) > 40 && strayFree(s))
      .sort(
        (x, y) =>
          roles(y) - roles(x) || // used in MORE roles (link+icon+button) = the brand accent
          prom(x.hex) - prom(y.hex) || // earlier in the palette = more prominent
          (y.count || 0) - (x.count || 0) ||
          (y.interactiveBg || 0) - (x.interactiveBg || 0) ||
          chroma(y.hex) - chroma(x.hex),
      );
    if (a.length) return a[0].hex;
  }
  const c = (colors ?? [])
    .map(String)
    .filter(ok)
    .sort((x, y) => chroma(y) - chroma(x));
  return c[0];
}

// Brand roles from colorStats by FUNCTION: canvas = biggest bg area, ink = dominant contrasting text, accent via pickAccent.
export function brandRolesFromStats(stats, colorsInOrder) {
  if (!Array.isArray(stats) || !stats.length) return null;
  const v = stats.filter((s) => /^#[0-9a-fA-F]{6}$/.test(s?.hex || ""));
  if (!v.length) return null;
  const canvas = [...v].sort(
    (a, b) =>
      (b.areaBg || 0) - (a.areaBg || 0) ||
      (b.maxArea || 0) - (a.maxArea || 0) ||
      (b.bgCount || 0) - (a.bgCount || 0),
  )[0]?.hex;
  // pass the frequency-ordered palette (tokens.colors) so pickAccent can use palette
  // PROMINENCE — colorStats counts alone are too sparse to rank rare accents.
  const accent = pickAccent(v, colorsInOrder ?? v.map((s) => s.hex), [canvas]);
  if (!canvas || !accent) return null;
  const cl = lum(canvas) ?? 0;
  const ink =
    [...v]
      .filter((s) => s.hex !== canvas && s.hex !== accent)
      .sort((a, b) => (b.textCount || 0) - (a.textCount || 0))
      .find((s) => Math.abs((lum(s.hex) ?? 0) - cl) > 64)?.hex ??
    (cl > 128 ? "#000000" : "#FFFFFF");
  const accent2 =
    v
      .filter(
        (s) =>
          ![canvas, ink, accent].includes(s.hex) &&
          (s.interactiveBg || 0) > 0 &&
          chroma(s.hex) > 40 &&
          !UA_DEFAULT_COLORS.has(s.hex.toUpperCase()),
      )
      .sort((a, b) => (b.interactiveBg || 0) - (a.interactiveBg || 0))[0]?.hex ?? accent;
  return { ink, canvas, accent, accent2 };
}

// Fallback role mapping by name + luminance/chroma, for when colorStats are absent.
export function semanticColors(colors) {
  if (!colors.length) return {};
  const named = (re) => colors.find(([k]) => re.test(k));
  const hexes = colors.filter(([, v]) => lum(v) != null);
  const byLum = [...hexes].sort((a, b) => (lum(a[1]) ?? 1e9) - (lum(b[1]) ?? 1e9));
  const pick = (m, fallback) => (m ? m[1] : fallback ? fallback[1] : undefined);
  // "ink" must be a whole word-segment so "soft-pink"/"pink" don't match it.
  const ink = pick(
    named(/(?:^|[-_])ink(?:[-_]|$)|black|charcoal|^text(?:-dark)?$|outline|noir/i),
    byLum[0] ?? colors[0],
  );
  const canvas = pick(
    named(/cream|paper|canvas|white|bg|ground|surface|base|sand|parchment|off-?white|bone/i),
    byLum[byLum.length - 1] ?? colors[colors.length - 1],
  );
  const accents = colors
    .filter(([, v]) => v !== ink && v !== canvas && !UA_DEFAULT_COLORS.has(String(v).toUpperCase()))
    .sort((a, b) => chroma(b[1]) - chroma(a[1]))
    .map(([, v]) => v);
  return { ink, canvas, accent: accents[0] ?? ink, accent2: accents[1] ?? accents[0] ?? ink };
}

// Collect role→fontFamily under the top-level `typography:` block; pick a display
// + body family from the usual role names. Returns quoted families (or null).
export function parseFonts(md) {
  const roles = {};
  let inBlock = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^typography:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+([\w-]+):\s*\{[^}]*fontFamily:\s*"([^"]+)"/);
    if (m) roles[m[1]] = m[2];
  }
  const q = (s) => (s ? `"${s}"` : null);
  const body = roles.body ?? roles.subtitle ?? Object.values(roles)[0];
  const display =
    roles.display ??
    roles.headline ??
    roles["card-headline"] ??
    roles["section-headline"] ??
    roles["quote-display"] ??
    roles.h1 ??
    roles.h2 ??
    roles.title ??
    roles.hero ??
    body;
  // the monospace/chrome family (code, tags, ticks); null when there's no distinct mono role.
  const mono =
    roles.mono ??
    roles["mono-tag"] ??
    roles["mono-chrome"] ??
    roles["mono-tick"] ??
    roles.code ??
    roles.data ??
    roles.pagenum ??
    null;
  return { display: q(display), body: q(body), mono: q(mono) };
}
