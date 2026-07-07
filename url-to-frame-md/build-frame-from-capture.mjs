#!/usr/bin/env node
// build-frame-from-capture.mjs — capture folder → frame.md (faithful: every hex/size from the capture).
//   node build-frame-from-capture.mjs --capture ./stripe-capture [--out <path>] [--frame-width 1920]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  brandRolesFromStats,
  chroma,
  lum,
  pickAccent,
  semanticColors,
  UA_DEFAULT_COLORS,
  vividAccents,
} from "./lib/tokens.mjs";
import { colorDist, isHex, toHex, upper } from "./lib/color.mjs";
import { isIconFont, isMonoFont, isSerifFont, stageFonts } from "./lib/fonts.mjs";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const die = (m) => {
  console.error(`✗ build-frame-from-capture: ${m}`);
  process.exit(1);
};

const captureDir = resolve(flag("capture", "."));
const frameWidth = parseInt(flag("frame-width", "1920"), 10);
const outPath = resolve(flag("out", join(captureDir, "frame.md")));

const tokensPath = join(captureDir, "extracted/tokens.json");
const stylesPath = join(captureDir, "extracted/design-styles.json");
if (!existsSync(tokensPath))
  die(`no tokens.json at ${tokensPath} — is --capture a hyperframes capture folder?`);
const readJSON = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    return die(`${p}: invalid JSON — ${e.message}`);
  }
};
const tokens = readJSON(tokensPath);
const styles = existsSync(stylesPath) ? readJSON(stylesPath) : {};

// ── helpers (color parsing + comparison live in lib/color.mjs) ───────────────
const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(String(v).trim());
  return m ? parseFloat(m[1]) : null;
};
const toCqw = (pxVal) => Math.round((pxVal * 10000) / frameWidth) / 100; // 2 decimals
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ── 1. brand palette → semantic color keys ───────────────────────────────────
const paletteColors = (tokens.colors ?? [])
  .map((c) => (typeof c === "string" ? c : (c?.hex ?? c?.value ?? "")))
  .map((c) => toHex(c)) // normalize rgb()/hsl()/oklch()/#rgb → #RRGGBB (don't drop non-hex captures)
  .filter(Boolean);
const colorStats = Array.isArray(tokens.colorStats)
  ? tokens.colorStats.filter((s) => isHex(s?.hex))
  : [];

if (!paletteColors.length) die("tokens.json has no usable hex colors");

// roles by FUNCTION from colorStats (canvas = largest bg area, accent = recurring chromatic,
// ink = dominant contrasting text); fall back to luminance/chroma when stats are absent.
const roles =
  brandRolesFromStats(colorStats, paletteColors) ??
  (() => {
    const clean = paletteColors.filter((h) => !UA_DEFAULT_COLORS.has(upper(h)));
    const s = semanticColors(clean.map((h, i) => [`c${i}`, h]));
    return {
      ink: s.ink,
      canvas: s.canvas,
      accent: pickAccent(colorStats, clean, [s.ink, s.canvas]) ?? s.accent,
      accent2: s.accent2,
    };
  })();
if (!roles.canvas || !roles.ink || !roles.accent)
  die("could not resolve canvas/ink/accent from palette");

// secondary ink: the most-used TEXT color that is neutral-ish and distinct from ink/canvas/accent
const used = new Set([upper(roles.canvas), upper(roles.ink), upper(roles.accent)]);
const inkMuted = colorStats
  .filter((s) => !used.has(upper(s.hex)) && (s.textCount || 0) > 0 && chroma(s.hex) < 60)
  .sort((a, b) => (b.textCount || 0) - (a.textCount || 0))[0]?.hex;
if (inkMuted) used.add(upper(inkMuted));

// surface: a light background that is NOT the canvas (cards / sections sit on it)
const canvasLum = lum(roles.canvas) ?? 255;
const surface = colorStats
  .filter(
    (s) =>
      !used.has(upper(s.hex)) &&
      (s.bgCount || 0) > 0 &&
      Math.abs((lum(s.hex) ?? 0) - canvasLum) < 40 &&
      chroma(s.hex) < 40,
  )
  .sort((a, b) => (b.bgCount || 0) - (a.bgCount || 0))[0]?.hex;
if (surface) used.add(upper(surface));

// accent-2 only if it's a REAL second accent: distinct from accent, genuinely chromatic,
// and not a near-canvas tint (a pale peach at chroma ~46 next to white is not an accent).
const accent2cand =
  roles.accent2 && upper(roles.accent2) !== upper(roles.accent) ? roles.accent2 : null;
const accent2 =
  accent2cand && chroma(accent2cand) > 50 && Math.abs((lum(accent2cand) ?? 0) - canvasLum) > 40
    ? accent2cand
    : null;

