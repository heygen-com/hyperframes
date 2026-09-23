import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  brandRolesFromStats,
  ICON_FONT_PATTERN,
  isIconFont,
  lum,
  parseColors,
  parseRegisterGroundText,
  semanticColors,
} from "./tokens.mjs";
import { brandRolesFromStats as facelessBrandRolesFromStats } from "../../../faceless-explainer/scripts/lib/tokens.mjs";
import { brandRolesFromStats as prBrandRolesFromStats } from "../../../pr-to-video/scripts/lib/tokens.mjs";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("recognizes brand-specific icon font names", () => {
  assert.equal(isIconFont("vidaXLfont"), true);
  assert.equal(isIconFont("BrandGlyphFont"), true);
  assert.equal(isIconFont("Poppins"), false);
  assert.equal(isIconFont("HelveticaFont"), false);
  assert.equal(isIconFont("Airbnb Cereal Font"), false);
  assert.equal(isIconFont("SF Pro Text Font"), false);
  assert.equal(isIconFont("Uber Move Font"), false);
  assert.equal(isIconFont("Circular Std font"), false);
  assert.equal(isIconFont("brand-font"), false);
});

test("keeps sibling skill icon-font classifiers aligned", () => {
  for (const skill of ["faceless-explainer", "pr-to-video"]) {
    const source = readFileSync(join(scriptsDir, skill, "scripts", "build-frame.mjs"), "utf8");
    assert.match(
      source,
      new RegExp(String.raw`ICON_FONT_PATTERN\s*=\s*${escapeRegExp(ICON_FONT_PATTERN)}`),
    );
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("preserves a prominent second accent used outside interactive backgrounds", () => {
  const colors = ["#FFFFFF", "#2D1238", "#F3E62B", "#111111"];
  const stats = [
    { hex: "#FFFFFF", areaBg: 1000, maxArea: 1000 },
    { hex: "#2D1238", textCount: 4, interactiveBg: 3 },
    { hex: "#F3E62B", textCount: 3, interactiveBg: 0 },
    { hex: "#111111", textCount: 20 },
  ];

  assert.deepEqual(brandRolesFromStats(stats, colors), {
    canvas: "#FFFFFF",
    ink: "#111111",
    accent: "#F3E62B",
    accent2: "#2D1238",
  });

  for (const sibling of [facelessBrandRolesFromStats, prBrandRolesFromStats]) {
    assert.deepEqual(sibling(stats, colors), brandRolesFromStats(stats, colors));
  }
});

const framePresetsDir = join(scriptsDir, "hyperframes-creative", "frame-presets");

test("parseRegisterGroundText reads broadside's declared dark register", () => {
  const md = readFileSync(join(framePresetsDir, "broadside", "FRAME.md"), "utf8");
  assert.deepEqual(parseRegisterGroundText(md), { groundKey: "ink-black", textKey: "cream" });
});

test("parseRegisterGroundText returns null for a preset with no registers block", () => {
  const md = readFileSync(join(framePresetsDir, "capsule", "FRAME.md"), "utf8");
  assert.equal(parseRegisterGroundText(md), null);
});

test("semanticColors reads broadside's declared register instead of guessing from key names", () => {
  const md = readFileSync(join(framePresetsDir, "broadside", "FRAME.md"), "utf8");
  const colors = parseColors(md);
  const roles = semanticColors(colors, md);
  // ink-black is the declared ground — must resolve to "canvas", not "ink" (the name-only
  // heuristic reads "ink-black" as text and inverts every dark-mode brand onto this preset).
  assert.equal(roles.canvas, "#111111");
  assert.equal(roles.ink, "#F0ECE5");
});

// Every shipped preset's true ground polarity, hand-verified from its own FRAME.md prose
// (registers/"ground" declarations, or paper/cream/bg/white-named grounds) — the source of
// truth this table checks the detector against. Adding a new dark-ground preset must add an
// entry here too.
const EXPECTED_GROUND_DARK = {
  "biennale-yellow": false,
  blockframe: false,
  "blue-professional": false,
  "bold-poster": false,
  broadside: true,
  capsule: false,
  cartesian: false,
  "cobalt-grid": false,
  "code-editorial": false,
  coral: false,
  "creative-mode": false,
  "daisy-days": false,
  "editorial-forest": false,
};

test("every shipped preset's detected ground polarity matches its declared register", () => {
  const dirs = readdirSync(framePresetsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.deepEqual(dirs.sort(), Object.keys(EXPECTED_GROUND_DARK).sort());
  for (const name of dirs) {
    const md = readFileSync(join(framePresetsDir, name, "FRAME.md"), "utf8");
    const roles = semanticColors(parseColors(md), md);
    const groundDark = (lum(roles.canvas) ?? 255) < (lum(roles.ink) ?? 0);
    assert.equal(
      groundDark,
      EXPECTED_GROUND_DARK[name],
      `${name}: expected ground-dark=${EXPECTED_GROUND_DARK[name]}, got ${groundDark} (ink=${roles.ink}, canvas=${roles.canvas})`,
    );
  }
});

test("semanticColors keeps a near-neutral 'second accent' neutral instead of promoting it", () => {
  // broadside's cream-muted (#888880, chroma 8) is a muted grey text tone, not a real second
  // brand accent — it must not win accent2 over the neutral chroma floor.
  const colors = [
    ["ink-black", "#111111"],
    ["fire-orange", "#E85D26"],
    ["cream", "#F0ECE5"],
    ["cream-muted", "#888880"],
  ];
  const roles = semanticColors(colors);
  assert.equal(roles.accent, "#E85D26");
  assert.notEqual(roles.accent2, "#888880");
  assert.equal(roles.accent2, "#E85D26"); // no 2nd real accent — falls back to the primary
});
