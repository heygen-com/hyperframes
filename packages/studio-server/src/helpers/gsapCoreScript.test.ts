// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlHasGsapCore, insertGsapCoreBeforeHeadPlugin } from "./gsapCoreScript";

const script = (src: string) => `<html><head><script src="${src}"></script></head></html>`;
const PLUGIN = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/MotionPathPlugin.min.js";
const CORE = `<script src="core/gsap.min.js"></script>`;

describe("htmlHasGsapCore", () => {
  it.each([
    "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.js",
    "/api/vendor/npm/gsap@3.15.0/dist/gsap.min.js",
    "./vendor/gsap.min.js",
    "assets/gsap-3.14.2.min.js",
    "gsap.min.js?v=2",
  ])("finds GSAP core at %s", (src) => {
    expect(htmlHasGsapCore(script(src))).toBe(true);
  });

  it.each([
    "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/MotionPathPlugin.min.js",
    "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/CustomEase.min.js",
    "/api/vendor/npm/gsap@3.15.0/dist/MotionPathPlugin.min.js",
    "./vendor/gsap/ScrollTrigger.js",
  ])("does not treat the plugin %s as GSAP core", (src) => {
    expect(htmlHasGsapCore(script(src))).toBe(false);
  });

  it("reads core from a producer inlining marker, but not a plugin's", () => {
    const inlined = (src: string) => `<script>/* inlined: ${src} */\nvoid 0;</script>`;
    expect(htmlHasGsapCore(inlined("https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"))).toBe(
      true,
    );
    expect(
      htmlHasGsapCore(inlined("https://cdn.jsdelivr.net/npm/gsap@3/dist/MotionPathPlugin.min.js")),
    ).toBe(false);
  });

  it("reads core from its license banner, but not a plugin's", () => {
    const banner = (name: string) =>
      `<script>/*!\n * ${name} 3.15.0\n * https://gsap.com\n * @license Copyright 2026, GreenSock.\n */\n</script>`;
    expect(htmlHasGsapCore(banner("GSAP"))).toBe(true);
    expect(htmlHasGsapCore(banner("MotionPathPlugin"))).toBe(false);
  });

  it.each([
    "gsap.registerPlugin(MotionPathPlugin);",
    'gsap.defaults({ ease: "none" }); gsap.config({ nullTargetWarn: false });',
    'gsap.to("#a", { x: 1 }); /* GreenSock */',
  ])("does not treat the authored usage %s as GSAP core", (usage) => {
    const html = `<head><script src="${PLUGIN}"></script><script>${usage}</script></head>`;
    expect(htmlHasGsapCore(html)).toBe(false);
  });

  it("reads core from its library body", () => {
    const body = `function S(t,e){console.warn("Invalid property",t,"set to",e,"Missing plugin? gsap.registerPlugin()")}`;
    expect(htmlHasGsapCore(`<script>${body}</script>`)).toBe(true);
  });

  it("ignores GSAP core inside a <template>", () => {
    const src = "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js";
    expect(htmlHasGsapCore(`<template><script src="${src}"></script></template>`)).toBe(false);
  });
});

describe("insertGsapCoreBeforeHeadPlugin", () => {
  it.each([
    ["a plugin src", `<script src="${PLUGIN}"></script>`],
    ["a local plugin", `<script src="./vendor/CustomEase.min.js"></script>`],
    ["an inlined plugin", `<script>/* inlined: ${PLUGIN} */</script>`],
    [
      "a plugin license banner",
      `<script>/*!\n * MotionPathPlugin 3.15.0\n * https://gsap.com\n */</script>`,
    ],
  ])("puts core before %s in the head", (_name, plugin) => {
    const html = `<html><head><script>var a;</script>${plugin}</head><body></body></html>`;
    const out = insertGsapCoreBeforeHeadPlugin(html, CORE) ?? "";
    expect(out.indexOf(CORE)).toBeGreaterThan(out.indexOf("var a;"));
    expect(out.indexOf(CORE)).toBeLessThan(out.indexOf(plugin));
  });

  it("works on a bare head fragment", () => {
    const out = insertGsapCoreBeforeHeadPlugin(`<script src="${PLUGIN}"></script>`, CORE) ?? "";
    expect(out.startsWith(CORE)).toBe(true);
  });

  it("leaves the head alone when the only plugin is in the body or a template", () => {
    const tag = `<script src="${PLUGIN}"></script>`;
    expect(
      insertGsapCoreBeforeHeadPlugin(`<html><head></head><body>${tag}</body></html>`, CORE),
    ).toBeNull();
    expect(
      insertGsapCoreBeforeHeadPlugin(`<head><template>${tag}</template></head>`, CORE),
    ).toBeNull();
  });
});
