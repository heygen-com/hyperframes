#!/usr/bin/env node
// verify-frame.mjs — machine gates for a frame.md: L0 schema · L1 coherence · L2 fidelity to capture.
//   node verify-frame.mjs --frame ./stripe-capture/frame.md --capture ./stripe-capture

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chroma, lum, parseColors, semanticColors } from "./lib/tokens.mjs";
import { colorDist, isHex, toHex } from "./lib/color.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};

const captureDir = resolve(flag("capture", "."));
const framePath = resolve(flag("frame", join(captureDir, "frame.md")));
const SIZE_TOL = 0.1; // ±10% on type sizes vs the captured computed px
const COLOR_TOL = 12; // weighted-RGB distance treated as "same color"

if (!existsSync(framePath)) {
  console.error(`✗ no frame.md at ${framePath}`);
  process.exit(2);
}
const md = readFileSync(framePath, "utf8");

// ── tiny helpers (color parsing/compare live in lib/color.mjs) ───────────────
const isColorVal = (v) => isHex(v) || /^(rgba?|hsla?|oklch)\([^)]*\)$/i.test(String(v).trim());
const frontmatter = (() => {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  return m ? m[1] : "";
})();
const frameWidth = (() => {
  const m = /unit:.*?(\d{3,4})\s*[×x]\s*\d{3,4}/.exec(md);
  return m ? parseInt(m[1], 10) : 1920;
})();

// ── parse frame.md frontmatter ───────────────────────────────────────────────
const colorEntries = parseColors(md); // [[key, value], …] from the colors: block
const colorKeys = new Set(colorEntries.map(([k]) => k));
const colorByKey = new Map(colorEntries);

// typography: `role: { fontFamily: "X", cqw: N | px: N, weight: N, …, color: "key" }`
const typeEntries = [];
{
  let inBlock = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^typography:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+([\w-]+):\s*\{(.*)\}\s*$/);
    if (!m) continue;
    const role = m[1];
    const body = m[2];
    const get = (k) => {
      const mm = body.match(new RegExp(`${k}:\\s*(?:"([^"]+)"|([\\d.\\-]+))`));
      return mm ? (mm[1] ?? mm[2]) : null;
    };
    typeEntries.push({
      role,
      fontFamily: get("fontFamily"),
      cqw: get("cqw") != null ? parseFloat(get("cqw")) : null,
      px: get("px") != null ? parseFloat(get("px")) : null,
      weight: get("weight") != null ? parseInt(get("weight"), 10) : null,
      color: get("color"),
    });
  }
}

// every {colors.X} / {typography.Y} reference in the whole frontmatter
const colorRefs = [...frontmatter.matchAll(/\{colors\.([\w-]+)\}/g)].map((m) => m[1]);
const typeRefs = [...frontmatter.matchAll(/\{typography\.([\w-]+)\}/g)].map((m) => m[1]);
const typeKeys = new Set(typeEntries.map((t) => t.role));

// ── capture source-of-truth ────────────────────────────────────────────────────
const tokensPath = join(captureDir, "extracted/tokens.json");
const stylesPath = join(captureDir, "extracted/design-styles.json");
const readJSON = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`✗ ${p}: invalid JSON — ${e.message}`);
    process.exit(2);
  }
};
const tokens = existsSync(tokensPath) ? readJSON(tokensPath) : null;
const styles = existsSync(stylesPath) ? readJSON(stylesPath) : null;
// "on the site" = ranked palette + every colorStats hex, normalized through toHex.
const capturePalette = [
  ...(tokens?.colors ?? []).map((c) => (typeof c === "string" ? c : c?.hex)),
  ...(tokens?.colorStats ?? []).map((s) => s?.hex),
]
  .map((c) => toHex(c))
  .filter(Boolean);
