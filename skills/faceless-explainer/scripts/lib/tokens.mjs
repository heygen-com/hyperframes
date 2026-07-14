// tokens.mjs — shared brand-token parsing + semantic role mapping for frame.md /
// FRAME.md. Used by build-frame.mjs (remix a preset onto brand tokens) and
// captions.mjs (derive caption colors from frame.md). One mapping → frames and
// captions stay consistent. Pure node.

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

// Browser user-agent default colors for links / visited links. These leak into a
// capture from any UNSTYLED <a> and are NOT brand colors — but being pure & saturated
// they beat a real accent on chroma alone. Never let one become the accent.
export const UA_DEFAULT_COLORS = new Set(
  ["#0000EE", "#0000FF", "#0000CC", "#1A0DAB", "#551A8B", "#EE0000"].map((c) => c.toUpperCase()),
);

// Semantic STATUS roles (green "positive", red "negative"/"error", amber "warning" …). Their HUE
// carries the meaning, so they are never a brand ACCENT — a status red is frequently the most
// chromatic color in a palette (e.g. #dc2626 chroma 182 beats a deep-blue accent #1E40AF chroma
// 145) and would otherwise win a pure chroma ranking, painting captions/highlights the error red.
// build-frame.mjs uses this same key set to protect status colors during the preset→brand remix.
export const STATUS_ROLE_KEY =
  /(?:^|[-_])(?:positive|negative|success|error|warning|danger|good|bad|up|down|info|neutral|alert|caution|critical)(?:[-_]|$)/i;

// Pick the brand ACCENT — never by raw chroma alone, never a UA-default link color.
// Priority:
//   1) with capture colorStats → the colorful color that RECURS across the UI. The brand
//      accent shows up in MANY roles (link text + icon + button + badge), whereas a one-off
//      CTA fill appears in just one. So rank chromatic (chroma>40) candidates by role
//      diversity first, then total prevalence, then interactive use, then chroma. This keeps
//      a pervasive brand color (e.g. an indigo used everywhere) ahead of a single bright
//      button fill (e.g. a lime used once) — the old "top interactiveBg" rule picked the
//      latter. Requiring interactiveBg>0 is dropped so a text/icon-only accent can still win.
//   2) no stats → most chromatic color AFTER removing UA defaults + `exclude`.
// A stray default link color (e.g. #0000EE) can win under neither path.
export function pickAccent(stats, colors, exclude = []) {
  const ban = new Set([...exclude, ...UA_DEFAULT_COLORS].map((c) => String(c).toUpperCase()));
  const ok = (h) => /^#[0-9a-fA-F]{6}$/.test(String(h)) && !ban.has(String(h).toUpperCase());
  // Prominence rank from the (frequency-ordered) `colors` palette: index 0 = most used.
  // A saturated color sitting at the TAIL is almost always a one-off (a single CTA fill),
  // not the brand accent — capture colorStats counts are too sparse to tell these apart
  // (e.g. Linear's indigo and a lime CTA both register count≈1), but palette ORDER does.
  const rank = new Map((colors ?? []).map((h, i) => [String(h).toUpperCase(), i]));
  const prom = (h) => (rank.has(String(h).toUpperCase()) ? rank.get(String(h).toUpperCase()) : 1e9);
  if (Array.isArray(stats) && stats.length) {
    const roles = (s) =>
      ((s.interactiveBg || 0) > 0 ? 1 : 0) +
      ((s.textCount || 0) > 0 ? 1 : 0) +
      ((s.bgCount || 0) > 0 ? 1 : 0);
    const a = stats
      .filter((s) => ok(s?.hex) && chroma(s.hex) > 40)
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

// Derive brand roles from rich capture colorStats (areaBg / interactiveBg / textCount /
// maxArea) — by semantic FUNCTION, not luminance/chroma proxies. Returns null when stats
// are unusable, so the caller can fall back. canvas = the color painting the most real
// background area (the page ground, dark or light); ink = the dominant text color that
// actually contrasts with the canvas; accent via pickAccent.
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

// Map a list of [key, value] colors to semantic roles. ink = a dark/ink-named
// color (else darkest); canvas = a paper/cream/white-named color (else lightest);
// accents = whatever's left, ranked by chroma (the loudest color is almost always
// the brand accent) — UA-default link colors AND semantic status colors (positive/
// negative/error…) excluded so neither a stray <a> color nor a status red ever wins.
// For an unkeyed brand list, pass synthetic keys — name matching simply no-ops and it
// falls back to luminance/chroma, which is what we want. NOTE: when capture colorStats
// exist, prefer brandRolesFromStats() — it picks by function, not these proxies.
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
    .filter(
      ([k, v]) =>
        v !== ink &&
        v !== canvas &&
        !UA_DEFAULT_COLORS.has(String(v).toUpperCase()) &&
        !STATUS_ROLE_KEY.test(k), // a status red/green carries meaning by hue — never an accent
    )
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
  // the monospace / chrome family (code, tags, ticks, page numbers) — so the remix can
  // route a captured brand mono (Berkeley Mono, JetBrains Mono…) onto this role instead
  // of the reading body. null when the preset has no distinct mono role.
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
