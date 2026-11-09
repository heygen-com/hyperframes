import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FEATURES,
  FEATURES,
  generateComposition,
  parseSeeds,
  type Feature,
} from "./generate.js";

const SEEDS = parseSeeds("1-200");

const GSAP_SCRIPT = /<script>\/\*![\s\S]*?<\/script>/;

const withoutMatches = (text: string, pattern: RegExp): string => {
  let current = text;
  for (
    let next = current.replace(pattern, "");
    next !== current;
    next = current.replace(pattern, "")
  ) {
    current = next;
  }
  return current;
};

const visibleText = (html: string): string =>
  withoutMatches(withoutMatches(html, /<(script|style)[\s\S]*?<\/\1>/g), /<[^>]*>/g).trim();

describe("generateComposition", () => {
  it("is deterministic per seed", () => {
    for (const seed of [1, 17, 200]) {
      const a = generateComposition(seed);
      const b = generateComposition(seed);
      expect(b.features).toEqual(a.features);
      expect(b.name).toBe(a.name);
      expect(b.checkpoints).toEqual(a.checkpoints);
      expect(b.html("on")).toBe(a.html("on"));
      expect(b.html("off")).toBe(a.html("off"));
    }
  });

  it("varies with the seed", () => {
    const documents = new Set(SEEDS.map((seed) => generateComposition(seed).html("on")));
    expect(documents.size).toBeGreaterThan(150);
  });

  it("uses every feature within 200 seeds", () => {
    const seen = new Set<Feature>();
    for (const seed of SEEDS)
      for (const feature of generateComposition(seed).features) seen.add(feature);
    expect([...FEATURES].filter((feature) => !seen.has(feature))).toEqual([]);
  });

  it("holds each composition to 1 to 4 features at 320x180, 2 s, 30 fps", () => {
    for (const seed of SEEDS) {
      const f = generateComposition(seed);
      expect(f.features.length).toBeGreaterThanOrEqual(1);
      expect(f.features.length).toBeLessThanOrEqual(4);
      expect(new Set(f.features).size).toBe(f.features.length);
      expect([f.width, f.height, f.durationSeconds, f.fps, f.dpr]).toEqual([320, 180, 2, 30, 1]);
      expect(f.checkpoints).toHaveLength(2);
      expect(f.moving).toHaveLength(1);
      expect(f.name).toBe(`seed ${seed} [${f.features.join(", ")}]`);
    }
  });

  it("keeps the features known wrong on the filter tier out", () => {
    expect(EXCLUDED_FEATURES).toEqual({ ownClipPath: "E", visibilityToggle: "O" });
    for (const seed of SEEDS) {
      const html = generateComposition(seed).html("on").replace(GSAP_SCRIPT, "");
      expect(html).not.toMatch(/#card[^{]*\{[^}]*(clip-path|mask)/);
      expect(html).not.toMatch(/visibility/);
    }
  });

  it("draws no text", () => {
    for (const seed of SEEDS) expect(visibleText(generateComposition(seed).html("on"))).toBe("");
  });

  it("pins no tier on the blur-on page", () => {
    for (const seed of [1, 2, 3]) {
      expect(generateComposition(seed).html("on")).not.toContain("data-motion-blur-tier");
    }
  });
});

describe("parseSeeds", () => {
  it("reads lists and ranges", () => {
    expect(parseSeeds("1,2,3")).toEqual([1, 2, 3]);
    expect(parseSeeds("5-8")).toEqual([5, 6, 7, 8]);
    expect(parseSeeds("4,10-11")).toEqual([4, 10, 11]);
    expect(() => parseSeeds("x")).toThrow("bad seed list");
  });
});
