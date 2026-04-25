import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("composition rules", () => {
  it("reports info for composition with external CDN script dependency", () => {
    const html = `<template id="rockets-template">
  <div data-composition-id="rockets" data-width="1920" data-height="1080">
    <div id="rocket-container"></div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["rockets"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
    const result = lintHyperframeHtml(html, { filePath: "compositions/rockets.html" });
    const finding = result.findings.find(
      (f) => f.code === "external_script_dependency" && f.message.includes("cdnjs.cloudflare.com"),
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    // info findings do not count as errors — ok should still be true
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("does not report external_script_dependency for inline scripts", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
    const result = lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "external_script_dependency")).toBeUndefined();
  });

  it("reports error when querySelector uses template literal variable", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="chart"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const compId = "main";
    const el = document.querySelector(\`[data-composition-id="\${compId}"] .chart\`);
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error for querySelectorAll with template literal variable", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const id = "main";
    document.querySelectorAll(\`[data-composition-id="\${id}"] .item\`);
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
  });

  it("does not report error for hardcoded querySelector strings", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="chart"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const el = document.querySelector('[data-composition-id="main"] .chart');
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeUndefined();
  });

  describe("timed_element_missing_clip_class", () => {
    it("flags element with data-start but no class='clip'", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="box" data-start="0" data-duration="2">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not flag element that has class='clip'", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="box" class="clip" data-start="0" data-duration="2">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeUndefined();
    });

    it("does not flag audio or video elements", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <audio data-start="0" data-duration="5" src="music.mp3"></audio>
    <video data-start="0" data-duration="5" src="clip.mp4"></video>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeUndefined();
    });
  });

  describe("overlapping_clips_same_track", () => {
    it("flags overlapping clips on the same track", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="3" data-track-index="0">A</div>
    <div class="clip" data-start="2" data-duration="3" data-track-index="0">B</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag clips on different tracks", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="3" data-track-index="0">A</div>
    <div class="clip" data-start="1" data-duration="3" data-track-index="1">B</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeUndefined();
    });

    it("does not flag sequential clips on the same track", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="2" data-track-index="0">A</div>
    <div class="clip" data-start="2" data-duration="2" data-track-index="0">B</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeUndefined();
    });
  });

  describe("root_composition_missing_html_wrapper", () => {
    it("flags bare composition div as error", () => {
      // Exact scenario from the screenshot — bare div with composition attributes, no HTML wrapper
      const html = `<div
  id="comp-main"
  data-composition-id="no-limits"
  data-start="0"
  data-duration="15"
  data-width="1920"
  data-height="1080"
>
  <!-- Sub-composition: the visual spectacle -->
  <div
    id="el-visuals"
    data-composition-id="visuals"
    data-composition-src="compositions/visuals.html"
    data-duration="15"
    data-track-index="0"
  ></div>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["no-limits"] = tl;
  </script>
</div>`;
      const result = lintHyperframeHtml(html, { filePath: "index.html" });
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(result.ok).toBe(false);
    });

    it("does not flag properly wrapped HTML composition", () => {
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div class="clip" data-start="0" data-duration="5">Hello</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag composition starting with <html> (no doctype)", () => {
      const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"></div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag sub-compositions", () => {
      const html = `<div data-composition-id="sub" data-width="1920" data-height="1080">
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["sub"] = gsap.timeline({ paused: true });
  </script>
</div>`;
      const result = lintHyperframeHtml(html, { isSubComposition: true });
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag HTML without composition attributes", () => {
      const html = `<div id="hello"><p>Not a composition</p></div>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("includes root tag snippet in finding", () => {
      const html = `<div data-composition-id="bare" data-width="1920" data-height="1080">
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["bare"] = gsap.timeline({ paused: true });
  </script>
</div>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeDefined();
      expect(finding?.snippet).toContain("data-composition-id");
    });
  });

  describe("standalone_composition_wrapped_in_template", () => {
    it("flags root index.html wrapped in template", () => {
      const html = `<template id="main-template">
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not flag sub-compositions in template", () => {
      const html = `<template id="sub-template">
  <div data-composition-id="sub" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["sub"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
      const result = lintHyperframeHtml(html, { isSubComposition: true });
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeUndefined();
    });
  });

  describe("requestanimationframe_in_composition", () => {
    it("flags requestAnimationFrame usage in script content", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    requestAnimationFrame(() => { console.log("tick"); });
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "requestanimationframe_in_composition",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not flag requestAnimationFrame in comments", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    // requestAnimationFrame(() => { });
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "requestanimationframe_in_composition",
      );
      expect(finding).toBeUndefined();
    });
  });

  describe("root_composition_missing_data_duration (removed)", () => {
    // The rule was a static proxy for the runtime's loop-inflation Infinity
    // emission, but lint cannot observe GSAP timeline duration statically and
    // the looping shapes that drive it are already covered by
    // `gsap_infinite_repeat` and `gsap_repeat_ceil_overshoot`. The rule has
    // been removed (#243's Infinity-emission concern is now carried by those
    // GSAP rules); these tests pin the removal so the rule does not silently
    // come back.

    it("does not warn on a docs-compliant root with no data-duration", () => {
      // The documented authoring model: root composition without
      // data-duration, runtime derives it from the GSAP timeline.
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="docs" data-width="1920" data-height="1080" data-start="0">
    <video src="clip.mp4" data-start="0" data-track-index="0" muted playsinline></video>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["docs"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_data_duration",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn even on the original Infinity-risk shape (no media, looping timeline)", () => {
      // This was the canonical "warn" case under the old rule — root with no
      // data-duration, no media, GSAP timeline driven by repeat: -1. The
      // looping shape itself is now flagged by `gsap_infinite_repeat`; the
      // duplicate `root_composition_missing_data_duration` warning is gone.
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="loopy" data-width="1920" data-height="1080" data-start="0">
    <div class="caption" data-start="1" data-duration="2">hello</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to(".caption", { x: 100, duration: 1, repeat: -1 });
    window.__timelines["loopy"] = tl;
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      // The deprecated rule must not fire.
      const removedFinding = result.findings.find(
        (f) => f.code === "root_composition_missing_data_duration",
      );
      expect(removedFinding).toBeUndefined();
      // The looping shape is still surfaced — by `gsap_infinite_repeat`,
      // which is the more actionable signal pointing at the real authoring
      // mistake.
      const gsapFinding = result.findings.find((f) => f.code === "gsap_infinite_repeat");
      expect(gsapFinding).toBeDefined();
    });
  });
});
