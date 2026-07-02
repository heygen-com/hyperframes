import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalizeFamily,
  extractFontMetadata,
  inferWeightFromSubfamily,
  isIconCharacterSet,
} from "./fontMetadataExtractor.js";

describe("inferWeightFromSubfamily", () => {
  // The concatenated forms were always handled. The spaced and hyphenated
  // forms were the bug Copilot flagged on PR #987 — "Extra Light" used to
  // fall through to the 400 default before the whitespace-normalization fix.
  describe("concatenated forms (already handled)", () => {
    it.each([
      ["Thin", 100],
      ["ExtraLight", 200],
      ["UltraLight", 200],
      ["Light", 300],
      ["Regular", 400],
      ["Medium", 500],
      ["SemiBold", 600],
      ["DemiBold", 600],
      ["Bold", 700],
      ["ExtraBold", 800],
      ["UltraBold", 800],
      ["Black", 900],
      ["Heavy", 900],
    ])("%s → %d", (subfamily, expected) => {
      expect(inferWeightFromSubfamily(subfamily)).toBe(expected);
    });
  });

  describe("spaced forms (the bug fix)", () => {
    it.each([
      ["Extra Light", 200],
      ["Ultra Light", 200],
      ["Semi Bold", 600],
      ["Demi Bold", 600],
      ["Extra Bold", 800],
      ["Ultra Bold", 800],
    ])("%s → %d", (subfamily, expected) => {
      expect(inferWeightFromSubfamily(subfamily)).toBe(expected);
    });
  });

  describe("hyphenated forms (the bug fix)", () => {
    it.each([
      ["Extra-Light", 200],
      ["Semi-Bold", 600],
      ["Extra-Bold", 800],
    ])("%s → %d", (subfamily, expected) => {
      expect(inferWeightFromSubfamily(subfamily)).toBe(expected);
    });
  });

  describe("composite styles", () => {
    it("Bold Italic still detects Bold", () => {
      expect(inferWeightFromSubfamily("Bold Italic")).toBe(700);
    });
    it("Semi Bold Italic still detects SemiBold (priority over Bold)", () => {
      expect(inferWeightFromSubfamily("Semi Bold Italic")).toBe(600);
    });
    it("ExtraBold Italic still detects ExtraBold (priority over Bold)", () => {
      expect(inferWeightFromSubfamily("ExtraBold Italic")).toBe(800);
    });
  });

  it("unknown subfamily falls back to 400 (Regular)", () => {
    expect(inferWeightFromSubfamily("Headline")).toBe(400);
    expect(inferWeightFromSubfamily("")).toBe(400);
    expect(inferWeightFromSubfamily("Some Random Style")).toBe(400);
  });

  it("is case-insensitive", () => {
    expect(inferWeightFromSubfamily("EXTRA LIGHT")).toBe(200);
    expect(inferWeightFromSubfamily("extra light")).toBe(200);
    expect(inferWeightFromSubfamily("ExTrA LiGhT")).toBe(200);
  });
});

describe("canonicalizeFamily", () => {
  it("returns family unchanged when no weight token is trailing", () => {
    expect(canonicalizeFamily("Inter")).toEqual({
      canonical: "Inter",
      inferredWeight: null,
    });
    expect(canonicalizeFamily("Tiempos Headline")).toEqual({
      canonical: "Tiempos Headline",
      inferredWeight: null,
    });
    expect(canonicalizeFamily("Söhne Breit")).toEqual({
      canonical: "Söhne Breit",
      inferredWeight: null,
    });
  });

  it("strips trailing weight tokens and surfaces the implied weight", () => {
    expect(canonicalizeFamily("Inter Medium")).toEqual({
      canonical: "Inter",
      inferredWeight: 500,
    });
    expect(canonicalizeFamily("Inter Light")).toEqual({
      canonical: "Inter",
      inferredWeight: 300,
    });
    expect(canonicalizeFamily("Inter Bold")).toEqual({
      canonical: "Inter",
      inferredWeight: 700,
    });
    expect(canonicalizeFamily("Funnel Display Light")).toEqual({
      canonical: "Funnel Display",
      inferredWeight: 300,
    });
  });

  it("preserves width modifiers before the weight token", () => {
    expect(canonicalizeFamily("Inter Tight Medium")).toEqual({
      canonical: "Inter Tight",
      inferredWeight: 500,
    });
  });

  it("emits 950 for ExtraBlack / UltraBlack (mirrors foundry intent)", () => {
    expect(canonicalizeFamily("Inter ExtraBlack")).toEqual({
      canonical: "Inter",
      inferredWeight: 950,
    });
  });

  it("returns empty input unchanged", () => {
    expect(canonicalizeFamily("")).toEqual({
      canonical: "",
      inferredWeight: null,
    });
  });
});