// grounds: real page background blocks ranked by painted area (maxArea) — includes dark/tinted bands the light `surface` role can't hold.
const canvasMaxArea = colorStats.reduce((m, s) => Math.max(m, s.maxArea || 0), 0) || 1;
const onColorFor = (bg) => {
  const bl = lum(bg) ?? 0;
  return [roles.ink, roles.canvas, "#FFFFFF", "#111111"]
    .filter(isHex)
    .map((c) => [c, Math.abs((lum(c) ?? 0) - bl)])
    .sort((a, b) => b[1] - a[1])[0][0];
};
// classify a ground by its OWN luminance (not sign-relative to canvas, which mislabels a
// near-white grey as "dark"): light / mid / dark — the renderer keys chrome + emphasis off this.
const groundKind = (bg) => {
  if (upper(bg) === upper(roles.canvas)) return "canvas";
  const l = lum(bg) ?? 0;
  return l > 170 ? "light" : l < 90 ? "dark" : "mid";
};
const grounds = [];
const seenGround = [];
for (const s of [...colorStats].sort((a, b) => (b.maxArea || 0) - (a.maxArea || 0))) {
  if (!isHex(s.hex)) continue;
  if ((s.bgCount || 0) <= 0 && (s.areaBg || 0) <= 0) continue; // must actually paint a background
  if ((s.maxArea || 0) < canvasMaxArea * 0.02) continue; // drop tiny chips (<2% of the biggest ground)
  if (upper(s.hex) === upper(roles.accent)) continue; // accent is its own role, rotated in separately
  if (seenGround.some((g) => colorDist(g, s.hex) < 24)) continue; // dedup near-identical grounds
  seenGround.push(s.hex);
  grounds.push({ bg: s.hex, on: onColorFor(s.hex), kind: groundKind(s.hex) });
  if (grounds.length >= 5) break;
}
if (!grounds.some((g) => upper(g.bg) === upper(roles.canvas)))
  grounds.unshift({ bg: roles.canvas, on: onColorFor(roles.canvas), kind: "canvas" });

// surface-contrast: the largest-area neutral ground on the opposite tonal side of the canvas (a dark footer under a light page).
const accentSet = new Set([upper(roles.accent), accent2 && upper(accent2)].filter(Boolean));
const surfaceDark = colorStats
  .filter(
    (s) =>
      isHex(s.hex) &&
      !used.has(upper(s.hex)) &&
      !accentSet.has(upper(s.hex)) && // it's a NEUTRAL ground, never a brand accent
      upper(s.hex) !== upper(roles.ink) &&
      chroma(s.hex) < 45 && // saturated blocks are accents/brand colors, not a surface band
      (s.bgCount || 0) > 0 &&
      Math.abs((lum(s.hex) ?? 0) - canvasLum) > 60,
  )
  .sort((a, b) => (b.maxArea || 0) - (a.maxArea || 0))[0]?.hex;
if (surfaceDark) used.add(upper(surfaceDark));

// loud hue-distinct secondary brand hues from the full palette (usage-stats accent2 misses these).
const vivid = vividAccents(paletteColors, {
  exclude: [roles.canvas, roles.ink, surface, surfaceDark, inkMuted, roles.accent].filter(Boolean),
  hueAnchors: [roles.accent].filter(Boolean),
  max: 2,
});
// accent-2/3 = vivid hues first; stats accent2 only as a palette-member fallback (else strays leak in).
const paletteSet = new Set(paletteColors.map(upper));
const accent2InPalette = accent2 && paletteSet.has(upper(accent2)) ? accent2 : null;
const secondaryAccents = [];
for (const h of [...vivid, accent2InPalette].filter(Boolean)) {
  if (!secondaryAccents.some((x) => upper(x) === upper(h)) && upper(h) !== upper(roles.accent))
    secondaryAccents.push(h);
}

// ordered semantic palette — keys are stable role names (frame.md key naming is free).
const palette = [
  ["canvas", roles.canvas],
  surface && ["surface", surface],
  surfaceDark && ["surface-contrast", surfaceDark],
  ["ink", roles.ink],
  inkMuted && ["ink-muted", inkMuted],
  ["accent", roles.accent],
  secondaryAccents[0] && ["accent-2", secondaryAccents[0]],
  secondaryAccents[1] && ["accent-3", secondaryAccents[1]],
].filter(Boolean);

const paletteUpper = palette.map(([k, v]) => [k, upper(v)]);
// hex → nearest semantic key (used by typography/components so emitted values are always palette colors)
const keyFor = (hex) => {
  if (!isHex(hex)) return "ink";
  const u = upper(hex);
  const exact = paletteUpper.find(([, v]) => v === u);
  if (exact) return exact[0];
  const [k, d] = palette.map(([k, v]) => [k, colorDist(hex, v)]).sort((a, b) => a[1] - b[1])[0];
  // no palette color is close (an outlier sample color, e.g. a one-off hero highlight) →
  // snap to ink rather than forcing a misleading nearest-match.
  return d <= 80 ? k : "ink";
};
// type-ramp color → role key, or a literal chromatic hex (brand-inked heading) kept only if corroborated by another heading role.
const headColors = (styles.typography ?? [])
  .filter((t) => /display|head|hero|title/i.test(String(t.role || "")))
  .map((t) => toHex(t.color))
  .filter(Boolean);
const corroborated = (hex) => headColors.filter((h) => colorDist(h, hex) <= 40).length >= 2;
const typeColorToken = (raw) => {
  const hex = toHex(raw);
  if (!hex) return "ink";
  // a heading must read on the canvas: if the captured color barely contrasts it (a dark-on-dark
  // mis-sample like an input placeholder), fall back to the safe reading ink.
  if (Math.abs((lum(hex) ?? 0) - (lum(roles.canvas) ?? 255)) < 50) return "ink";
  const exact = paletteUpper.find(([, v]) => v === hex);
  if (exact) return exact[0];
  const [k, d] = palette.map(([key, v]) => [key, colorDist(hex, v)]).sort((a, b) => a[1] - b[1])[0];
  if (d <= 40) return k; // effectively a palette role
  return chroma(hex) > 40 && corroborated(hex) ? hex : "ink"; // trusted brand chroma → keep; else ink
};

