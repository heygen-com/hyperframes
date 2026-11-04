import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { extractStandaloneEntryFromIndex, isTemplateEntry } from "./standaloneEntry";

describe("isTemplateEntry", () => {
  it.each([
    "<template></template>",
    " \n<!-- Scene author notes -->\n<template id='scene'></template>",
    "<!-- a --><!-- <template> is inert --><TEMPLATE></TEMPLATE>",
    "<!--><template></template>",
  ])("recognizes a template entry past leading comments: %s", (html) => {
    expect(isTemplateEntry(html)).toBe(true);
  });

  it.each([
    "<template-card></template-card>",
    "<!doctype html><html><body><template></template></body></html>",
    "<div></div><template></template>",
    "<!-- <template></template> -->",
  ])("does not mistake other entries for a template scene: %s", (html) => {
    expect(isTemplateEntry(html)).toBe(false);
  });
});

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("keeps the index's body library scripts ahead of the scene and drops its inline scripts", () => {
    const indexHtml = `<!DOCTYPE html><html><head></head><body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="scene" data-composition-id="scene" data-composition-src="compositions/scene.html"></div>
  </div>
  <script src="https://cdn.example/gsap.min.js"></script>
  <script>window.__timelines = { root: gsap.timeline() };</script>
</body></html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/scene.html") ?? "";

    expect(extracted).toContain('<script src="https://cdn.example/gsap.min.js"></script>');
    expect(extracted.indexOf("gsap.min.js")).toBeLessThan(extracted.indexOf('id="scene"'));
    expect(extracted).not.toContain("window.__timelines = { root");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });

  it("re-points the wrapper duration at the scene's own, not the master's", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;
    const sceneHtml = `<template id="scene1-template"><div data-composition-id="scene1" data-width="640" data-height="360" data-duration="3"></div></template>`;

    const extracted = extractStandaloneEntryFromIndex(
      indexHtml,
      "compositions/scene1.html",
      sceneHtml,
    );

    // The extracted standalone advertises the scene file's 3s, not the mount's 2s or master's 12s.
    expect(extracted).toContain('data-duration="3"');
    expect(extracted).not.toContain('data-duration="12"');
  });

  it("falls back to the mount's data-duration when the scene file isn't supplied", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/scene1.html");

    expect(extracted).toContain('data-duration="2"');
    expect(extracted).not.toContain('data-duration="12"');
  });
  describe("master bus chain", () => {
    const hostIndexHtml = `<!DOCTYPE html>
<html>
<body>
  <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-width="640" data-height="360" data-fx-chain="{&quot;version&quot;:1,&quot;nodes&quot;:[{&quot;type&quot;:&quot;truepeak&quot;,&quot;id&quot;:&quot;index&quot;}]}"></div>
</body>
</html>`;
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-fx-chain="{&quot;version&quot;:1,&quot;nodes&quot;:[{&quot;type&quot;:&quot;truepeak&quot;,&quot;id&quot;:&quot;index&quot;}]}">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0"></div>
  </div>
</body>
</html>`;
    const chainOf = (html: string): string | null => {
      const { document } = parseHTML(html);
      const roots = Array.from(document.querySelectorAll("[data-composition-id]")) as Element[];
      const top = roots.find((el) => !el.parentElement?.closest("[data-composition-id]"));
      return top?.getAttribute("data-fx-chain") ?? null;
    };

    it("carries the scene's own chain, not the index's", () => {
      const chain = '{"version":1,"nodes":[{"type":"truepeak","id":"scene"}]}';
      const sceneHtml = `<template id="t"><div data-composition-id="scene1" data-width="640" data-height="360" data-fx-chain='${chain}'></div></template>`;

      const extracted = extractStandaloneEntryFromIndex(
        indexHtml,
        "compositions/scene1.html",
        sceneHtml,
      );

      expect(chainOf(extracted ?? "")).toBe(chain);
    });

    it("drops the index's chain when the scene declares none", () => {
      const sceneHtml = `<template id="t"><div data-composition-id="scene1" data-width="640" data-height="360"></div></template>`;

      const extracted = extractStandaloneEntryFromIndex(
        indexHtml,
        "compositions/scene1.html",
        sceneHtml,
      );

      expect(chainOf(extracted ?? "")).toBeNull();
    });

    it("carries the scene's chain when the index's top-level root is the mount itself", () => {
      const chain = '{"version":1,"nodes":[{"type":"truepeak","id":"scene"}]}';
      const sceneHtml = `<template id="t"><div data-composition-id="scene1" data-width="640" data-height="360" data-fx-chain='${chain}'></div></template>`;

      const extracted = extractStandaloneEntryFromIndex(
        hostIndexHtml,
        "compositions/scene1.html",
        sceneHtml,
      );

      expect(chainOf(extracted ?? "")).toBe(chain);
    });

    it("drops the index's chain from a top-level mount when the scene declares none", () => {
      const sceneHtml = `<template id="t"><div data-composition-id="scene1" data-width="640" data-height="360"></div></template>`;

      const extracted = extractStandaloneEntryFromIndex(
        hostIndexHtml,
        "compositions/scene1.html",
        sceneHtml,
      );

      expect(extracted).not.toBeNull();
      expect(chainOf(extracted ?? "")).toBeNull();
    });
  });
});
