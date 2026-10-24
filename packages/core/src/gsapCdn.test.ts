import { describe, expect, it } from "vitest";
import { gsapCdnDist, motionPathPluginUrl, normalizeGsapBaseUrl } from "./gsapCdn";

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

describe("GSAP mirrors", () => {
  it("uses a normalized npm mirror root while retaining numeric versions", () => {
    expect(gsapCdnDist("3.14.2", " https://mirror.example/vendor/npm/// ")).toBe(
      "https://mirror.example/vendor/npm/gsap@3.14.2/dist/",
    );
    expect(motionPathPluginUrl("3", "http://localhost:8080/npm")).toBe(
      "http://localhost:8080/npm/gsap@3/dist/MotionPathPlugin.min.js",
    );
    expect(gsapCdnDist("latest", "https://mirror.example/npm")).toBe(
      "https://mirror.example/npm/gsap@3.15.0/dist/",
    );
  });

  it.each([undefined, "", "  "])("keeps the default root for %j", (base) => {
    expect(normalizeGsapBaseUrl(base)).toBe("https://cdn.jsdelivr.net/npm");
  });

  it.each([
    "/vendor/npm",
    "file:///vendor/npm",
    "https:mirror.example",
    "not a URL",
    "https://user:password@mirror.example/npm",
    "https://mirror.example/npm?token=x",
    "https://mirror.example/npm#section",
    "https://mirror.example/npm?",
    "https://mirror.example/npm#",
  ])("rejects an invalid mirror instead of using the public CDN: %s", (base) => {
    expect(() => normalizeGsapBaseUrl(base)).toThrow();
    expect(() => motionPathPluginUrl("3.15.0", base)).toThrow();
  });
});
