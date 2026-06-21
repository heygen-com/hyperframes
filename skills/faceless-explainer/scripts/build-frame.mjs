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

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// ── brand tokens ──────────────────────────────────────────────────────────────
let brandColors = [];
let brandFonts = [];
let brandColorStats = []; // rich per-color usage stats (areaBg / interactiveBg / textCount …)
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
      .filter(Boolean);
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
    brandRolesFromStats(brandColorStats) ??
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
  // Map by LUMINANCE POLARITY, not by role name: the preset's darker neutral takes the
  // brand's darker neutral, the lighter takes the lighter. So a dark-ground preset stays
  // dark and a light-ground preset stays light — both land on the brand's real values,
  // even when the brand's canvas is dark (dark-mode brand) and ink is light.
  const darker = (a, b) => ((lum(a) ?? 0) <= (lum(b) ?? 0) ? a : b);
  const prDark = darker(pr.ink, pr.canvas);
  const prLight = prDark === pr.ink ? pr.canvas : pr.ink;
  const brDark = darker(br.ink, br.canvas);
  const brLight = brDark === br.ink ? br.canvas : br.ink;
  const prAccentHsl = hexToHsl(pr.accent);
  const prAccent2Hsl = hexToHsl(pr.accent2);
  const newByKey = new Map();
  for (const [key, val] of presetColors) {
    const ph = hexToHsl(val);
    let next;
    if (val === prDark) next = brDark;
    else if (val === prLight) next = brLight;
    else if (val === pr.accent)
      next = br.accent; // primary accent → the EXACT brand color
    else if (pr.accent2 !== pr.accent && val === pr.accent2)
      next = br.accent2; // exact 2nd accent
    else if (!ph)
      next = val; // non-hex (rgba) → leave as-is
    else {
      // repaint the remaining tints: pick the brand accent whose preset counterpart is
      // nearest in hue, then keep THIS color's own lightness so tint families stay families.
      const useSecond =
        pr.accent !== pr.accent2 &&
        prAccentHsl &&
        prAccent2Hsl &&
        hueDist(ph.h, prAccent2Hsl.h) < hueDist(ph.h, prAccentHsl.h);
      const bh = hexToHsl(useSecond ? br.accent2 : br.accent);
      next = bh ? hslToHex(bh.h, bh.s, ph.l) : val;
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
      const m = line.match(/^(\s+)([\w-]+):\s*["']?[^"'\n]*["']?\s*$/);
      if (m && newByKey.has(m[2])) return `${m[1]}${m[2]}: "${newByKey.get(m[2])}"`;
      return line;
    })
    .join("\n");
  summary.push(
    `colors: dark ${prDark}→${brDark}, light ${prLight}→${brLight}, accent ${pr.accent}→${br.accent}` +
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
  const bDisplay = brandFonts[0];
  const bBody = brandFonts[1] ?? brandFonts[0];
  if (pDisplay && bDisplay) md = md.split(`"${pDisplay}"`).join(`"${bDisplay}"`);
  if (pBody && pBody !== pDisplay && bBody) md = md.split(`"${pBody}"`).join(`"${bBody}"`);
  summary.push(`fonts: display ${pDisplay}→${bDisplay}, body ${pBody}→${bBody}`);
} else {
  summary.push("fonts: no brand fonts — preset fonts kept");
}

// ── write frame.md ────────────────────────────────────────────────────────────
const framePath = join(hyperframesDir, "frame.md");
writeFileSync(framePath, md);

// ── copy caption-skin.html ────────────────────────────────────────────────────
const presetSkin = join(presetDir, presetName, "caption-skin.html");
let skinCopied = false;
if (existsSync(presetSkin)) {
  copyFileSync(presetSkin, join(hyperframesDir, "caption-skin.html"));
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
if (li != null && lc != null && li >= lc) {
  die(
    `ink (${outRoles.ink}, lum ${li.toFixed(0)}) is not darker than canvas (${outRoles.canvas}, lum ${lc.toFixed(0)}) — bad brand mapping`,
  );
}

console.log(`✓ build-frame: ${presetName} → ${framePath}`);
for (const s of summary) console.log(`  ${s}`);
console.log(
  `  caption-skin.html: ${skinCopied ? "copied" : "preset ships none — captions will use the default pill"}`,
);
console.log(`  self-check: keys preserved, ink darker than canvas ✓`);
