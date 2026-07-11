import assert from "node:assert/strict";
import test from "node:test";
import { brandRolesFromStats, isIconFont } from "./tokens.mjs";

test("recognizes brand-specific icon font names", () => {
  assert.equal(isIconFont("vidaXLfont"), true);
  assert.equal(isIconFont("BrandGlyphFont"), true);
  assert.equal(isIconFont("Poppins"), false);
});

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
});
