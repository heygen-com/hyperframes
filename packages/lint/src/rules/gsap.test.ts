// fallow-ignore-file code-duplication
import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("GSAP rules", () => {
  it("errors when window.__timelines is registered BEFORE the fonts.ready build", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    window.__timelines["c1"] = tl;
    document.fonts.ready.then(function () {
      tl.from("#editor", { opacity: 0, duration: 0.5 }, 0);
    });
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_timeline_registered_before_async_build",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does NOT error when window.__timelines is registered AFTER the fonts.ready build", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    document.fonts.ready.then(function () {
      tl.from("#editor", { opacity: 0, duration: 0.5 }, 0);
      window.__timelines["c1"] = tl;
    });
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_timeline_registered_before_async_build",
    );
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP animates opacity on a clip element (by id)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="overlay" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <h1>Hello</h1>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#overlay", { opacity: 0, duration: 0.5 }, 4.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP targets a clip element with safe properties (by class)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card" class="clip my-card" data-start="0" data-duration="5" data-track-index="0">
      <p>Content</p>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from(".my-card", { y: 100, duration: 0.3 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT flag GSAP targeting a child of a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="overlay" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <h1 class="title">Hello</h1>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(".title", { opacity: 1, duration: 0.5 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT flag GSAP targeting a nested selector like '#overlay .title'", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="overlay" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <h1 class="title">Hello</h1>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#overlay .title", { opacity: 1, duration: 0.5 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP targets a clip element with safe properties (class-only, no id)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="clip scene-card" data-start="0" data-duration="5" data-track-index="0">
      <p>Content</p>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(".scene-card", { y: -50, duration: 0.4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("errors when a full-frame transition flash starts visible before GSAP controls it", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;pointer-events:none;z-index:990"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <section class="clip" data-start="8" data-duration="8"><h1>Scene 2</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#tr-flash-1", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to("#tr-flash-1", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#tr-flash-1");
    expect(finding?.message).toContain("blank/white video");
  });

  it("does not error when a full-frame transition flash is initially hidden", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:990"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <section class="clip" data-start="8" data-duration="8"><h1>Scene 2</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#tr-flash-1", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to("#tr-flash-1", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeUndefined();
  });

  it("does not error when GSAP hides a full-frame transition flash at frame zero", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;pointer-events:none;z-index:990"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <section class="clip" data-start="8" data-duration="8"><h1>Scene 2</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#tr-flash-1", { opacity: 0 }, 0);
    tl.to("#tr-flash-1", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to("#tr-flash-1", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeUndefined();
  });

  it("reports one full-frame transition flash finding when multiple scripts touch it", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;pointer-events:none;z-index:990"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <section class="clip" data-start="8" data-duration="8"><h1>Scene 2</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#tr-flash-1", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to("#tr-flash-1", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
  <script>
    const tl2 = gsap.timeline({ paused: true });
    tl2.to("#tr-flash-1", { opacity: 1, duration: 0.08 }, 9.92);
    tl2.to("#tr-flash-1", { opacity: 0, duration: 0.18 }, 10.00);
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    expect(
      result.findings.filter((f) => f.code === "gsap_fullscreen_overlay_starts_visible"),
    ).toHaveLength(1);
  });

  it("errors when a full-frame transition flash uses a GSAP from reveal", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;pointer-events:none;z-index:990"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#tr-flash-1", { opacity: 0, duration: 0.18 }, 7.92);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#tr-flash-1");
  });

  it("errors when a grouped GSAP selector targets a visible full-frame flash", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <div id="tr-flash-1" style="position:fixed;inset:0;background:#fff;pointer-events:none;z-index:990"></div>
  <div id="unused"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#unused, #tr-flash-1", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to("#unused, #tr-flash-1", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#tr-flash-1");
  });

  it("errors when full-frame transition flash styles come from a style block", async () => {
    const html = `
<html><body data-composition-id="c1" data-width="1920" data-height="1080">
  <style>
    .tr-flash { position: fixed; inset: 0; background: #fff; pointer-events: none; z-index: 990; }
  </style>
  <div id="tr-flash-1" class="tr-flash"></div>
  <section class="clip" data-start="0" data-duration="8"><h1>Scene 1</h1></section>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(".tr-flash", { opacity: 1, duration: 0.08 }, 7.92);
    tl.to(".tr-flash", { opacity: 0, duration: 0.18 }, 8.00);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_fullscreen_overlay_starts_visible",
    );
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".tr-flash");
  });

  it("does NOT error when GSAP animates opacity on a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <h1>Title</h1>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: -50, duration: 0.5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP animates transform props on a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="box" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <div>Box</div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { scale: 1.2, x: 100, rotation: 45, duration: 0.5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT require a local GSAP script for sub-compositions", async () => {
    const html = `<template id="intro-template">
  <div data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title">Hello</div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, duration: 1 });
      window.__timelines["intro"] = tl;
    </script>
  </div>
</template>`;

    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does NOT require a local GSAP script when a template composition is linted in isolation", async () => {
    const html = `<template id="intro-template">
  <div data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title">Hello</div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, duration: 1 });
      window.__timelines["intro"] = tl;
    </script>
  </div>
</template>`;

    const result = await lintHyperframeHtml(html, { filePath: "compositions/intro.html" });
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("ERRORS when GSAP animates visibility on a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="overlay" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <p>Overlay</p>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#overlay", { visibility: "hidden", duration: 0.3 }, 2.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#overlay");
    expect(finding?.message).toContain("visibility");
  });

  it("ERRORS when GSAP animates display on a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <p>Card</p>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#card", { display: "none", duration: 0.3 }, 3.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#card");
    expect(finding?.message).toContain("display");
  });

  it("ERRORS when GSAP tween mixes safe properties with visibility on a clip element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="overlay" class="clip" data-start="0" data-duration="5" data-track-index="0">
      <h1>Hello</h1>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#overlay", { opacity: 0, visibility: "hidden", duration: 0.3 }, 2.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("visibility");
  });

  it("warns when tl.to animates x on an element with CSS translateX", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style=""></div>
  </div>
  <style>
    #title { position: absolute; top: 240px; left: 50%; transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#title", { x: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#title");
    expect(finding?.fixHint).toMatch(/fromTo/);
    expect(finding?.fixHint).toMatch(/xPercent/);
  });

  it("warns when tl.to animates scale on an element with CSS scale transform", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero"></div>
  </div>
  <style>
    #hero { transform: scale(0.8); opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", { opacity: 1, scale: 1, duration: 0.5 }, 1.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#hero");
  });

  it("does NOT warn when tl.to targets element without CSS transform", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card"></div>
  </div>
  <style>
    #card { position: absolute; top: 100px; left: 100px; opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#card", { x: 0, opacity: 1, duration: 0.3 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("does NOT warn when tl.fromTo targets element WITH CSS transform (author owns both ends)", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title"></div>
  </div>
  <style>
    #title { position: absolute; left: 50%; transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#title", { xPercent: -50, x: -1000, opacity: 0 }, { xPercent: -50, x: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("does NOT warn when tl.from targets element WITH CSS transform (from() owns start values)", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="badge"></div>
  </div>
  <style>
    #badge { position: absolute; left: 50%; transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#badge", { xPercent: -50, x: -200, opacity: 0, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("emits one warning when a combined CSS transform conflicts with multiple GSAP properties", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero"></div>
  </div>
  <style>
    #hero { transform: translateX(-50%) scale(0.8); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", { x: 0, scale: 1, opacity: 1, duration: 0.5 }, 1.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflicts = result.findings.filter((f) => f.code === "gsap_css_transform_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/x\/scale|scale\/x/);
  });

  // --- Inline style transform detection tests ---

  it("warns when inline style transform: translateX conflicts with GSAP x", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="centered" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">Text</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#centered", { x: 0, y: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#centered");
  });

  it("warns when inline style transform: scale conflicts with GSAP scale", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="box" style="transform: scale(0.9);">Box</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { scale: 1, duration: 0.5 }, 1.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#box");
  });

  it("does not false-positive on inline transform: rotate when GSAP uses rotation", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="spinner" style="transform: rotate(12deg);">Icon</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#spinner", { rotation: 360, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    // rotation doesn't conflict with rotate() — GSAP handles rotation separately
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeUndefined();
  });

  it("detects conflict via class selector when element has multiple classes", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="card hero" style="transform: translateX(-50%);">Card</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(".hero", { x: 100, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
  });

  it("handles both style block and inline style on same selector without crash", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="dual" style="transform: scale(0.5);">Dual</div>
  </div>
  <style>
    #dual { transform: translateY(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#dual", { y: 0, scale: 1, duration: 0.5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflicts = result.findings.filter((f) => f.code === "gsap_css_transform_conflict");
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it("detects conflict via a SCOPED descendant selector (tl.to)", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="lab">Label</div>
  </div>
  <style>
    .lab { transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#root .lab", { x: 40, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#root .lab");
  });

  it("detects conflict via a standalone gsap.set with a GROUPED scoped selector", async () => {
    // The exact shape that slipped through: centering seated with a standalone
    // gsap.set on a grouped, #root-scoped selector, against a CSS class transform.
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="lab">A</div><div class="sub">B</div>
  </div>
  <style>
    .lab { transform: translateX(-50%); }
    .sub { transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    gsap.set("#root .lab, #root .sub", { xPercent: -50 });
    tl.to(".lab", { y: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_css_transform_conflict" && f.selector === "#root .lab, #root .sub",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does NOT false-positive when a scoped selector targets a class WITHOUT a CSS transform", async () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="lab">Label</div>
  </div>
  <style>
    .lab { opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#root .lab", { x: 40, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("reports error when GSAP is used without a GSAP script tag", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("GSAP");
  });

  it("does not report missing_gsap_script when GSAP CDN script is present", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does not report missing_gsap_script when GSAP is bundled inline", async () => {
    // Simulate a large inline GSAP bundle (>5KB) with GreenSock marker
    const fakeGsapLib = "/* GreenSock GSAP */" + " ".repeat(6000);
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>${fakeGsapLib}</script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does not report missing_gsap_script when producer inlined CDN script", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>/* inlined: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js */
    !function(t,e){t.gsap=e()}(this,function(){return {}});
  </script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("still reports missing_gsap_script for small inline scripts that use but don't bundle GSAP", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("errors on repeat: -1 (infinite repeat breaks capture engine)", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#spinner", { rotation: 360, duration: 0.8, repeat: -1, ease: "none" }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("repeat: -1");
  });

  it("does not error on finite repeat values", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#spinner", { rotation: 360, duration: 0.8, repeat: 4, ease: "none" }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeUndefined();
  });

  it("does not error on repeat: -1 inside JavaScript comments", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // avoid repeat:-1 anywhere in user code
    /*
      This rule should still allow comments mentioning repeat: -1.
    */
    tl.to("#spinner", { rotation: 360, duration: 0.8, repeat: 4, ease: "none" }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeUndefined();
  });

  it("does NOT report overlapping_gsap_tweens when an object-target tween is interleaved (regression)", async () => {
    // Regression: a non-DOM-targeting tween like `tl.to({ _: 0 }, …)` (used to
    // anchor timeline duration) was matched by the regex but skipped by the
    // parser, drifting the index and making the second tween "see" the first
    // tween's selector — producing a phantom self-overlap warning.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="a" class="clip" data-start="0" data-duration="5" data-track-index="0"></div>
    <div id="b" class="clip" data-start="0" data-duration="5" data-track-index="1"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to({ _: 0 }, { _: 1, duration: 5, ease: "none" }, 0);
    tl.to("#a", { opacity: 1, duration: 0.5 }, 0);
    tl.to("#b", { opacity: 1, duration: 0.5 }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("does NOT report overlapping_gsap_tweens for same-named constants in separate IIFEs", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="x"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    (() => { const T = 0; tl.to("#x", { opacity: 1, duration: 1 }, T + 0); })();
    (() => { const T = 10; tl.to("#x", { opacity: 0, duration: 1 }, T + 0); })();
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("detects overlapping_gsap_tweens between variable-target tweens", async () => {
    // Both tweens target the same element via a querySelector variable and their
    // windows overlap on `opacity`. The structure-driven window builder must see
    // through the variable target to flag the conflict.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero" class="hero" data-start="0" data-duration="5" data-track-index="0"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const hero = document.querySelector("#hero");
    tl.to(hero, { opacity: 1, duration: 1 }, 0);
    tl.to(hero, { opacity: 0.5, duration: 1 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeDefined();
  });

  it("does NOT report overlapping_gsap_tweens for distinct unresolved-target tweens", async () => {
    // Each tween targets a DIFFERENT element via a target the parser cannot resolve
    // statically (a helper call). Both collapse to the `__unresolved__` sentinel, but
    // they are not the same element, so an overlap must not be asserted between them.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="s0"><div class="hl"><span class="w">a</span></div></div>
    <div id="s1"><div class="hl"><span class="w">b</span></div></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const a = pickWord(0);
    const b = pickWord(1);
    tl.to(a, { x: 100, duration: 1 }, 0);
    tl.to(b, { x: 100, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("does NOT report overlapping_gsap_tweens for distinct loop-built DOM targets", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="caption-card-0"></div>
    <div id="caption-card-1"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    for (let i = 0; i < 2; i++) {
      const card = document.getElementById("caption-card-" + i);
      tl.to(card, { opacity: 1, duration: 1 }, i * 0.5);
    }
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("does NOT report overlapping_gsap_tweens for distinct object proxy drivers", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const particles = { value: 0 };
    const grain = { value: 0 };
    tl.to(particles, { value: 1, duration: 2, ease: "none" }, 0);
    tl.to(grain, { value: 1, duration: 2, ease: "none" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("reports overlapping_gsap_tweens for the same object proxy driver", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const driver = { value: 0 };
    tl.to(driver, { value: 1, duration: 2, ease: "none" }, 0);
    tl.to(driver, { value: 2, duration: 2, ease: "none" }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeDefined();
  });

  it("does not conflate same-named object proxies from sibling scopes", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    (() => {
      const driver = { value: 0 };
      tl.to(driver, { value: 1, duration: 2, ease: "none" }, 0);
    })();
    (() => {
      const driver = { value: 0 };
      tl.to(driver, { value: 1, duration: 2, ease: "none" }, 0.5);
    })();
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("warns when an opacity exit ends at a clip start boundary without a hard kill", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="scene-a" class="clip" data-start="0" data-duration="3" data-track-index="0">
      <h1 id="headline">First beat</h1>
    </div>
    <div id="scene-b" class="clip" data-start="3" data-duration="3" data-track-index="0">
      <h1>Second beat</h1>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#headline", { opacity: 0, duration: 0.3 }, 2.7);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#headline");
    expect(finding?.message).toContain("3.00s");
  });

  it("gsap_exit_missing_hard_kill points at the inner-wrapper pattern when the exiting selector is a clip element", async () => {
    // Regression: a tl.set hard kill on a clip-classed selector is exactly what
    // gsap_animates_clip_element then errors on — the two rules must not give
    // contradictory advice for a crossfading scene that is itself class="clip".
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="scene-a" class="clip" data-start="0" data-duration="3" data-track-index="0"></div>
    <div id="scene-b" class="clip" data-start="3" data-duration="3" data-track-index="0"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#scene-a", { opacity: 0, duration: 0.3 }, 2.7);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(finding).toBeDefined();
    expect(finding?.fixHint).toContain("clip element");
    expect(finding?.fixHint).toContain("inner");
    expect(finding?.fixHint).not.toContain('tl.set("#scene-a"');
  });

  it("does NOT report gsap_exit_missing_hard_kill for an unresolved-target boundary exit", async () => {
    // The exit tween targets an element via a value the parser cannot resolve (a helper
    // call), so it collapses to the `__unresolved__` sentinel. You cannot assert a missing
    // hard kill on an unknown element, and a `tl.set("__unresolved__", ...)` hint is
    // meaningless. The resolved-target exit in the same timeline is still flagged.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="scene-a" class="clip" data-start="0" data-duration="3" data-track-index="0">
      <h1 id="headline">First beat</h1>
    </div>
    <div id="scene-b" class="clip" data-start="3" data-duration="3" data-track-index="0">
      <h1>Second beat</h1>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const el = pickWord(0);
    tl.to(el, { opacity: 0, duration: 0.3 }, 2.7);
    tl.to("#headline", { opacity: 0, duration: 0.3 }, 2.7);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const exitFindings = result.findings.filter((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(exitFindings).toHaveLength(1);
    expect(exitFindings[0]?.selector).toBe("#headline");
  });

  it("does not warn when a boundary exit has a matching hard kill", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="scene-a" class="clip" data-start="0" data-duration="3" data-track-index="0">
      <h1 id="headline">First beat</h1>
    </div>
    <div id="scene-b" class="clip" data-start="3" data-duration="3" data-track-index="0">
      <h1>Second beat</h1>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#headline", { opacity: 0, duration: 0.3 }, 2.7);
    tl.set("#headline", { opacity: 0, visibility: "hidden" }, 3);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("does not match sub-composition exits against root clip boundaries", async () => {
    const html = `
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="root-a" class="clip" data-start="0" data-duration="3" data-track-index="0"></div>
    <div id="root-b" class="clip" data-start="3" data-duration="3" data-track-index="0"></div>
  </div>
  <div data-composition-id="sub" data-width="1920" data-height="1080" data-start="0" data-duration="4">
    <div id="sub-a" class="clip" data-start="0" data-duration="2" data-track-index="0">
      <h1 id="sub-title">Sub scene</h1>
    </div>
    <div id="sub-b" class="clip" data-start="2" data-duration="2" data-track-index="0"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#sub-title", { opacity: 0, duration: 0.3 }, 2.7);
    window.__timelines["sub"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("uses the authored hidden property in hard-kill fix hints", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080" data-start="0" data-duration="6">
    <div id="scene-a" class="clip" data-start="0" data-duration="3" data-track-index="0">
      <h1 id="headline">First beat</h1>
    </div>
    <div id="scene-b" class="clip" data-start="3" data-duration="3" data-track-index="0">
      <h1>Second beat</h1>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#headline", { autoAlpha: 0, duration: 0.3 }, 2.7);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_exit_missing_hard_kill");
    expect(finding?.fixHint).toContain("{ autoAlpha: 0 }");
  });

  it("does not false-positive on repeat: -10 (invalid GSAP but not infinite)", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1, repeat: -10 }, 0);
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeUndefined();
  });

  it("errors when CSS opacity:0 + gsap.from({opacity:0}) — invisible forever", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style="opacity: 0; font-size: 120px;">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 30, duration: 0.5 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("error");
    expect(finding!.selector).toBe("#title");
  });

  it("errors when style block has opacity:0 + gsap.from({opacity:0})", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero">Hello</div>
  </div>
  <style>
    #hero { font-size: 200px; color: #fff; opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#hero", { opacity: 0, scale: 3.5, duration: 0.25, ease: "expo.out" }, 0.1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeDefined();
  });

  it("errors when a style block's LAST declaration is opacity:0 without a semicolon", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero">Hello</div>
  </div>
  <style>
    #hero { font-size: 200px; opacity: 0 }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#hero", { opacity: 0, duration: 0.25 }, 0.1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeDefined();
  });

  it("does NOT error for inline opacity: 0.98 + gsap.from({opacity:0}) — fractional is not zero", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <img id="image-clip" style="opacity: 0.98; filter: blur(23px);" src="x.png">
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#image-clip", { opacity: 0, duration: 0.8 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeUndefined();
  });

  it("still errors for inline opacity: 0 without a trailing semicolon", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style="font-size: 120px; opacity: 0">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, duration: 0.5 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeDefined();
  });

  it("does NOT error when gsap.from({opacity:0}) and CSS has no opacity:0", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style="font-size: 120px; color: #fff;">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 30, duration: 0.5 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when gsap.fromTo({opacity:0}, {opacity:1}) — destination overrides CSS", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style="opacity: 0; font-size: 120px;">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#title", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeUndefined();
  });

  it("errors when CSS-hidden content has a fromTo reveal without a destination opacity", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card" style="opacity: 0">Visible after entrance</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#card", { opacity: 1, x: -60 }, { x: 0, duration: 0.5, immediateRender: false }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_cold_seek_hidden_fromto_missing_reveal",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#card");
  });

  it("errors when standalone gsap.set hides a fromTo target with no destination opacity", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card">Visible after entrance</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    gsap.set("#card", { opacity: 0 });
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#card", { opacity: 1, x: -60 }, { x: 0, duration: 0.5 }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_cold_seek_hidden_fromto_missing_reveal",
    );
    expect(finding).toBeDefined();
  });

  it("does NOT error when gsap.to() uses opacity:0 (exit animation)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style="opacity: 0;">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#title", { opacity: 0, duration: 0.5 }, 4.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when gsap.from({opacity: 0.5}) — non-zero opacity is a valid reveal", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="ghost" style="opacity: 0;">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#ghost", { opacity: 0.5, duration: 0.4 }, 0.1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_from_opacity_noop");
    expect(finding).toBeUndefined();
  });

  it("warns when gsap.timeline is created but not registered in __timelines", async () => {
    const html = `
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="box">Hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { opacity: 0.5, duration: 2 });
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_timeline_not_registered");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does NOT warn when timeline is registered in __timelines", async () => {
    const html = `
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="box">Hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { opacity: 0.5, duration: 2 });
    window.__timelines["root"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_timeline_not_registered");
    expect(finding).toBeUndefined();
  });

  it("does NOT warn when timeline is registered with dot property syntax", async () => {
    const html = `
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="box">Hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { opacity: 0.5, duration: 2 });
    window.__timelines.root = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_timeline_not_registered");
    expect(finding).toBeUndefined();
  });

  it("does NOT warn when timeline is registered with a computed bracket key", async () => {
    const html = `
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="box">Hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    var spec = { id: "root" };
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { opacity: 0.5, duration: 2 });
    window.__timelines[spec.id] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_timeline_not_registered");
    expect(finding).toBeUndefined();
  });

  it("does NOT warn for sub-compositions (template-based)", async () => {
    const html = `
<template>
  <div data-composition-id="sub" data-width="1920" data-height="1080">
    <div id="box">Hello</div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { opacity: 0.5, duration: 2 });
  </script>
</template>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_timeline_not_registered");
    expect(finding).toBeUndefined();
  });

  it("scene_layer_missing_visibility_kill: fires when multi-scene exit lacks hard kill", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="scene1"></div>
    <div id="scene2"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#scene1", { opacity: 0, duration: 0.5 }, 2.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "scene_layer_missing_visibility_kill");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("scene1");
  });

  it("scene_layer_missing_visibility_kill points at the inner-wrapper pattern when the scene element is a clip", async () => {
    // Same contradiction as gsap_exit_missing_hard_kill above, via the older
    // id-pattern-based rule: `tl.set("#scene1", { visibility: "hidden" }, ...)`
    // on a class="clip" scene element is exactly what gsap_animates_clip_element
    // then errors on.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="scene1" class="clip"></div>
    <div id="scene2" class="clip"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#scene1", { opacity: 0, duration: 0.5 }, 2.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "scene_layer_missing_visibility_kill");
    expect(finding).toBeDefined();
    expect(finding?.fixHint).toContain("clip element");
    expect(finding?.fixHint).toContain("inner");
    expect(finding?.fixHint).not.toContain('tl.set("#scene1"');
  });

  it("scene_layer_missing_visibility_kill: DOES fire when kill is only in a comment (stripJsComments guard)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="scene1"></div>
    <div id="scene2"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // tl.set("#scene1", { visibility: "hidden" }, 2.5);
    tl.to("#scene1", { opacity: 0, duration: 0.5 }, 2.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "scene_layer_missing_visibility_kill");
    expect(finding).toBeDefined();
  });

  it("scene_layer_missing_visibility_kill: does NOT fire when hard kill is present", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="scene1"></div>
    <div id="scene2"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#scene1", { opacity: 0, duration: 0.5 }, 2.0);
    tl.set("#scene1", { visibility: "hidden" }, 2.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "scene_layer_missing_visibility_kill");
    expect(finding).toBeUndefined();
  });

  it("gsap_non_transform_motion: errors on layout-prop tweens (left/marginLeft) and roundProps", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="a"></div><div id="b"></div><div id="c"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#a", { left: 0 }, { left: 1300, duration: 5, ease: "expo.out" }, 0);
    tl.fromTo("#b", { marginLeft: 0 }, { marginLeft: 1300, duration: 5, ease: "expo.out" }, 0);
    tl.fromTo("#c", { x: 0 }, { x: 1300, duration: 5, ease: "expo.out", roundProps: "x" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const findings = result.findings.filter((f) => f.code === "gsap_non_transform_motion");
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("gsap_non_transform_motion: does NOT fire on transform x/y", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#a", { x: 0 }, { x: 1300, duration: 5, ease: "expo.out" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeUndefined();
  });

  it("gsap_non_transform_motion: does NOT fire on tl.set() (instantaneous, no stutter)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#a", { left: 100 }, 0);
    tl.fromTo("#a", { x: 0 }, { x: 1300, duration: 5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeUndefined();
  });

  it("gsap_non_transform_motion: one tween with both a layout prop AND roundProps reports once", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#a", { left: 0 }, { left: 1300, duration: 5, roundProps: "left" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const findings = result.findings.filter((f) => f.code === "gsap_non_transform_motion");
    expect(findings).toHaveLength(1);
  });

  it("gsap_non_transform_motion: catches standalone gsap.to() animating a layout prop", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#a", { opacity: 1, duration: 1 }, 0);
    gsap.to("#a", { left: 1300, duration: 5 });
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "gsap_non_transform_motion" && f.selector === "#a",
    );
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: does NOT fire on html-in-canvas elements (<canvas layoutsubtree>)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <canvas layoutsubtree width="1920" height="1080">
      <div class="liquid-glass" id="gp1"></div>
    </canvas>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#gp1", { left: 1340, duration: 5, ease: "expo.out" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeUndefined();
  });

  it("gsap_non_transform_motion: still fires on a grouped tween that also targets a plain-DOM element", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <canvas layoutsubtree width="1920" height="1080">
      <div class="liquid-glass" id="gp1"></div>
    </canvas>
    <div id="txt1">card</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(["#gp1", "#txt1"], { left: 1340, duration: 5, ease: "expo.out" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: fires on a label-positioned tl tween (non-numeric timeline position)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="cursor"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.addLabel("hold6", 6);
    tl.to("#cursor", { left: 500, top: 580, duration: 1 }, "hold6");
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: fires on a tl tween whose vars contain a nested {} (onComplete body)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#a", { left: 1300, duration: 5, onComplete: function () { window.done = true; } }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: roundProps on an html-in-canvas element still fires (not exempt)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <canvas layoutsubtree width="1920" height="1080">
      <div class="liquid-glass" id="gp1"></div>
    </canvas>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#gp1", { x: 100, duration: 5, roundProps: "x" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: fires on a layout/reflow prop that appears only in a fromTo's from-object", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="t"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#t", { left: 100, letterSpacing: "0.3em" }, { opacity: 1, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: fires on text-reflow props (letterSpacing / fontSize)", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="t"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#t", { letterSpacing: "-4px", duration: 4, ease: "power1.out" }, 0);
    tl.to("#t", { fontSize: 80, duration: 4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const findings = result.findings.filter((f) => f.code === "gsap_non_transform_motion");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("gsap_non_transform_motion: text-reflow props are NOT html-in-canvas-exempt", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <canvas layoutsubtree width="1920" height="1080">
      <div class="liquid-glass" id="gp1">label</div>
    </canvas>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#gp1", { letterSpacing: "-4px", duration: 4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeDefined();
  });

  it("gsap_non_transform_motion: does NOT fire on the literal text 'roundProps:' inside a string", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const label = "roundProps: see the docs";
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#a", { x: 0 }, { x: 1300, duration: 5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_non_transform_motion");
    expect(finding).toBeUndefined();
  });
});

describe("GSAP seek-order safety rules", () => {
  // ── gsap_repeat_refresh_relative_value ─────────────────────────────────────

  it("gsap_repeat_refresh_relative_value: flags repeatRefresh with a relative value in the same vars", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to('#a', { x: "+=100", duration: 1, repeat: 4, repeatRefresh: true }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_repeat_refresh_relative_value");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("gsap_repeat_refresh_relative_value: does NOT flag relative values nested in callback vars", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="el"></div><div id="other"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to('#el', {
      x: 100,
      repeatRefresh: true,
      onComplete: () => gsap.to('#other', { y: "-=15" }),
    }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_repeat_refresh_relative_value");
    expect(finding).toBeUndefined();
  });

  it("gsap_repeat_refresh_relative_value: does NOT flag repeatRefresh without relative values", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to('#a', { x: 100, duration: 1, repeat: 4, repeatRefresh: true }, 0);
    tl.to('#a', { y: "+=10", duration: 1 }, 6);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_repeat_refresh_relative_value");
    expect(finding).toBeUndefined();
  });

  // ── gsap_function_value_hazard ─────────────────────────────────────────────

  it("gsap_function_value_hazard: flags a function value that measures the DOM", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div class="chip"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to('.chip', { x: (i, target) => target.getBoundingClientRect().width / 2, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_function_value_hazard");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("gsap_function_value_hazard: flags a method call on the first (index) parameter", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div class="chip"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to('.chip', { x: (el) => el.getAttribute("data-x"), duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_function_value_hazard");
    expect(finding).toBeDefined();
  });

  it("gsap_function_value_hazard: WARNS (not errors) on transform-invariant layout reads", async () => {
    // Marquee pattern: x: () => -track.offsetWidth is deterministic across
    // workers while the measured layout is static — warning severity.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="track"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const track = document.getElementById('track');
    const tl = gsap.timeline({ paused: true });
    tl.to('#track', { x: () => -track.offsetWidth, duration: 8, ease: "none" }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_function_value_hazard");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("gsap_function_value_hazard: does NOT flag pure-index arithmetic, ternaries, wrap, or closures", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div class="chip"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const baseOffset = 40;
    const tl = gsap.timeline({ paused: true });
    tl.to('.chip', { x: (i) => i * 20, duration: 1 }, 0);
    tl.to('.chip', { y: (i) => (i % 2 === 0 ? -50 : 50), duration: 1 }, 0);
    tl.to('.chip', { rotation: gsap.utils.wrap([-10, 10]), duration: 1 }, 1);
    tl.to('.chip', { scale: (i) => baseOffset + i * 0.1, duration: 1 }, 2);
    tl.to('.chip', { opacity: (i) => Number(i.toFixed(2)), duration: 1 }, 3);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_function_value_hazard");
    expect(finding).toBeUndefined();
  });

  // ── gsap_callback_dom_measurement ──────────────────────────────────────────

  it("gsap_callback_dom_measurement: flags a tl.add callback reaching measurement two hops away", async () => {
    // Distilled from a production composition: tl.add(() => setupConnectors())
    // where setupConnectors measures via getCenter -> getBoundingClientRect.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="p1"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    function getCenter(el) {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    function setupConnectors() {
      const orb = document.querySelector('#p1');
      const center = getCenter(orb);
      const length = orb.getTotalLength();
      gsap.set(orb, { strokeDashoffset: length });
    }
    const tl = gsap.timeline({ paused: true });
    tl.add(() => setupConnectors(), 2.5);
    tl.to('#p1', { strokeDashoffset: 0, duration: 1 }, 3);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_callback_dom_measurement");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    // The callback site is reported in the structured selector field (the
    // linter dedupes on code+selector+message).
    expect(finding?.selector).toContain("setupConnectors");
  });

  it("gsap_callback_dom_measurement: does NOT flag gsap.getProperty-driven derived-output callbacks", async () => {
    // Scramble/typewriter pattern: onUpdate reads the animated value to derive
    // text output — per-frame deterministic and seek-idempotent.
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="counter"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const state = { n: 0 };
    const el = document.getElementById('counter');
    const tl = gsap.timeline({ paused: true });
    tl.to(state, { n: 100, duration: 2, onUpdate: () => { el.textContent = String(Math.round(gsap.getProperty(state, "n"))); } }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_callback_dom_measurement");
    expect(finding).toBeUndefined();
  });

  it("gsap_callback_dom_measurement: flags onUpdate / eventCallback referencing a measuring function", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><div id="a"></div></div>
  <script>
    window.__timelines = window.__timelines || {};
    const measureNow = () => document.getElementById('a').offsetWidth;
    const tl = gsap.timeline({ paused: true });
    tl.to('#a', { x: 100, duration: 1, onUpdate: measureNow }, 0);
    tl.eventCallback("onComplete", () => { const h = document.getElementById('a').clientHeight; });
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const findings = result.findings.filter((f) => f.code === "gsap_callback_dom_measurement");
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it("gsap_callback_dom_measurement: does NOT flag build-time measurement or non-measuring callbacks", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="p1" d="M 0 0 L 100 100"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const path = document.getElementById('p1');
    const length = path.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#p1', { strokeDasharray: length + " " + length, strokeDashoffset: length }, 0);
    tl.add("chapter-two", 2);
    tl.to('#p1', { strokeDashoffset: 0, duration: 1, onComplete: () => console.log("done") }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_callback_dom_measurement");
    expect(finding).toBeUndefined();
  });
});

describe("SVG draw-on rules", () => {
  // ── svg_drawon_css_dasharray_conflict ──────────────────────────────────────

  it("svg_drawon_css_dasharray_conflict: flags the draw-on trick over CSS 'stroke-dasharray: 10 10'", async () => {
    // Distilled from a production composition: script-created path gets the
    // sync-line class, whose CSS declares a decorative two-component dash.
    const html = `
<html><body>
  <style>
    .sync-line { stroke: rgba(0, 163, 255, 0.3); stroke-width: 2; fill: none; stroke-dasharray: 10 10; }
  </style>
  <div data-composition-id="c1" data-width="1080" data-height="1920"><svg id="svg-overlay"></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const svg = document.getElementById('svg-overlay');
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "sync-line");
    path.setAttribute("d", "M 210 410 L 540 960");
    svg.appendChild(path);
    const pathLength = path.getTotalLength();
    tl.set(path, { strokeDasharray: pathLength, strokeDashoffset: pathLength }, 0);
    tl.to(path, { strokeDashoffset: 0, duration: 1.2, ease: "power1.inOut" }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("svg_drawon_css_dasharray_conflict: flags a quoted-selector write over an inline multi-component dash", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <svg><path id="wire" style="stroke-dasharray: 8 8" d="M 0 0 L 100 100"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set('#wire', { strokeDasharray: 141.4, strokeDashoffset: 141.4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeDefined();
  });

  it("svg_drawon_css_dasharray_conflict: does NOT flag a descendant-scoped CSS dasharray", async () => {
    const html = `
<html><body>
  <style>.decorative-frame .wire { stroke-dasharray: 10 10; }</style>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <svg><path id="line" class="wire" d="M 0 0 L 100 0"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set('#line', { strokeDasharray: 100 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeUndefined();
  });

  it("svg_drawon_css_dasharray_conflict: does NOT flag a single-component CSS dasharray", async () => {
    const html = `
<html><body>
  <style>.wire { stroke-dasharray: 12; }</style>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <svg><path id="wire" class="wire" d="M 0 0 L 100 100"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set('#wire', { strokeDasharray: 141.4, strokeDashoffset: 141.4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeUndefined();
  });

  it("svg_drawon_css_dasharray_conflict: does NOT flag a full two-component GSAP value (the fix form)", async () => {
    const html = `
<html><body>
  <style>.wire { stroke-dasharray: 10 10; }</style>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <svg><path id="wire" class="wire" d="M 0 0 L 100 100"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const len = 141.4;
    tl.set('#wire', { strokeDasharray: \`\${len} \${len}\`, strokeDashoffset: len }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeUndefined();
  });

  it("svg_drawon_css_dasharray_conflict: treats an all-interpolation template id as unresolved (multi-composition safe)", async () => {
    // getElementById(\`\${name}\`) has no literal segment — it must NOT match
    // every id in the document (here it would mis-join to the OTHER
    // composition's dashed element).
    const html = `
<html><body>
  <style>.wire-b { stroke-dasharray: 10 10; }</style>
  <div data-composition-id="a" data-width="1920" data-height="1080">
    <svg><path id="line-a" d="M 0 0 L 100 100"/></svg>
  </div>
  <div data-composition-id="b" data-width="1920" data-height="1080">
    <svg><path id="line-b" class="wire-b" d="M 0 0 L 100 100"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const name = "line-a";
    const target = document.getElementById(\`\${name}\`);
    tl.set(target, { strokeDasharray: 141.4, strokeDashoffset: 141.4 }, 0);
    window.__timelines["a"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_drawon_css_dasharray_conflict");
    expect(finding).toBeUndefined();
  });

  // ── svg_measure_before_path_d ──────────────────────────────────────────────

  it("svg_measure_before_path_d: ERROR when no d assignment exists anywhere", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="wave" class="line"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const wave = document.getElementById('wave');
    const length = wave.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#wave', { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("svg_measure_before_path_d: ERROR when only a different path has a d assignment", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <svg><path id="alpha"/><path id="beta"/></svg>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const alpha = document.getElementById('alpha');
    const beta = document.getElementById('beta');
    beta.setAttribute('d', 'M0 0 L10 10');
    const length = alpha.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#alpha', { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("no d");
  });

  it("svg_measure_before_path_d: WARNING when d is only assigned inside a function body", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="wave"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const wave = document.getElementById('wave');
    function setupPath() {
      wave.setAttribute('d', 'M 0 0 L 500 500');
    }
    const tl = gsap.timeline({ paused: true });
    tl.add(setupPath, 2);
    const length = wave.getTotalLength();
    tl.to('#wave', { strokeDashoffset: 0, duration: 1 }, 3);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("svg_measure_before_path_d: no finding for a static d attribute in the HTML", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="wave" d="M 0 0 L 500 500"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const wave = document.getElementById('wave');
    const length = wave.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#wave', { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeUndefined();
  });

  it("svg_measure_before_path_d: no finding for top-level assign-then-measure", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="wave"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const wave = document.getElementById('wave');
    wave.setAttribute('d', 'M 0 0 L 500 500');
    const length = wave.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#wave', { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeUndefined();
  });

  it("svg_measure_before_path_d: no finding for a top-level GSAP attr-plugin d assignment before the measure", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg><path id="wave"/></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const wave = document.getElementById('wave');
    gsap.set(wave, { attr: { d: "M 0 0 L 100 100" } });
    const length = wave.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set('#wave', { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeUndefined();
  });

  it("svg_measure_before_path_d: no finding for createElementNS-built paths", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"><svg id="overlay"></svg></div>
  <script>
    window.__timelines = window.__timelines || {};
    const overlay = document.getElementById('overlay');
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", "M 0 0 L 100 100");
    overlay.appendChild(line);
    const length = line.getTotalLength();
    const tl = gsap.timeline({ paused: true });
    tl.set(line, { strokeDashoffset: length }, 1);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "svg_measure_before_path_d");
    expect(finding).toBeUndefined();
  });
});
