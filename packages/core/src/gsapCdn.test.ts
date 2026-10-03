import { describe, expect, it } from "vitest";
import { GSAP_CDN_VERSION, motionPathPluginUrl } from "./gsapCdn";

describe("motionPathPluginUrl", () => {
  it("matches the composition's gsap version", () => {
    expect(motionPathPluginUrl("3.14.2")).toBe(
      "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/MotionPathPlugin.min.js",
    );
  });

  it.each([undefined, "", "latest", "3.15.0/../x"])(
    "falls back to the injected version for %j",
    (v) => {
      expect(motionPathPluginUrl(v)).toContain(`gsap@${GSAP_CDN_VERSION}/`);
    },
  );
});
