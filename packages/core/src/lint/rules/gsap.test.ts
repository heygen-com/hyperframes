// fallow-ignore-file code-duplication
import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("GSAP rules", () => {
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
    expect(finding?.severity).toBe("warning");
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
    expect(finding?.severity).toBe("warning");
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
    expect(finding?.severity).toBe("warning");
    expect(finding?.selector).toBe("#headline");
    expect(finding?.message).toContain("3.00s");
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
    expect(finding?.severity).toBe("warning");
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

  // gsap_studio_edit_blocked
  it("warns when script registers timeline AND has GSAP tweens targeting #id selectors", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="headline" style="position:absolute;left:120px;top:200px;">Hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#headline", { opacity: 0 });
    tl.to("#headline", { opacity: 1, duration: 0.5 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_studio_edit_blocked");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('"#headline"');
  });

  it("warns when script registers timeline AND has GSAP tweens targeting .class selectors", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="box" style="position:absolute;left:120px;top:200px;"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from(".box", { y: 80, opacity: 0, duration: 0.4 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_studio_edit_blocked");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('".box"');
  });

  it("does NOT warn when timeline is registered but no GSAP element selectors are called", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_studio_edit_blocked");
    expect(finding).toBeUndefined();
  });

  it("does NOT warn when script has GSAP calls but does not register on window.__timelines", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="box"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#box", { x: 100, duration: 1 }, 0);
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_studio_edit_blocked");
    expect(finding).toBeUndefined();
  });

  it("lists all unique targeted selectors in the warning message", async () => {
    const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title"></div>
    <div id="sub"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, duration: 0.3 }, 0);
    tl.from("#sub", { opacity: 0, duration: 0.3 }, 0.2);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_studio_edit_blocked");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('"#title"');
    expect(finding?.message).toContain('"#sub"');
  });
});
