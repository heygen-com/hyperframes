#!/usr/bin/env node
// build-frame.mjs — Step 2 design system in ONE command. The LLM only chooses a
// preset; this does the deterministic rest: copy the preset's FRAME.md → frame.md,
// remix its colors/typography onto the project's brand tokens, copy the preset's
// caption-skin.html, and self-validate. "Strict on brand" is deterministic, so it's
// a script, not LLM hand-editing (which mis-copies hex / breaks keys).
//
//   node build-frame.mjs --preset capsule --hyperframes .
//     [--tokens capture/extracted/tokens.json]  [--preset-dir <abs path to frame-presets>]
//
// Remix rule — ONLY `colors:` values and `typography:` fontFamily change; keys,
// structure, geometry, and components are untouched:
//   colors — map brand tokens onto the preset's keys BY ROLE: the ink-role key takes
//            the brand ink (darkest/ink-named), the canvas-role key takes the brand
//            canvas (lightest), and every other color is repainted with the nearest
//            brand accent's hue+saturation while KEEPING its own lightness, so tint
//            families (sun / sun-soft / haze) stay a family. Empty brand colors → the
//            preset palette is kept (it is already a complete, good design).
//   fonts  — the preset's display family → the brand display font, its body family →
//            the brand body font, wherever they appear. Empty brand fonts → kept.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  brandRolesFromStats,
  chroma,
  lum,
  parseColors,
  parseFonts,
  pickAccent,
  semanticColors,
  STATUS_ROLE_KEY,
  UA_DEFAULT_COLORS,
} from "./lib/tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const die = (m) => {
  console.error(`✗ build-frame: ${m}`);
  process.exit(1);
};

const presetName = flag("preset", null);
const hyperframesDir = resolve(flag("hyperframes", "."));
const presetDir = resolve(
  flag("preset-dir", join(__dirname, "../../hyperframes-creative/frame-presets")),
);
const tokensPath = resolve(flag("tokens", join(hyperframesDir, "capture/extracted/tokens.json")));

