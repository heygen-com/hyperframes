import { describe, expect, it } from "vitest";
import { chromeMajorCeiling, exceedsChromeCeiling } from "./chromeHostCeiling.js";

describe("chromeMajorCeiling", () => {
  it.each([
    ["darwin", "21.6.0", 150],
    ["darwin", "22.1.0", undefined],
    ["linux", "21.0.0", undefined],
    ["win32", "10.0.19045", undefined],
  ])("%s %s -> %s", (platform, release, expected) => {
    expect(chromeMajorCeiling(platform, release)).toBe(expected);
  });
});

describe("exceedsChromeCeiling", () => {
  it.each([
    ["mac-152.0.7977.30", 150, true],
    ["mac_arm-150.0.7871.124", 150, false],
    ["151.0.1.2", 150, true],
    ["mac-152.0.7977.30", undefined, false],
  ])("%s with ceiling %s -> %s", (name, ceiling, expected) => {
    expect(exceedsChromeCeiling(name, ceiling)).toBe(expected);
  });
});
