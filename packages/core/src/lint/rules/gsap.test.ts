import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("GSAP rules", () => {
  it("does NOT error when GSAP animates opacity on a clip element (by id)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP targets a clip element with safe properties (by class)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT flag GSAP targeting a child of a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT flag GSAP targeting a nested selector like '#overlay .title'", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP targets a clip element with safe properties (class-only, no id)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP animates opacity on a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT error when GSAP animates transform props on a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeUndefined();
  });

  it("does NOT require a local GSAP script for sub-compositions", () => {
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

    const result = lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does NOT require a local GSAP script when a template composition is linted in isolation", () => {
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

    const result = lintHyperframeHtml(html, { filePath: "compositions/intro.html" });
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("ERRORS when GSAP animates visibility on a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#overlay");
    expect(finding?.message).toContain("visibility");
  });

  it("ERRORS when GSAP animates display on a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#card");
    expect(finding?.message).toContain("display");
  });

  it("ERRORS when GSAP tween mixes safe properties with visibility on a clip element", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_animates_clip_element");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("visibility");
  });

  it("warns when tl.to animates x on an element with CSS translateX", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.selector).toBe("#title");
    expect(finding?.fixHint).toMatch(/fromTo/);
    expect(finding?.fixHint).toMatch(/xPercent/);
  });

  it("warns when tl.to animates scale on an element with CSS scale transform", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.selector).toBe("#hero");
  });

  it("does NOT warn when tl.to targets element without CSS transform", () => {
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
    const result = lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("does NOT warn when tl.fromTo targets element WITH CSS transform (author owns both ends)", () => {
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
    const result = lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("emits one warning when a combined CSS transform conflicts with multiple GSAP properties", () => {
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
    const result = lintHyperframeHtml(html);
    const conflicts = result.findings.filter((f) => f.code === "gsap_css_transform_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/x\/scale|scale\/x/);
  });

  // --- Inline style transform detection tests ---

  it("warns when inline style transform: translateX conflicts with GSAP x", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#centered");
  });

  it("warns when inline style transform: scale conflicts with GSAP scale", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe("#box");
  });

  it("does not false-positive on inline transform: rotate when GSAP uses rotation", () => {
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
    const result = lintHyperframeHtml(html);
    // rotation doesn't conflict with rotate() — GSAP handles rotation separately
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeUndefined();
  });

  it("detects conflict via class selector when element has multiple classes", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
  });

  it("handles both style block and inline style on same selector without crash", () => {
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
    const result = lintHyperframeHtml(html);
    const conflicts = result.findings.filter((f) => f.code === "gsap_css_transform_conflict");
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it("reports error when GSAP is used without a GSAP script tag", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("GSAP");
  });

  it("does not report missing_gsap_script when GSAP CDN script is present", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does not report missing_gsap_script when GSAP is bundled inline", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("does not report missing_gsap_script when producer inlined CDN script", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeUndefined();
  });

  it("still reports missing_gsap_script for small inline scripts that use but don't bundle GSAP", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_gsap_script");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("errors on repeat: -1 (infinite repeat breaks capture engine)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("repeat: -1");
  });

  it("does not error on finite repeat values", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeUndefined();
  });

  it("does NOT report overlapping_gsap_tweens when an object-target tween is interleaved (regression)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "overlapping_gsap_tweens");
    expect(finding).toBeUndefined();
  });

  it("does not false-positive on repeat: -10 (invalid GSAP but not infinite)", () => {
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
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
    expect(finding).toBeUndefined();
  });
});