const captureFonts = (tokens?.fonts ?? [])
  .map((f) => (typeof f === "string" ? f : f?.family))
  .map((f) => String(f).split(",")[0].replace(/['"]/g, "").trim())
  .filter(Boolean);
const captureWeights = new Set(
  (tokens?.fonts ?? [])
    .flatMap((f) => (Array.isArray(f?.weights) ? f.weights : []))
    .map((w) => parseInt(w, 10))
    .filter(Number.isFinite),
);
// first occurrence per role wins — the generator dedups the same way, so a duplicated role
// (e.g. two "heading-3" entries) must compare against the SAME one the generator kept.
const styleSizeByRole = new Map();
for (const t of styles?.typography ?? []) {
  const v = parseFloat(t.fontSize);
  if (Number.isFinite(v) && !styleSizeByRole.has(t.role)) styleSizeByRole.set(t.role, v);
}
const captureRadii = new Set((styles?.radius ?? []).map((r) => String(r).trim()));

// ── run checks ───────────────────────────────────────────────────────────────
const results = [];
const add = (level, name, status, detail) => results.push({ level, name, status, detail });

// L0 — parse / schema
add(
  "L0",
  "Frontmatter parses",
  frontmatter ? "PASS" : "FAIL",
  frontmatter ? `${frontmatter.split("\n").length} lines` : "no --- frontmatter block found",
);
const requiredBlocks = ["colors", "typography", "spacing", "components"];
const missing = requiredBlocks.filter((b) => !new RegExp(`^${b}:\\s*$`, "m").test(frontmatter));
add(
  "L0",
  "Required blocks present",
  missing.length ? "FAIL" : "PASS",
  missing.length ? `missing: ${missing.join(", ")}` : requiredBlocks.join(", "),
);
const badColors = colorEntries.filter(([, v]) => !isColorVal(v));
add(
  "L0",
  "Color values valid",
  badColors.length ? "FAIL" : "PASS",
  badColors.length
    ? `invalid: ${badColors.map(([k, v]) => `${k}=${v}`).join(", ")}`
    : `${colorEntries.length} colors`,
);
const typeNoSize = typeEntries.filter((t) => t.cqw == null && t.px == null);
const typeNoFam = typeEntries.filter((t) => !t.fontFamily);
add(
  "L0",
  "Typography roles well-formed",
  typeNoSize.length || typeNoFam.length ? "FAIL" : "PASS",
  typeNoSize.length || typeNoFam.length
    ? `${typeNoSize.length} missing size, ${typeNoFam.length} missing family`
    : `${typeEntries.length} roles, all have family+size`,
);
const danglingColor = [...new Set(colorRefs)].filter((r) => !colorKeys.has(r));
const danglingType = [...new Set(typeRefs)].filter((r) => !typeKeys.has(r));
add(
  "L0",
  "No dangling references",
  danglingColor.length || danglingType.length ? "FAIL" : "PASS",
  danglingColor.length || danglingType.length
    ? `colors:{${danglingColor}} typography:{${danglingType}}`
    : `${colorRefs.length} color + ${typeRefs.length} type refs resolve`,
);

// L1 — internal coherence
const inkHex = colorByKey.get("ink") ?? semanticColors(colorEntries).ink;
const canvasHex = colorByKey.get("canvas") ?? semanticColors(colorEntries).canvas;
const li = lum(inkHex);
const lc = lum(canvasHex);
const sep = li != null && lc != null ? Math.abs(li - lc) : null;
add(
  "L1",
  "ink/canvas contrast",
  sep == null ? "WARN" : sep >= 40 ? "PASS" : "FAIL",
  sep == null
    ? "non-hex ink/canvas — can't measure"
    : `ink ${inkHex} (lum ${li.toFixed(0)}) vs canvas ${canvasHex} (lum ${lc.toFixed(0)}) — Δ${sep.toFixed(0)} (≥40)`,
);
const accentHex = colorByKey.get("accent");
const accentChroma = accentHex ? chroma(accentHex) : -1;
add(
  "L1",
  "accent is chromatic",
  accentHex == null ? "WARN" : accentChroma > 40 ? "PASS" : "FAIL",
  accentHex == null ? "no accent key" : `accent ${accentHex} chroma ${accentChroma} (>40)`,
);
const weightsOff = captureWeights.size
  ? typeEntries.filter((t) => t.weight != null && !captureWeights.has(t.weight))
  : [];
add(
  "L1",
  "weights ∈ brand faces",
  !captureWeights.size ? "INFO" : weightsOff.length ? "FAIL" : "PASS",
  !captureWeights.size
    ? "no weight data in capture"
    : weightsOff.length
      ? `off-face: ${weightsOff.map((t) => `${t.role}=${t.weight}`).join(", ")}`
      : `all ∈ {${[...captureWeights].sort((a, b) => a - b).join(", ")}}`,
);
const cqwInsane = typeEntries.filter((t) => t.cqw != null && (t.cqw <= 0 || t.cqw > 40));
add(
  "L1",
  "cqw in sane range",
  cqwInsane.length ? "FAIL" : "PASS",
  cqwInsane.length
    ? `out of (0,40]: ${cqwInsane.map((t) => `${t.role}=${t.cqw}`).join(", ")}`
    : `${typeEntries.filter((t) => t.cqw != null).length} cqw sizes ok`,
);

// L2 — fidelity to source (only when capture data is present)
if (!tokens) {
  add("L2", "Fidelity to capture", "INFO", "no capture tokens.json — skipped");
} else {
  const invented = colorEntries
    .filter(([, v]) => isHex(v))
    .filter(([, v]) => !capturePalette.some((c) => colorDist(v, c) <= COLOR_TOL));
  add(
    "L2",
    "Colors ⊆ captured palette",
    invented.length ? "FAIL" : "PASS",
    invented.length
      ? `not on site: ${invented.map(([k, v]) => `${k}=${v}`).join(", ")}`
      : `${colorEntries.length} colors all match capture (±${COLOR_TOL})`,
  );

  const normF = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const capFamNorm = captureFonts.map(normF);
  const fontsOff = [...new Set(typeEntries.map((t) => t.fontFamily).filter(Boolean))].filter(
    (f) => !capFamNorm.includes(normF(f)),
  );
  add(
    "L2",
    "Fonts == captured fonts",
    !captureFonts.length ? "INFO" : fontsOff.length ? "FAIL" : "PASS",
    !captureFonts.length
      ? "no font data"
      : fontsOff.length
        ? `not captured: ${fontsOff.join(", ")}`
        : `${captureFonts.join(", ")}`,
  );

  if (styleSizeByRole.size) {
    const off = [];
    let checked = 0;
    for (const t of typeEntries) {
      const srcPx = styleSizeByRole.get(t.role);
      if (!(srcPx > 0)) continue; // no comparable captured size (missing / zero) → skip, don't divide by 0
      const ourPx = t.cqw != null ? (t.cqw * frameWidth) / 100 : t.px;
      if (ourPx == null) continue;
      checked++;
      const drift = Math.abs(ourPx - srcPx) / srcPx;
      if (drift > SIZE_TOL)
        off.push(`${t.role} ${ourPx.toFixed(0)}px vs ${srcPx}px (${(drift * 100).toFixed(0)}%)`);
    }
    add(
      "L2",
      "Type sizes match capture",
      off.length ? "FAIL" : checked ? "PASS" : "INFO",
      off.length
        ? `>±${SIZE_TOL * 100}%: ${off.join("; ")}`
        : `${checked} roles within ±${SIZE_TOL * 100}% of computed px`,
    );
  }

  if (styles?.radius) {
    const radiiVals = [...frontmatter.matchAll(/^\s*r\d+:\s*"([^"]+)"/gm)].map((m) => m[1]);
    const radOff = radiiVals.filter((r) => !captureRadii.has(r));
    add(
      "L2",
      "Radii ⊆ captured",
      radOff.length ? "FAIL" : "PASS",
      radOff.length ? `not on site: ${radOff.join(", ")}` : `${radiiVals.join(", ") || "none"}`,
    );
  }
}

// ── report ─────────────────────────────────────────────────────────────────────
const ICON = { PASS: "✓", FAIL: "✗", WARN: "⚠", INFO: "·" };
console.log(`\nframe.md verification — ${framePath}\n`);
let lvl = "";
for (const r of results) {
  if (r.level !== lvl) {
    lvl = r.level;
    const titles = {
      L0: "L0 · parse / schema",
      L1: "L1 · internal coherence",
      L2: "L2 · fidelity to source",
    };
    console.log(`  ${titles[lvl]}`);
  }
  console.log(`    ${ICON[r.status]} ${r.status.padEnd(4)} ${r.name} — ${r.detail}`);
}
const fails = results.filter((r) => r.status === "FAIL");
const warns = results.filter((r) => r.status === "WARN");
console.log(
  `\n  ${fails.length ? `✗ ${fails.length} FAIL` : "✓ all gates pass"}${warns.length ? ` · ${warns.length} WARN` : ""}\n`,
);
process.exit(fails.length ? 1 : 0);
