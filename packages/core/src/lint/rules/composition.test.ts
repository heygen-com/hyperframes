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
});
