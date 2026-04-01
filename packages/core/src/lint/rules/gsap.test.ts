import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("GSAP rules", () => {
  it("reports error when GSAP targets a clip element by id", () => {
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
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.selector).toBe("#overlay");
    expect(finding?.message).toContain("inner wrapper");
  });

  it("reports error when GSAP targets a clip element by class", () => {
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
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".my-card");
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

  it("reports error when GSAP targets a clip element with no id (class-only)", () => {
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
    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".scene-card");
    expect(finding?.elementId).toBeUndefined();
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
});