describe("extractFontMetadata", () => {
  // Light integration tests against the public surface — uses a real
  // temp directory and verifies the manifest shape. Doesn't require
  // fixture font binaries; the non-existent and empty-directory cases
  // exercise the happy paths for the surrounding pipeline.

  it("returns an empty manifest when the fonts directory doesn't exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-font-test-"));
    try {
      const outputPath = join(tmp, "manifest.json");
      const manifest = extractFontMetadata(join(tmp, "does-not-exist"), outputPath);
      expect(manifest.files).toEqual([]);
      expect(manifest.families).toEqual([]);
      expect(manifest.unidentified).toEqual([]);
      expect(existsSync(outputPath)).toBe(true);
      const written = JSON.parse(readFileSync(outputPath, "utf-8")) as typeof manifest;
      expect(written.files).toEqual([]);
      expect(written.meta.tool).toBe("fontkit");
      expect(typeof written.meta.generatedAt).toBe("string");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a manifest with the documented meta shape", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hf-font-test-"));
    try {
      const outputPath = join(tmp, "manifest.json");
      const manifest = extractFontMetadata(tmp, outputPath);
      expect(manifest.meta.tool).toBe("fontkit"); // no version hardcoded — moves with the dep
      // generatedAt is an ISO string
      expect(manifest.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("isIconCharacterSet", () => {
  // codepoint helpers
  const latin = Array.from({ length: 26 }, (_, i) => 0x41 + i); // A-Z
  const pua = Array.from({ length: 20 }, (_, i) => 0xe000 + i); // Private Use Area
  const puaSupp = [0xf0000, 0xf0001, 0x10fffd]; // supplementary PUA-A/B

  it("flags a font whose glyphs are mostly Private-Use-Area (an icon font)", () => {
    // ~63% PUA, mirroring a real "hushly" icon set
    expect(isIconCharacterSet([...pua, ...latin.slice(0, 12)])).toBe(true);
  });

  it("flags a near-100% PUA set (Font-Awesome-style)", () => {
    expect(isIconCharacterSet([...pua, ...puaSupp])).toBe(true);
  });

  it("does NOT flag a normal Latin text font", () => {
    expect(isIconCharacterSet(latin)).toBe(false);
  });

  it("does NOT flag a unicode-range subset with no Latin letters but 0% PUA", () => {
    // e.g. a cyrillic/latin-ext subset served by Next.js/Google Fonts — the false-positive case
    const cyrillic = Array.from({ length: 40 }, (_, i) => 0x0410 + i);
    expect(isIconCharacterSet(cyrillic)).toBe(false);
  });

  it("does NOT flag a PUA-heavy TEXT font that still has a full Latin alphabet", () => {
    // Apple SF Pro (~81% PUA, ships SF Symbols in the PUA) and Descript's Booton (~50% PUA) are
    // full text fonts — the Latin alphabet gate must keep them out of the icon bucket.
    const fullAlphabet = latin; // A-Z (26)
    const sfProLike = [...fullAlphabet, ...Array.from({ length: 200 }, (_, i) => 0xe000 + i)];
    expect(isIconCharacterSet(sfProLike)).toBe(false);
  });

  it("returns false for an empty character set", () => {
    expect(isIconCharacterSet([])).toBe(false);
  });
});
