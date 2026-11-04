import { describe, expect, it } from "vitest";
import {
  GSAP_CDN_VERSION,
  gsapCdnDist,
  motionPathPluginUrl,
  normalizeGsapBaseUrl,
  normalizeGsapLocalRoot,
} from "./gsapCdn";

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
    "http://mirror.example/npm",
    "http://10.0.0.5:8080/npm",
    "http://localhost.example/npm",
    "http://127.0.0.1.example/npm",
    "https:mirror.example",
    "not a URL",
    "https://user:password@mirror.example/npm",
    "https://mirror.example/npm?token=x",
    "https://mirror.example/npm#section",
    "https://mirror.example/npm?",
    "https://mirror.example/npm#",
  ])("rejects an invalid mirror instead of using the public CDN: %s", (base) => {
    expect(() => normalizeGsapBaseUrl(base)).toThrow();
  });

  it("requires HTTPS for a remote mirror", () => {
    expect(() => normalizeGsapBaseUrl("http://mirror.example/npm")).toThrow(/HTTPS/);
    expect(() => motionPathPluginUrl("3.15.0", "http://mirror.example/npm")).toThrow(/HTTPS/);
    expect(normalizeGsapBaseUrl("https://mirror.example/npm")).toBe("https://mirror.example/npm");
  });

  it.each([
    "http://localhost:8080/npm",
    "http://127.0.0.1:8080/npm",
    "http://127.4.5.6/npm",
    "http://[::1]:8080/npm",
    "HTTP://LOCALHOST/npm",
  ])("allows plain HTTP for a loopback mirror: %s", (base) => {
    expect(normalizeGsapBaseUrl(base)).toMatch(/^http:\/\//);
  });
});

describe("GSAP local root", () => {
  it("loads the bundled version from a same-origin root", () => {
    expect(gsapCdnDist(GSAP_CDN_VERSION, "/api/vendor/npm/")).toBe(
      `/api/vendor/npm/gsap@${GSAP_CDN_VERSION}/dist/`,
    );
    expect(gsapCdnDist(undefined, "/api/vendor/npm")).toBe(
      `/api/vendor/npm/gsap@${GSAP_CDN_VERSION}/dist/`,
    );
    expect(motionPathPluginUrl(GSAP_CDN_VERSION, "/api/vendor/npm")).toBe(
      `/api/vendor/npm/gsap@${GSAP_CDN_VERSION}/dist/MotionPathPlugin.min.js`,
    );
  });

  it.each(["3.14.2", "3", "3.15"])(
    "loads gsap %s from jsDelivr because the local root holds only the bundled version",
    (version) => {
      expect(motionPathPluginUrl(version, "/api/vendor/npm")).toBe(
        `https://cdn.jsdelivr.net/npm/gsap@${version}/dist/MotionPathPlugin.min.js`,
      );
    },
  );

  it.each(["//cdn.example/npm", "/\\cdn.example/npm", "/npm?x=1", "/npm#x", "/", "vendor/npm"])(
    "rejects a local root that is not a same-origin path: %s",
    (root) => {
      expect(() => normalizeGsapLocalRoot(root)).toThrow();
    },
  );

  it("normalizes dot segments in a local root", () => {
    expect(normalizeGsapLocalRoot("/api/x/../vendor/npm//")).toBe("/api/vendor/npm");
  });
});
