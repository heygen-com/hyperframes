import { describe, expect, it } from "vitest";
import { normalizeSkillSlug } from "./skill.js";

describe("normalizeSkillSlug", () => {
  it("accepts valid slugs unchanged", () => {
    for (const s of [
      "product-launch-video",
      "pr-to-video",
      "embedded-captions",
      "a",
      "a1",
      "x".repeat(64),
    ]) {
      expect(normalizeSkillSlug(s)).toBe(s);
    }
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSkillSlug("  pr-to-video  ")).toBe("pr-to-video");
  });

  it("drops invalid values (returns undefined)", () => {
    for (const s of [
      "",
      "   ",
      "MotionGraphics",
      "has space",
      "under_score",
      "-leading",
      "x".repeat(65),
      "café",
    ]) {
      expect(normalizeSkillSlug(s)).toBeUndefined();
    }
  });

  it("drops non-string input", () => {
    expect(normalizeSkillSlug(undefined)).toBeUndefined();
    expect(normalizeSkillSlug(123)).toBeUndefined();
  });
});
