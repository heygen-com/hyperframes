import { describe, expect, it } from "vitest";
import { gsapCdnDist, motionPathPluginUrl } from "./gsapCdn";

describe("gsapCdnDist", () => {
  it("serves the composition's gsap version", () => {
    expect(gsapCdnDist("3.14.2")).toBe("https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/");
    expect(motionPathPluginUrl("3")).toBe(
      "https://cdn.jsdelivr.net/npm/gsap@3/dist/MotionPathPlugin.min.js",
    );
  });

  it.each([undefined, "", "latest", "3.15.0/../x"])("falls back to the default for %j", (v) => {
    expect(gsapCdnDist(v)).toBe(gsapCdnDist());
    expect(gsapCdnDist()).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@\d+\.\d+\.\d+\/dist\/$/,
    );
  });
});