if (!presetName) die("--preset <name> is required");
const presetFrame = join(presetDir, presetName, "FRAME.md");
if (!existsSync(presetFrame)) {
  const avail = existsSync(presetDir)
    ? readdirSync(presetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  die(
    `no FRAME.md for preset "${presetName}" under ${presetDir}\n  available: ${avail.join(", ")}`,
  );
}

// ── HSL helpers (recolor = brand hue+sat, original lightness) ──────────────────
function hexToHsl(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
  if (d !== 0) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hslToHex(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const hue = (p, q, t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (x) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}
const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHsl = (r, g, b) =>
  hexToHsl("#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join(""));
// Repaint a chromatic rgba()/rgb() tint with the brand accent's RGB, keeping its alpha.
// A near-neutral rgb (shadow / scrim overlay) is left untouched; a non-rgba string → null.
function remapRgbaToAccent(val, brAccent, brAccent2, prAccentHsl, prAccent2Hsl) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
    String(val).trim(),
  );
  if (!m) return null;
  const r = +m[1],
    g = +m[2],
    b = +m[3],
    a = m[4];
  if (Math.max(r, g, b) - Math.min(r, g, b) < 16) return null; // neutral overlay — keep as-is
  const src = rgbToHsl(r, g, b);
  const useSecond =
    brAccent2 &&
    prAccentHsl &&
    prAccent2Hsl &&
    src &&
    hueDist(src.h, prAccent2Hsl.h) < hueDist(src.h, prAccentHsl.h);
  const t = hexToRgb(useSecond ? brAccent2 : brAccent);
  if (!t) return null;
  return a !== undefined
    ? `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${a})`
    : `rgb(${t[0]}, ${t[1]}, ${t[2]})`;
}

// ── brand tokens ──────────────────────────────────────────────────────────────
let brandColors = [];
let brandFonts = [];
let brandFontWeights = []; // weights the brand text font actually ships (tokens fonts[].weights)
let brandColorStats = []; // rich per-color usage stats (areaBg / interactiveBg / textCount …)
// Icon/glyph fonts capture surfaces as "fonts" — they are never the brand text face
// (webflow-icons, Font Awesome, icomoon …) and must not become display/body or contribute weights.
const isIconFont = (name) =>
  /(?:^|[\s_-])icons?(?:[\s_-]|$)|icomoon|font\s*-?awesome|glyphicons?|material\s*icons|feather\s*icons/i.test(
    String(name),
  );
if (existsSync(tokensPath)) {
  try {
    const t = JSON.parse(readFileSync(tokensPath, "utf8"));
    brandColors = (t.colors ?? [])
      .map((c) => (typeof c === "string" ? c : (c?.hex ?? c?.value ?? "")))
      .map((c) => String(c).trim())
      .filter((c) => /^#?[0-9a-fA-F]{6}$/.test(c))
      .map((c) => (c.startsWith("#") ? c : `#${c}`));
    brandFonts = (t.fonts ?? [])
      .map((f) => (typeof f === "string" ? f : (f?.family ?? f?.name ?? "")))
      .map((f) => String(f).split(",")[0].replace(/['"]/g, "").trim())
      .filter(Boolean)
      .filter((f) => !isIconFont(f));
    // Union of the (non-icon) brand fonts' available weights — used to clamp the preset's
    // type ramp so a font shipping only 400/500 never faux-bolds a 600/700 heading.
    brandFontWeights = [
      ...new Set(
        (t.fonts ?? [])
          .filter((f) => f && typeof f === "object" && !isIconFont(f.family ?? f.name ?? ""))
          .flatMap((f) => (Array.isArray(f.weights) ? f.weights : []))
          .map((w) => parseInt(w, 10))
          .filter((w) => Number.isFinite(w)),
      ),
    ].sort((a, b) => a - b);
    brandColorStats = Array.isArray(t.colorStats) ? t.colorStats : [];
  } catch (e) {
    die(`tokens.json parse: ${e.message}`);
  }
}

let md = readFileSync(presetFrame, "utf8");
const presetColors = parseColors(md);
const summary = [];

// ── color remix ───────────────────────────────────────────────────────────────
if (brandColors.length && presetColors.length) {
  const pr = semanticColors(presetColors);
  // Brand roles: prefer the function-based reading of capture colorStats (canvas =
  // largest background, accent = top interactive bg, ink = dominant contrasting text).
  // Fall back to the legacy luminance/chroma heuristic only when stats are absent —
  // but pick the accent via pickAccent either way so a UA-default link color never wins.
  const br =
    brandRolesFromStats(brandColorStats, brandColors) ??
    (() => {
      // strip UA-default link colors so a stray <a> color can't become ink/canvas/accent
      const clean = brandColors.filter((h) => !UA_DEFAULT_COLORS.has(h.toUpperCase()));
      const s = semanticColors(clean.map((h, i) => [`c${i}`, h]));
      return {
        ink: s.ink,
        canvas: s.canvas,
        accent: pickAccent(brandColorStats, clean, [s.ink, s.canvas]) ?? s.accent,
        accent2: s.accent2,
      };
    })();
  if (!br.accent) die("accent 选取失败：品牌色里没有可用的强调色");
  if (chroma(br.accent) <= 40) {
    console.warn(
      `  ⚠ accent ${br.accent} 彩度很低 (${chroma(br.accent)}) — 确认这是品牌色而非中性/默认色`,
    );
  }
  // Map by LUMINANCE POLARITY. The preset's darker value takes the brand's darker value and
  // the lighter takes the lighter — UNLESS the brand's GROUND polarity differs from the
  // preset's. Every shipped preset is light-ground; a dark-mode brand (Linear, Vercel,
  // Raycast…) has its canvas darker than its ink (colorStats already resolved the real
  // ground as the largest-area background). On a polarity MISMATCH we INVERT the mapping so a
  // light preset becomes the dark brand (canvas↔ink swap) instead of forcing the brand onto
  // an off-brand light video; neutral/tint lightness is then mirrored (L→1−L) so the whole
  // palette flips to the brand's ground. Same-polarity (the common case) is unchanged.
  const darker = (a, b) => ((lum(a) ?? 0) <= (lum(b) ?? 0) ? a : b);
  const prDark = darker(pr.ink, pr.canvas);
  const prLight = prDark === pr.ink ? pr.canvas : pr.ink;
  const brDark = darker(br.ink, br.canvas);
  const brLight = brDark === br.ink ? br.canvas : br.ink;
  const presetGroundDark = (lum(pr.canvas) ?? 255) < (lum(pr.ink) ?? 0);
  const brandGroundDark = (lum(br.canvas) ?? 255) < (lum(br.ink) ?? 0);
  const invert = presetGroundDark !== brandGroundDark;
  const mapDark = invert ? brLight : brDark; // preset's dark value → this brand value
  const mapLight = invert ? brDark : brLight; // preset's light value → this brand value
  const flipL = (l) => (invert ? 1 - l : l); // mirror tint/neutral lightness when flipping
  const prAccentHsl = hexToHsl(pr.accent);
  const prAccent2Hsl = hexToHsl(pr.accent2);
  const newByKey = new Map();
  for (const [key, val] of presetColors) {
    const ph = hexToHsl(val);
    let next;
    if (val === prDark) next = mapDark;
    else if (val === prLight) next = mapLight;
    else if (STATUS_ROLE_KEY.test(key))
      // semantic status colors (green/red …) — the HUE carries the meaning; never repaint.
      // MUST precede the accent checks: a preset's red "negative" is often its 2nd-most-chromatic
      // color and would otherwise be claimed as accent2 and recolored to the brand hue.
      next = val;
    else if (val === pr.accent)
      next = br.accent; // primary accent → the EXACT brand color
    else if (pr.accent2 !== pr.accent && val === pr.accent2)
      next = br.accent2; // exact 2nd accent
    else if (!ph) {
      // rgba()/rgb() tint → repaint its rgb with the brand accent, keep alpha (a neutral
      // overlay is kept). A non-color non-hex value (var(), named) falls through unchanged.
      next = remapRgbaToAccent(val, br.accent, br.accent2, prAccentHsl, prAccent2Hsl) ?? val;
    } else if (chroma(val) < 16) {
      // NEUTRAL source (grey text-ladder, hairline borders) → keep it NEUTRAL. Apply at most a
      // whisper of the brand hue (sat ≤ 0.06); never the accent's full saturation — that is what
      // turned the grey ladder into saturated blue.
      const bh = hexToHsl(br.accent);
      next = bh ? hslToHex(bh.h, Math.min(ph.s, 0.06), flipL(ph.l)) : val;
    } else {
      // chromatic tint → repaint with the nearest brand accent's hue+sat, keep THIS color's
      // lightness so tint families stay families.
      const useSecond =
        pr.accent !== pr.accent2 &&
        prAccentHsl &&
        prAccent2Hsl &&
        hueDist(ph.h, prAccent2Hsl.h) < hueDist(ph.h, prAccentHsl.h);
      const bh = hexToHsl(useSecond ? br.accent2 : br.accent);
      next = bh ? hslToHex(bh.h, bh.s, flipL(ph.l)) : val;
    }
    if (next !== val) newByKey.set(key, next);
  }
  // rewrite only the value of each colors: line; everything else byte-identical.
  let inBlock = false;
  md = md
    .split(/\r?\n/)
    .map((line) => {
      if (/^colors:\s*$/.test(line)) {
        inBlock = true;
        return line;
      }
      if (inBlock && /^\S/.test(line)) inBlock = false;
      if (!inBlock) return line;
      const m = line.match(
        /^(\s+)([\w-]+):\s*(?:"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[^#\n]*?)(\s+#.*)?$/,
      );
      if (m && newByKey.has(m[2])) return `${m[1]}${m[2]}: "${newByKey.get(m[2])}"${m[3] ?? ""}`;
      return line;
    })
    .join("\n");
  summary.push(
    `colors: ${invert ? "INVERTED (dark-mode brand on light preset) · " : ""}dark ${prDark}→${mapDark}, light ${prLight}→${mapLight}, accent ${pr.accent}→${br.accent}` +
      ` (${newByKey.size}/${presetColors.length} keys repainted${brandColorStats.length ? ", via colorStats" : ""})`,
  );
} else {
  summary.push(
    brandColors.length
      ? "colors: preset has no parseable colors — kept"
      : "colors: no brand colors — preset palette kept",
  );
}

// ── font remix ────────────────────────────────────────────────────────────────
if (brandFonts.length) {
  const pf = parseFonts(md);
  const strip = (q) => (q ? q.replace(/^"|"$/g, "") : null);
  const pDisplay = strip(pf.display);
  const pBody = strip(pf.body);
  const pMono = strip(pf.mono);
  // A monospace brand face is for code / labels / chrome — never the reading display or body.
  // Split the brand fonts: the primary NON-mono family carries display AND body (the common
  // single-sans case, e.g. Inter for everything), and a captured mono (Berkeley Mono,
  // JetBrains Mono…) is routed onto the preset's mono role instead of turning the body
  // monospace. (Distinct display/body brands still resolve to a clean sans; hand-tune the
  // display in frame.md if a separate display face is wanted.)
  const isMonoFont = (n) =>
    /(?:^|[\s_-])mono(?:[\s_-]|$)|monospace|consol|courier|menlo|monaco|jetbrains|berkeley|space\s*mono|ibm\s*plex\s*mono|sf\s*mono|roboto\s*mono|source\s*code|fira\s*code|geist\s*mono|dm\s*mono/i.test(
      String(n),
    );
  const nonMono = brandFonts.filter((f) => !isMonoFont(f));
  const monoFonts = brandFonts.filter(isMonoFont);
  const bDisplay = nonMono[0] ?? brandFonts[0];
  const bBody = nonMono[0] ?? brandFonts[0];
  const bMono = monoFonts[0] ?? null;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Replace the preset family as a WHOLE WORD/PHRASE everywhere — frontmatter values,
  // component strings like "Space Grotesk 600", AND prose — case-sensitive with word
  // boundaries so a single-word family ("Inter") can never corrupt a substring
  // ("interactive"). Quote-exact replace alone missed names baked into longer strings + prose.
  const swapFamily = (from, to) => {
    if (from && to && from !== to) md = md.replace(new RegExp(`\\b${escRe(from)}\\b`, "g"), to);
  };
  swapFamily(pDisplay, bDisplay);
  if (pBody !== pDisplay) swapFamily(pBody, bBody);
  // route the brand mono onto the preset's mono role (only if the preset has a DISTINCT mono
  // family — never collapse body/display into mono)
  if (bMono && pMono && pMono !== pBody && pMono !== pDisplay) swapFamily(pMono, bMono);
  summary.push(
    `fonts: display ${pDisplay}→${bDisplay}, body ${pBody}→${bBody}` +
      (bMono && pMono && pMono !== pBody && pMono !== pDisplay ? `, mono ${pMono}→${bMono}` : ""),
  );
} else {
  summary.push("fonts: no brand fonts — preset fonts kept");
}

// ── stage preset-owned offline font faces ────────────────────────────────────
// PR ingestion has no captured brand fonts. Presets that own a type system must
// therefore carry their own licensed files instead of depending on a first-run
// Google Fonts fetch or a renderer-only embedding path that Studio workers cannot see.
const presetFontsDir = join(presetDir, presetName, "fonts");
if (existsSync(presetFontsDir)) {
  const fontSpecs = [
    ["EB Garamond", "EBGaramond", 400],
    ["EB Garamond", "EBGaramond", 700],
    ["Inter", "Inter", 400],
    ["Inter", "Inter", 700],
    ["JetBrains Mono", "JetBrainsMono", 400],
    ["JetBrains Mono", "JetBrainsMono", 700],
  ];
  const outDir = join(hyperframesDir, "assets/fonts");
  const faces = [];
  for (const [family, stem, weight] of fontSpecs) {
    const file = `${stem}-${weight}.woff2`;
    const source = join(presetFontsDir, file);
    if (!existsSync(source)) die(`preset font is missing: ${source}`);
    mkdirSync(outDir, { recursive: true });
    copyFileSync(source, join(outDir, file));
    faces.push(
      `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:block;src:url("assets/fonts/${file}") format("woff2");}`,
    );
  }
  md +=
    `\n\n## Font loading (preset-owned, offline)\n\n` +
    `These licensed faces are staged in \`assets/fonts/\`. Paste this block inside every frame template; do not link Google Fonts:\n\n` +
    "```html\n<style>\n" +
    faces.join("\n") +
    "\n</style>\n```\n";
  summary.push(`fonts: staged ${fontSpecs.length} preset face(s) for offline preview/render`);
}

// ── cap type weights to the brand font's available faces ──────────────────────
// The remix swaps the font FAMILY but keeps the preset's weights; a brand font that ships
// only e.g. 400/500 would faux-bold every 600/700 heading. Clamp each `typography:` weight
// to the NEAREST weight the brand font actually provides (tokens.json fonts[].weights).
if (brandFonts.length && brandFontWeights.length) {
  const avail = brandFontWeights;
  const nearest = (n) =>
    avail.reduce((best, w) => {
      const dw = Math.abs(w - n),
        db = Math.abs(best - n);
      return dw < db || (dw === db && w > best) ? w : best;
    }, avail[0]);
  let capped = 0;
  const cap = (num) => {
    const n = parseInt(num, 10);
    if (avail.includes(n)) return String(n);
    const c = nearest(n);
    if (c !== n) capped++;
    return String(c);
  };
  let inType = false;
  md = md
    .split(/\r?\n/)
    .map((line) => {
      if (/^typography:\s*$/.test(line)) {
        inType = true;
        return line;
      }
      if (inType && /^\S/.test(line)) inType = false;
      let out = line;
      // (a) structured `weight: NNN` in the typography ramp
      if (inType) out = out.replace(/(\bweight:\s*)(\d{3})\b/g, (m, pfx, num) => pfx + cap(num));
      // (b) a weight baked into a quoted `typography:` component value, e.g.
      //     cta-button → typography: "Basier Square 600"  (NNN not followed by a unit like px)
      out = out.replace(
        /(typography:\s*"[^"]*?\b)(\d{3})\b(?![a-z%])/gi,
        (m, pfx, num) => pfx + cap(num),
      );
      return out;
    })
    .join("\n");
  if (capped)
    summary.push(`fonts: capped ${capped} type weight(s) to brand faces {${avail.join(", ")}}`);
}

// ── brand-adaptation note ─────────────────────────────────────────────────────
// The remix fixes the NORMATIVE frontmatter, but the preset's PROSE still carries its
// original weight ranges / color-names. Prepend a short "frontmatter is truth" header so a
// reader (or frame worker) interprets any lingering preset prose THROUGH the brand values —
// instead of fragile per-sentence prose surgery.
if (brandFonts.length || (brandColors.length && presetColors.length)) {
  const bD = brandFonts[0];
  const bB = brandFonts[1] ?? brandFonts[0];
  const note =
    `## Brand adaptation (READ FIRST — the frontmatter is the source of truth)\n\n` +
    `This is the **${presetName}** preset remixed onto the captured brand. The YAML frontmatter above ` +
    `(colors · typography · components) is **normative and already correct — use it verbatim.** The prose ` +
    `below is the ORIGINAL preset's intent; read it THROUGH the frontmatter:\n\n` +
    (brandFonts.length
      ? `- **Fonts** — already set to **${bD}** (display) / **${bB}** (body); ignore any preset font name lingering in prose.\n`
      : "") +
    (brandFontWeights.length
      ? `- **Weights** — the brand font ships \`{${brandFontWeights.join(", ")}}\` only; every weight is clamped to these — ignore higher preset weights (e.g. 600/700) in prose.\n`
      : "") +
    `- **Colors** — use the frontmatter hex; preset color NAMES in prose (e.g. "cobalt", "cream") mean the remapped brand values.\n`;
  if (/^# .*$/m.test(md)) md = md.replace(/^# .*$/m, (m) => `${m}\n\n${note}`);
  else md = `${note}\n${md}`;
  summary.push("brand-adaptation note prepended");
}

// ── stage brand font files + emit @font-face ──────────────────────────────────
// A brand font is rarely a Google font, so renaming the family in frame.md is not enough:
// nothing loads the actual face. If the capture downloaded font files, copy them to
// assets/fonts/ under CLEAN, weight-named names (so captions.mjs' family-prefix matcher
// finds them too) and append a ready-to-paste, ROOT-RELATIVE @font-face block to frame.md.
if (brandFonts.length) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const extOf = (f) => (f.match(/\.(woff2|woff|ttf|otf)$/i)?.[1] ?? "").toLowerCase();
  const FMT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
  const weightInfo = (name) => {
    const s = name.toLowerCase();
    if (/black|heavy|ultra|extrabold/.test(s)) return { n: 800, w: "ExtraBold" };
    if (/semibold|demibold/.test(s)) return { n: 600, w: "SemiBold" };
    if (/bold/.test(s)) return { n: 700, w: "Bold" };
    if (/medium/.test(s)) return { n: 500, w: "Medium" };
    if (/light|thin/.test(s)) return { n: 300, w: "Light" };
    return { n: 400, w: "Regular" };
  };
  const fams = [...new Set(brandFonts)];
  const srcDirs = [
    join(hyperframesDir, "capture/assets/fonts"),
    join(hyperframesDir, "assets/fonts"),
  ].filter((d) => existsSync(d));
  const files = [];
  for (const d of srcDirs)
    for (const f of readdirSync(d).sort()) if (extOf(f)) files.push({ d, f });
  // Single family → all font files belong to it (the common captured case, hash-named files
  // included). Multiple families → assign each file to the longest family key its name contains.
  const ranked = [...fams].sort((a, b) => norm(b).length - norm(a).length);
  const famOf = (f) =>
    fams.length === 1 ? fams[0] : ranked.find((x) => norm(f).includes(norm(x)));
  const outDir = join(hyperframesDir, "assets/fonts");
  const faces = [];
  const stagedNames = new Set();
  for (const { d, f } of files) {
    const fam = famOf(f);
    if (!fam) continue;
    const { n, w } = weightInfo(f);
    const clean = `${fam.replace(/[^A-Za-z0-9]/g, "")}-${w}.${extOf(f)}`;
    if (stagedNames.has(clean)) continue;
    mkdirSync(outDir, { recursive: true });
    if (!existsSync(join(outDir, clean))) copyFileSync(join(d, f), join(outDir, clean));
    stagedNames.add(clean);
    faces.push(
      `@font-face{font-family:"${fam}";font-weight:${n};font-style:normal;font-display:block;src:url("assets/fonts/${clean}") format("${FMT[extOf(f)]}");}`,
    );
  }
  if (faces.length) {
    md +=
      `\n\n## Font loading (auto-generated)\n\n` +
      `The brand font ships as local files in \`assets/fonts/\` — do NOT link Google Fonts for it. ` +
      `Paste this \`<style>\` into every frame's \`<head>\`/\`<template>\` (captions use the same files) ` +
      `so \`font-family\` resolves in preview, snapshot, and render alike:\n\n` +
      "```html\n<style>\n" +
      faces.join("\n") +
      "\n</style>\n```\n";
    summary.push(
      `fonts: staged ${stagedNames.size} face(s) → assets/fonts/ + @font-face in frame.md`,
    );
  }
}

// ── write frame.md ────────────────────────────────────────────────────────────
const framePath = join(hyperframesDir, "frame.md");
writeFileSync(framePath, md);

// ── copy caption-skin.html ────────────────────────────────────────────────────
const presetSkin = join(presetDir, presetName, "caption-skin.html");
let skinCopied = false;
if (existsSync(presetSkin)) {
  const skinDir = join(hyperframesDir, ".hyperframes");
  mkdirSync(skinDir, { recursive: true });
  copyFileSync(presetSkin, join(skinDir, "caption-skin.html"));
  skinCopied = true;
}

// ── self-validate ─────────────────────────────────────────────────────────────
const outColors = parseColors(md);
if (outColors.length !== presetColors.length) {
  die(`color keys changed (${presetColors.length}→${outColors.length}) — keys must be preserved`);
}
const outRoles = semanticColors(outColors);
const li = lum(outRoles.ink),
  lc = lum(outRoles.canvas);
// ink (type) and canvas (ground) must differ enough to READ — in EITHER direction. A
// light-mode spec has ink darker than canvas; a dark-mode spec (the polarity flip above)
// the reverse. Assert luminance SEPARATION, not a fixed polarity.
if (li != null && lc != null && Math.abs(li - lc) < 40) {
  die(
    `ink (${outRoles.ink}, lum ${li.toFixed(0)}) and canvas (${outRoles.canvas}, lum ${lc.toFixed(0)}) lack contrast — bad brand mapping`,
  );
}

console.log(`✓ build-frame: ${presetName} → ${framePath}`);
for (const s of summary) console.log(`  ${s}`);
console.log(
  `  .hyperframes/caption-skin.html: ${skinCopied ? "copied" : "preset ships none — captions will use the default pill"}`,
);
console.log(`  self-check: keys preserved, ink/canvas contrast ok ✓`);