// ── 2. fonts (isIconFont / isMonoFont / stageFonts live in lib/fonts.mjs) ─────
const brandFonts = (tokens.fonts ?? [])
  .map((f) => (typeof f === "string" ? f : (f?.family ?? f?.name ?? "")))
  .map((f) => String(f).split(",")[0].replace(/['"]/g, "").trim())
  .filter(Boolean)
  .filter((f) => !isIconFont(f));
const brandWeights = [
  ...new Set(
    (tokens.fonts ?? [])
      .filter((f) => f && typeof f === "object" && !isIconFont(f.family ?? f.name ?? ""))
      .flatMap((f) => (Array.isArray(f.weights) ? f.weights : []))
      .map((w) => parseInt(w, 10))
      .filter(Number.isFinite),
  ),
].sort((a, b) => a - b);
// Stage brand fonts into assets/fonts (idempotent) so emitted font-family names always match a real @font-face.
const outFontsDir = join(dirname(outPath), "assets/fonts");
const fontStaging = stageFonts(
  captureDir,
  outFontsDir,
  brandFonts,
  brandFonts.find((f) => !isMonoFont(f)) ?? brandFonts[0] ?? "Inter",
);
const stagedFamilies = fontStaging.families;
const normFont = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
// system/CSS-generic fallback faces leaked from unstyled elements → normalize to the brand sans.
const GENERIC =
  /^(sans-serif|serif|system-ui|ui-sans-serif|ui-serif|ui-monospace|monospace|-apple-system|blinkmacsystemfont|arial|helvetica(\s+neue)?|times(\s+new\s+roman)?|georgia|courier(\s+new)?|inherit|initial|unset)$/i;
const GENERIC_MONO = /^(ui-monospace|monospace|courier(\s+new)?|consolas|menlo|monaco)$/i;
const monoFont = stagedFamilies.find(isMonoFont) ?? brandFonts.find(isMonoFont) ?? null;
// the brand body sans — a STAGED non-mono/non-serif so it actually renders; degrade to a captured
// name only when nothing staged (e.g. DoorDash's fonts were never downloaded — nothing can render).
const sansFont =
  stagedFamilies.find((f) => !isMonoFont(f) && !isSerifFont(f)) ??
  stagedFamilies.find((f) => !isMonoFont(f)) ??
  brandFonts.find((f) => !isMonoFont(f)) ??
  brandFonts[0] ??
  "Inter";
// resolve a computed font name to the staged family that actually renders; generic/icon/unknown → brand sans.
const fontFor = (fam) => {
  const f = String(fam || "").trim();
  if (!f || GENERIC.test(f)) return GENERIC_MONO.test(f) && monoFont ? monoFont : sansFont;
  if (isIconFont(f)) return sansFont;
  const nf = normFont(f);
  const exact = stagedFamilies.find((sf) => normFont(sf) === nf);
  if (exact) return exact;
  const near = stagedFamilies.find((sf) => {
    const ns = normFont(sf);
    return ns.length > 3 && (ns.includes(nf) || nf.includes(ns));
  });
  if (near) return near;
  return isMonoFont(f) && monoFont ? monoFont : sansFont;
};
const nearestWeight = (n) =>
  brandWeights.length
    ? brandWeights.reduce(
        (best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best),
        brandWeights[0],
      )
    : n;

// ── 3. typography ramp (px → cqw, lineHeight → ratio, letterSpacing → em) ──────
const typeRoles = [];
const seenRole = new Set();
for (const t of styles.typography ?? []) {
  const sizePx = px(t.fontSize);
  if (sizePx == null) continue;
  let role = String(t.role || "").trim() || `t${typeRoles.length}`;
  if (seenRole.has(role)) continue; // first occurrence of each role wins (DOM order = importance)
  seenRole.add(role);
  const lhPx = px(t.lineHeight);
  const lsPx = px(t.letterSpacing);
  const weight = nearestWeight(parseInt(t.fontWeight, 10) || 400);
  // a code/mono role often computes to a serif system fallback (Times) when its CSS var doesn't
  // resolve in capture — force it onto the brand mono rather than carrying the fallback.
  const isCodeRole = /(?:^|[-_])(?:code|mono|data|kbd|pre|tick)(?:[-_]|$)/i.test(role);
  const entry = {
    role,
    fontFamily: isCodeRole && monoFont ? monoFont : fontFor(t.fontFamily),
    weight,
  };
  // small chrome (<16px) stays in px; everything that should scale becomes cqw
  if (sizePx < 16) entry.px = Math.round(sizePx);
  else entry.cqw = toCqw(sizePx);
  if (lhPx != null && sizePx > 0) entry.lineHeight = round(lhPx / sizePx);
  if (lsPx != null && Math.abs(lsPx) > 0.01 && sizePx > 0)
    entry.tracking = `${round(lsPx / sizePx, 3)}em`;
  if (t.color) entry.color = typeColorToken(t.color);
  typeRoles.push(entry);
}

// reclaim an orphaned brand serif for the display voice ONLY when display sampled a generic fallback (not a real brand sans).
const serifFace =
  stagedFamilies.find((f) => !isMonoFont(f) && !isIconFont(f) && isSerifFont(f)) ?? null;
const dispRole = typeRoles.find((t) => /^display$|hero|wordmark|title/i.test(t.role));
const dispCaptured = (styles.typography ?? []).find((t) => t.role === dispRole?.role)?.fontFamily;
if (
  serifFace &&
  dispRole &&
  dispRole.fontFamily === sansFont &&
  GENERIC.test(String(dispCaptured ?? "").trim())
) {
  dispRole.fontFamily = serifFace; // display fell back from a generic → reclaim the real brand serif
}

// display / hero ramp — frame-native sizes for cover & oversized-claim frames (a video-scale
// addition, not from capture); weight is clamped to the brand's own ceiling.
const heroWeight = nearestWeight(700);
const headingRole = typeRoles.find((t) => /display|head|hero|title/i.test(t.role));
const heroColor = headingRole?.color ?? "ink";
// the hero ramp IS the display voice — use the (possibly serif-reclaimed) display role's own face.
const displayFamily = dispRole?.fontFamily ?? headingRole?.fontFamily ?? sansFont;
const heroRamp = [
  {
    role: "display-hero",
    fontFamily: displayFamily,
    cqw: 8,
    weight: heroWeight,
    lineHeight: 1.0,
    tracking: "-0.02em",
    color: heroColor,
  },
  {
    role: "wordmark-mega",
    fontFamily: displayFamily,
    cqw: 16,
    weight: heroWeight,
    lineHeight: 0.92,
    tracking: "-0.03em",
    color: heroColor,
  },
];

// ── 4. radii + shadows (optional blocks) ───────────────────────────────────────
const radii = [
  ...new Set(
    (styles.radius ?? []).map((r) => String(r).trim()).filter((r) => /^\d/.test(r) && r !== "0px"),
  ),
];
const shadows = (styles.shadows ?? [])
  .map((s) => (typeof s === "string" ? s : s?.value))
  .filter((s) => s && s !== "none");

// ── 5. spacing scale (px → cqw, a few representative steps) ─────────────────────
const observed = [
  ...new Set((styles.spacing?.observed ?? []).filter((n) => Number.isFinite(n) && n > 0)),
].sort((a, b) => a - b);
const pickAt = (frac) =>
  observed[Math.min(observed.length - 1, Math.round(frac * (observed.length - 1)))];
const spacing = observed.length
  ? [
      ["gap-tight", pickAt(0.25)],
      ["gap", pickAt(0.55)],
      ["pad-region", pickAt(0.8)],
      ["pad-edge", observed[observed.length - 1]],
    ]
      .filter(([, v]) => Number.isFinite(v))
      .map(([k, v]) => [k, `${toCqw(v)}cqw`])
  : [];

// ── 6. components — structured tokens ({colors.x}/{radii.rN}); drop unstyled (bg==text) + section-sized noise.
const cleanComp = (c, maxH) => {
  if (!c) return null;
  const transparent =
    String(c.background ?? "")
      .trim()
      .toLowerCase() === "transparent";
  const bg = transparent ? null : toHex(c.background); // transparent ground = valid (no fill)
  if (!transparent && !bg) return null; // unparseable, non-transparent bg → not a real component
  const fg = toHex(c.color);
  if (bg && fg && upper(bg) === upper(fg)) return null; // solid bg == text → unstyled wrapper
  const h = px(c.height);
  if (h != null && h > maxH) return null; // oversized → a section, not a component
  return { ...c, background: bg, color: fg ?? c.color, transparent };
};
// component ground → color token: transparent → canvas; solid → nearest palette role if close, else literal hex.
const groundToken = (c) =>
  c.transparent || !c.background
    ? "{colors.canvas}"
    : (colorTokenOrHex(c.background) ?? "{colors.canvas}");
// effective ground hex for contrast checks (transparent sits on the canvas)
const effGround = (c) => (c.transparent || !c.background ? roles.canvas : c.background);
const radiiKeyByVal = new Map(radii.map((v, i) => [v, `r${i + 1}`]));
// normalize Chrome's giant pill-radius sentinel (≥2000px) to "9999px".
const normRadius = (raw) =>
  String(raw ?? "").replace(/(\d+(?:\.\d+)?(?:e\+?\d+)?)px/gi, (m, n) =>
    parseFloat(n) >= 2000 ? "9999px" : m,
  );
// keep captured radius verbatim: single scale value → token; multi-corner / % / pill pass through unchanged.
const radiusRef = (raw) => {
  const s = normRadius(String(raw ?? "").trim());
  if (!s || s === "0" || s === "0px") return "0px";
  return radiiKeyByVal.has(s) ? `{radii.${radiiKeyByVal.get(s)}}` : s;
};
// a color → {colors.key} when it's near a palette role, else the faithful literal hex
const colorTokenOrHex = (raw) => {
  const hex = toHex(raw);
  if (!hex) return null;
  const exact = paletteUpper.find(([, v]) => v === hex);
  if (exact) return `{colors.${exact[0]}}`;
  const [k, d] = palette.map(([key, v]) => [key, colorDist(hex, v)]).sort((a, b) => a[1] - b[1])[0];
  return d <= 60 ? `{colors.${k}}` : hex;
};
const cleanBorder = (border) => {
  const s = String(border ?? "").trim();
  if (!s || /^none/.test(s)) return null;
  const m = /^([\d.]+px)\s+(solid|dashed|dotted)\s+(.+)$/.exec(s);
  if (!m || parseFloat(m[1]) === 0) return null; // 0px width → no border
  const rawColor = m[3].trim();
  // a faint hairline is often rgba(...,0.08) — keep a translucent color verbatim so it renders as
  // the intended whisper, not an opaque line (colorTokenOrHex would drop the alpha).
  const translucent = /rgba?\([^)]*[,/]\s*(?:0?\.\d+|0)\s*\)$/i.test(rawColor);
  const c = translucent ? rawColor : colorTokenOrHex(rawColor);
  return c ? `${m[1]} ${m[2]} ${c}` : null;
};
const cleanPad = (p) => (p && !/^0px$/.test(String(p).trim()) ? String(p).trim() : null);
// pass a component's OWN box-shadow through verbatim (real multi-layer shadows are captured but
// were being dropped in favor of a coarse global scale); null for "none"/empty.
const cleanShadow = (s) => {
  const v = String(s ?? "").trim();
  return v && v !== "none" ? v : null;
};
// gradient value → verbatim (CSS-valid), trailing ", none" background-image layer stripped; else null
const cleanGradient = (g) => {
  const v = String(g ?? "")
    .replace(/,\s*none\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return v && /gradient/.test(v) ? v : null;
};

const components = [];
// hex for a palette role key (canvas/ink/…), for contrast math.
const roleHexOf = (k) => (palette.find(([kk]) => kk === k) ?? [])[1];
// the best-contrast READING role (ink vs canvas) for text sitting on a given fill.
const onRoleFor = (fillHex) =>
  [
    ["ink", roles.ink],
    ["canvas", roles.canvas],
  ]
    .map(([k, v]) => [k, Math.abs((lum(fillHex) ?? 0) - (lum(v) ?? 0))])
    .sort((a, b) => b[1] - a[1])[0][0];
// legible button text: captured text role, but fall back to best-contrast role when it fails contrast on the fill.
const legibleTextToken = (fillHex, capturedText) => {
  const role = keyFor(toHex(capturedText) ?? capturedText);
  const contrast = Math.abs((lum(fillHex) ?? 0) - (lum(roleHexOf(role)) ?? 0));
  return `{colors.${contrast >= 55 ? role : onRoleFor(fillHex)}}`;
};
const compFromButton = (b, name, desc) => [
  name,
  {
    backgroundColor: groundToken(b),
    backgroundImage: cleanGradient(b.backgroundImage),
    // gradient fills carry their own contrast story; for a solid fill enforce text legibility on it.
    textColor: cleanGradient(b.backgroundImage)
      ? `{colors.${keyFor(toHex(b.color) ?? b.color)}}`
      : legibleTextToken(effGround(b), b.color),
    typography: `${fontFor(b.fontFamily ?? sansFont)} ${nearestWeight(parseInt(b.fontWeight, 10) || 500)}`,
    rounded: radiusRef(b.borderRadius),
    padding: cleanPad(b.padding),
    border: cleanBorder(b.border),
    shadow: cleanShadow(b.boxShadow),
    height: px(b.height) != null ? `${Math.round(px(b.height))}px` : null,
    description: desc,
  },
];
// emit every distinct visible button-sized token; drop noise + invisible (bg≈text), dedup by ground+text+border.
const visible = (c) => {
  if (cleanGradient(c.backgroundImage)) return true; // a gradient fill is unambiguously visible
  const g = effGround(c);
  const t = toHex(c.color) ?? c.color;
  return keyFor(g) !== keyFor(t) && Math.abs((lum(g) ?? 0) - (lum(t) ?? 0)) >= 20;
};
const btnSized = (b) => {
  const h = px(b.height);
  return h == null || (h >= 24 && h <= 96);
};
// a pill/circle radius (≥50px, 9999, or 50%) marks a rounded CTA — used by the dedup (a pill and a
// square of the same fill are distinct buttons) and by the primary-CTA tie-break below.
const isPillRadius = (r) => /(?:^|\s)(?:[5-9]\d|\d{3,})px|9999|50%/.test(String(r ?? ""));
let cleanBtns = (styles.buttons ?? [])
  .map((b) => cleanComp(b, 96))
  .filter(Boolean)
  .filter(btnSized)
  .filter(visible);
{
  const seen = new Set();
  cleanBtns = cleanBtns.filter((b) => {
    // include radius: a pill and a square button of the same fill are distinct CTAs (the pill is
    // usually the primary), so they must not collapse to one in the dedup.
    const sig = `${upper(b.background)}|${upper(toHex(b.color) ?? b.color)}|${cleanBorder(b.border) ? "b" : "_"}|${isPillRadius(b.borderRadius) ? "pill" : "sq"}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
// primary CTA = the most prominent solid button: accent-colored, or a bold neutral pill maxing canvas contrast.
const fillProminence = (b) => {
  const grad = !!cleanGradient(b.backgroundImage);
  if ((b.transparent || !b.background) && !grad) return -1; // outlined / ghost → secondary, never primary
  const g = effGround(b);
  // a gradient fill is a bold, deliberate CTA (Snowflake blue pill) — score it top, like the accent.
  const accentClose = grad ? 255 : 255 - Math.min(colorDist(g, roles.accent), 255);
  const canvasContrast = Math.abs((lum(g) ?? 0) - (lum(roles.canvas) ?? 255));
  return Math.max(accentClose, canvasContrast) + (isPillRadius(b.borderRadius) ? 25 : 0);
};
const primaryBtn = [...cleanBtns].sort((a, b) => fillProminence(b) - fillProminence(a))[0];
const restBtns = cleanBtns.filter((b) => b !== primaryBtn);
const secondaryBtn = restBtns.find((b) => cleanBorder(b.border));
const extraBtns = restBtns.filter((b) => b !== secondaryBtn);
// "weak" primary = no real filled CTA captured (ground ≈ canvas, not a gradient); synthesize accent fill at the brand's own button geometry.
const primaryWeak =
  !primaryBtn ||
  (!cleanGradient(primaryBtn.backgroundImage) &&
    Math.abs((lum(effGround(primaryBtn)) ?? 0) - (lum(roles.canvas) ?? 255)) < 40);
if (primaryWeak) {
  const onAccent = (lum(roles.canvas) ?? 255) >= (lum(roles.ink) ?? 0) ? "canvas" : "ink";
  // radius = the brand's own button geometry: the captured button's radius when it has one, else a
  // pill if the radius scale has one, else the smallest scale step. Never a forced pill.
  const capRadius =
    primaryBtn && !/^0(px)?$/.test(String(primaryBtn.borderRadius ?? ""))
      ? primaryBtn.borderRadius
      : null;
  // use the captured button radius; else a pill only if the radius scale has one; else a moderate default.
  const synthRadius = capRadius ?? radii.find((r) => isPillRadius(r)) ?? "8px";
  components.push([
    "button-primary",
    {
      backgroundColor: "{colors.accent}",
      textColor: `{colors.${onAccent}}`,
      typography: `${sansFont} ${nearestWeight(600)}`,
      rounded: radiusRef(synthRadius),
      padding: cleanPad(primaryBtn?.padding) ?? "16px 36px",
      description:
        "Primary CTA — the brand accent at the brand's own button geometry (synthesized: no usable filled CTA was captured).",
    },
  ]);
} else {
  components.push(
    compFromButton(
      primaryBtn,
      "button-primary",
      "Primary solid action button (the site's most prominent filled CTA — accent-colored or a bold neutral pill).",
    ),
  );
}
if (secondaryBtn)
  components.push(
    compFromButton(secondaryBtn, "button-secondary", "Secondary / outline button (bordered)."),
  );
extraBtns
  .slice(0, 2)
  .forEach((b, i) =>
    components.push(
      compFromButton(b, `button-${i + 3}`, "Additional button variant captured from the site."),
    ),
  );
// frame-scale CTA variant: button-primary's fill/radius/border/shadow re-scaled to video size (cqw).
const primaryComp = components.find((c) => c[0] === "button-primary");
if (primaryComp) {
  const p = primaryComp[1];
  components.push([
    "button-primary-giant",
    {
      backgroundColor: p.backgroundColor,
      backgroundImage: p.backgroundImage,
      textColor: p.textColor,
      typography: p.typography,
      fontSize: "2.4cqw",
      rounded: p.rounded,
      padding: "1.5cqw 3.4cqw",
      border: p.border,
      shadow: p.shadow,
      description:
        "Frame-scale primary CTA — button-primary's atoms at video size; compose into hero/plate frames.",
    },
  ]);
}

// cards: emit each distinct card that carries a real skin (radius/border/shadow) with its own effects.
const hasSkin = (c) =>
  radiusRef(c.borderRadius) !== "0px" || cleanBorder(c.border) || cleanShadow(c.boxShadow);
let cleanCards = (styles.cards ?? [])
  .map((c) => cleanComp(c, cleanShadow(c?.boxShadow) || cleanBorder(c?.border) ? 900 : 480))
  .filter(Boolean)
  .filter(hasSkin);
{
  const seen = new Set();
  cleanCards = cleanCards.filter((c) => {
    const sig = `${upper(c.background)}|${radiusRef(c.borderRadius)}|${cleanShadow(c.boxShadow) ? "s" : "_"}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
// float the lead card: prefer one with a shadow; else graft the site's strong global elevation (blur ≥16px) if any.
const shadowBlur = (s) => {
  const m = /(-?\d+)px\s+(-?\d+)px\s+(\d+)px/.exec(String(s ?? ""));
  return m ? parseInt(m[3], 10) : 0;
};
const strongShadow = (styles.shadows ?? [])
  .map((s) => (typeof s === "string" ? s : s?.value))
  .filter(Boolean)
  .find((s) => shadowBlur(s) >= 16);
cleanCards.sort((a, b) => (cleanShadow(b.boxShadow) ? 1 : 0) - (cleanShadow(a.boxShadow) ? 1 : 0));
if (cleanCards.length && !cleanShadow(cleanCards[0].boxShadow) && strongShadow) {
  cleanCards[0] = { ...cleanCards[0], boxShadow: strongShadow };
}
if (cleanCards.length) {
  cleanCards.slice(0, 3).forEach((c, i) =>
    components.push([
      i ? `card-${i + 1}` : "card",
      {
        backgroundColor: groundToken(c),
        rounded: radiusRef(c.borderRadius),
        border: cleanBorder(c.border),
        shadow: cleanShadow(c.boxShadow) ?? "none",
        description: "Content surface captured from the site (its own radius / border / shadow).",
      },
    ]),
  );
} else {
  const cardEntry = (styles.cards ?? [])
    .map((c) => cleanComp(c, 1e9))
    .filter(Boolean)
    .find(hasSkin);
  components.push([
    "card",
    {
      backgroundColor: surface ? "{colors.surface}" : "{colors.canvas}",
      rounded: cardEntry ? radiusRef(cardEntry.borderRadius) : radii.length ? "{radii.r1}" : "0px",
      border: cardEntry ? cleanBorder(cardEntry.border) : null,
      shadow: cardEntry ? (cleanShadow(cardEntry.boxShadow) ?? "none") : "none",
      description: "Content surface. Flat (no shadow) when the site uses none.",
    },
  ]);
}

// nav-bar height (only when the captured nav isn't degenerate)
const navC = styles.nav && cleanComp(styles.nav, 200);
if (navC && px(navC.height) != null) {
  components.push([
    "nav-bar",
    {
      backgroundColor: `{colors.${keyFor(navC.background)}}`,
      height: navC.height,
      description:
        "Top-nav ground/height — use sparingly in video (one establishing frame at most).",
    },
  ]);
}

// frosted-glass material (translucent fill + backdrop blur), fill kept verbatim so its alpha survives.
const glass0 = (styles.glass ?? [])[0];
if (glass0 && /blur/.test(String(glass0.backdropFilter))) {
  const gBg = String(glass0.background ?? "").trim();
  const isGrad = /gradient/.test(gBg);
  const translucent = /rgba?\([^)]*[,/]\s*(?:0?\.\d+)\s*\)/i.test(gBg);
  components.push([
    "glass-panel",
    {
      backgroundColor: isGrad ? null : translucent ? gBg : "rgba(255,255,255,0.6)",
      backgroundImage: isGrad ? cleanGradient(gBg) : null,
      backdropFilter: String(glass0.backdropFilter).replace(/\s+/g, " ").trim(),
      border: cleanBorder(glass0.border),
      rounded: radiusRef(glass0.borderRadius),
      shadow: cleanShadow(glass0.boxShadow),
      description:
        "Frosted-glass panel: translucent fill + backdrop blur — composite over a colored ground.",
    },
  ]);
}

// dedup helper by ground+radius+border
const dedupComps = (list) => {
  const seen = new Set();
  return list.filter((c) => {
    const sig = `${upper(c.background)}|${radiusRef(c.borderRadius)}|${cleanBorder(c.border) ? "b" : "_"}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
};

// chips / pills / badges / tags → chip, chip-2 (drop invisible-text matches, same guard as buttons)
const cleanChips = dedupComps(
  (styles.chips ?? [])
    .map((c) => cleanComp(c, 60))
    .filter(Boolean)
    .filter(visible),
);
cleanChips
  .slice(0, 2)
  .forEach((c, i) =>
    components.push(
      compFromButton(c, i ? `chip-${i + 1}` : "chip", "Pill / badge / tag — small rounded label."),
    ),
  );

// tabs → tab
const cleanTabs = dedupComps(
  (styles.tabs ?? [])
    .map((c) => cleanComp(c, 64))
    .filter(Boolean)
    .filter(visible),
);
if (cleanTabs[0]) components.push(compFromButton(cleanTabs[0], "tab", "Tab control."));

// stat cells → a stat-num TYPOGRAPHY token (the big numeral, most reusable) + a stat-cell surface
// only when it's a real card (has a border or radius, not a bare transparent block).
const statList = (styles.statCells ?? []).filter((s) => px(s.numberFontSize) != null);
if (statList.length && !typeRoles.some((t) => t.role === "stat-num")) {
  const s0 = statList[0];
  const nc = toHex(s0.numberColor);
  typeRoles.push({
    role: "stat-num",
    fontFamily: displayFamily,
    cqw: toCqw(px(s0.numberFontSize)),
    weight: nearestWeight(parseInt(s0.numberFontWeight, 10) || 600),
    lineHeight: 1.0,
    color: nc ? keyFor(nc) : "accent",
  });
  const cellBorder = cleanBorder(s0.border);
  if (cellBorder || (px(s0.borderRadius) ?? 0) > 0) {
    const cellBg = toHex(s0.background);
    components.push([
      "stat-cell",
      {
        backgroundColor: cellBg ? `{colors.${keyFor(cellBg)}}` : "{colors.surface}",
        rounded: radiusRef(s0.borderRadius),
        border: cellBorder,
        typography: "{typography.stat-num}",
        description: "Metric cell — a large numeral ({typography.stat-num}) over a small label.",
      },
    ]);
  }
}

// ── 7. assemble frontmatter ─────────────────────────────────────────────────────
// double-quoted YAML scalar — escape backslash + quote so a title/value with `"` can't break the doc.
const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const yamlColors = palette.map(([k, v]) => `  ${k}: ${q(v)}`).join("\n");
// grounds: the ranked page grounds (bg + best-contrast on-color + kind), for full-bleed frames.
const yamlGrounds = grounds.length
  ? `\ngrounds:\n${grounds
      .map((g) => `  - { bg: ${q(g.bg)}, on: ${q(g.on)}, kind: ${q(g.kind)} }`)
      .join("\n")}\n`
  : "";
const yamlRadii = radii.length
  ? `\nradii:\n${radii.map((r, i) => `  r${i + 1}: ${q(r)}`).join("\n")}\n`
  : "";
const yamlShadows = shadows.length
  ? `\nshadows:\n${shadows.map((s, i) => `  shadow-${i + 1}: ${q(s)}`).join("\n")}\n`
  : "";
// gradient/mesh washes (the site's signature color grounds) — cleaned via the hoisted cleanGradient,
// ranked by on-screen area.
const gradients = (styles.backgrounds ?? [])
  .map((b) => cleanGradient(b?.value))
  .filter(Boolean)
  .slice(0, 4);
const yamlGradients = gradients.length
  ? `\ngradients:\n${gradients.map((g, i) => `  gradient-${i + 1}: ${q(g)}`).join("\n")}\n`
  : "";
const typeLine = (t) => {
  const parts = [`fontFamily: ${q(t.fontFamily)}`];
  if (t.cqw != null) parts.push(`cqw: ${t.cqw}`);
  if (t.px != null) parts.push(`px: ${t.px}`);
  parts.push(`weight: ${t.weight}`);
  if (t.lineHeight != null) parts.push(`lineHeight: ${t.lineHeight}`);
  if (t.tracking) parts.push(`tracking: ${q(t.tracking)}`);
  if (t.color) parts.push(`color: ${q(t.color)}`);
  return `  ${t.role}: { ${parts.join(", ")} }`;
};
const yamlType =
  `  # — reading ramp (captured px → frame-relative cqw) —\n` +
  typeRoles.map(typeLine).join("\n") +
  `\n  # — display / hero ramp (frame-native, video-scale) —\n` +
  heroRamp.map(typeLine).join("\n");
const yamlSpacing = spacing.length
  ? spacing.map(([k, v]) => `  ${k}: ${q(v)}`).join("\n")
  : '  pad-edge: "4cqw"';
const yamlComponents = components
  .map(
    ([name, body]) =>
      `  ${name}:\n${Object.entries(body)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `    ${k}: ${q(v)}`)
        .join("\n")}`,
  )
  .join("\n");

// keep the name a safe plain YAML scalar: drop ':' / '#' (would start a mapping/comment) and quotes.
const siteName =
  String(tokens.title || "Captured site")
    .split("|")[0]
    .replace(/["#:]/g, "")
    .trim() || "Captured site";
const siteDesc = String(tokens.description || "")
  .replace(/\n/g, " ")
  .trim();

let md = `---
version: alpha
name: ${siteName} — Frame (video / frame layer)
description: >
  Frame-scale design system generated from a capture of ${siteName}. The unit is the frame
  (${frameWidth}×1080). Colors, typography, spacing, radii, and components below are extracted
  from the live site and are normative — quote them verbatim.${siteDesc ? `\n  Source tagline: ${siteDesc}` : ""}
unit: the frame — ${frameWidth}×1080 primary; 9:16 and 1:1 documented
principle: atoms are sacred · composition is free · numbers come from the script

colors:
${yamlColors}
${yamlGrounds}${yamlRadii}${yamlShadows}${yamlGradients}
typography:
${yamlType}

spacing:
${yamlSpacing}

components:
${yamlComponents}
---

# ${siteName} — Frame

## Overview

Generated from a \`hyperframes capture\` of **${siteName}**. The YAML frontmatter above is the
source of truth (extracted from the live site); the prose below is a skeleton to fill in with
creative intent. Strict on brand (the hex values, font families, weight relationships); free on
layout (compose frames as the script needs).

## Colors

${palette.map(([k, v]) => `- \`${k}\` — \`${v}\``).join("\n")}

Accent (\`accent\`) is the brand's recurring chromatic color; reserve it for emphasis and the
primary action. \`canvas\` is the page ground; \`ink\` the dominant reading color.

## Typography

**Reading ramp** (captured, faithful):

${typeRoles.map((t) => `- \`${t.role}\` — ${t.fontFamily} ${t.weight}${t.cqw != null ? `, ${t.cqw}cqw` : t.px != null ? `, ${t.px}px` : ""}`).join("\n")}

**Display / hero ramp** (frame-native, video-scale — for cover & oversized-claim frames):

${heroRamp.map((t) => `- \`${t.role}\` — ${t.fontFamily} ${t.weight}, ${t.cqw}cqw`).join("\n")}

Reading-ramp sizes are the captured web px converted to frame-relative \`cqw\` at ${frameWidth}px width —
faithful to the source. The hero ramp is added for video legibility (a 1.4cqw ≈ 27px legibility floor
applies to any load-bearing line).

## Components

${components.map(([n]) => `- \`${n}\``).join("\n") || "- (none cleanly extracted)"}

## Known Gaps

- Prose sections (Composition Rules, Do's/Don'ts, Frame Treatments) are intentionally left as a
  skeleton — fill them from the screenshots in \`screenshots/\`.
- Component extraction is conservative: noisy/section-sized DOM matches were dropped.
`;

// ── 8. append the @font-face block (fonts were already staged up top) ─────────
md += fontStaging.block;

// ── 9. write ───────────────────────────────────────────────────────────────────
writeFileSync(outPath, md);
console.log(`✓ build-frame-from-capture → ${outPath}`);
console.log(`  colors: ${palette.map(([k]) => k).join(", ")}`);
console.log(
  `  typography: ${typeRoles.length} roles · radii: ${radii.length} · shadows: ${shadows.length} · components: ${components.map(([n]) => n).join(", ") || "none"}`,
);
console.log(
  `  fonts: ${brandFonts.join(", ") || "none"} (weights ${brandWeights.join("/") || "?"})`,
);
