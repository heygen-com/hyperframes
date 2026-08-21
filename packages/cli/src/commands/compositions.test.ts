import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { parseCompositions, parseSubComposition } from "./compositions.js";

describe("parseCompositions", () => {
  beforeEach(() => {
    ensureDOMParser();
  });

  it("resolves relative sub-composition starts when computing host duration", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "hyperframes-compositions-"));

    try {
      const compositionsDir = join(baseDir, "compositions");
      mkdirSync(compositionsDir);

      const subCompositionHtml = `
<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080" data-duration="3">
    <div class="clip" data-start="0" data-duration="3"></div>
  </div>
</template>`;
      writeFileSync(join(compositionsDir, "scene.html"), subCompositionHtml);

      const html = `
<div data-composition-id="host" data-width="1920" data-height="1080">
  <div id="s1" data-composition-id="s1" data-composition-src="compositions/scene.html" data-start="0" data-duration="3" data-track="main"></div>
  <div data-composition-id="s2" data-composition-src="compositions/scene.html" data-start="s1" data-duration="3" data-track="main"></div>
</div>`;

      const host = parseCompositions(html, baseDir).find(
        (composition) => composition.id === "host",
      );

      expect(host?.duration).toBe(6);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("parseSubComposition", () => {
  beforeEach(() => {
    ensureDOMParser();
  });

  it("reads template-wrapped sub-composition contents", () => {
    const html = `
<template id="foo-template">
  <div data-composition-id="foo" data-width="1920" data-height="1080" data-duration="1.5">
    <div class="clip" data-start="0" data-duration="1.5"></div>
  </div>
</template>`;

    expect(parseSubComposition(html, "foo", 1280, 720)).toEqual({
      id: "foo",
      duration: 1.5,
      width: 1920,
      height: 1080,
      elementCount: 1,
    });
  });

  it("counts visual-only template content and estimates simple script durations", () => {
    const html = `
<template id="foo-template">
  <div data-composition-id="foo" data-width="1920" data-height="1080">
    <div class="foo-bg" style="position:absolute;inset:0;background:#f00;"></div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".foo-bg", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0);
      window.__timelines["foo"] = tl;
    </script>
  </div>
</template>`;

    expect(parseSubComposition(html, "foo", 1280, 720)).toEqual({
      id: "foo",
      duration: 0.5,
      width: 1920,
      height: 1080,
      elementCount: 1,
    });
  });
});
