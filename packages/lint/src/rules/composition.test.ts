// fallow-ignore-file code-duplication
import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("composition rules", () => {
  describe("canonical timing contract", () => {
    it("rejects deprecated attributes even when canonical attributes are also present", async () => {
      const result = await lintHyperframeHtml(`<!doctype html><html><body>
        <div data-composition-id="main" data-start="0" data-duration="5">
          <div class="clip" data-start="1" data-duration="2" data-end="9" data-track-index="1" data-layer="4"></div>
        </div>
      </body></html>`);

      expect(result.findings.map(({ code }) => code)).toEqual(
        expect.arrayContaining(["deprecated_data_end", "deprecated_data_layer"]),
      );
    });

    it("uses canonical timing when deprecated attributes conflict", async () => {
      const result = await lintHyperframeHtml(`<!doctype html><html><body>
        <div data-composition-id="main" data-start="0" data-duration="5">
          <div id="a" class="clip" data-start="0" data-duration="2" data-end="9" data-track-index="1"></div>
          <div id="b" class="clip" data-start="2" data-duration="2" data-track-index="1"></div>
        </div>
      </body></html>`);

      expect(
        result.findings.find(({ code }) => code === "overlapping_clips_same_track"),
      ).toBeUndefined();
    });
  });

  describe("subcomposition guidance", () => {
    it("warns when any HTML composition file is over 300 lines", async () => {
      const html = Array.from({ length: 301 }, (_, i) =>
        i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
      ).join("\n");

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn when an HTML composition file is exactly 300 lines", async () => {
      const html = Array.from({ length: 300 }, (_, i) =>
        i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
      ).join("\n");

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeUndefined();
    });

    it("does not count a final trailing newline as an extra physical line", async () => {
      const html =
        Array.from({ length: 300 }, (_, i) =>
          i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
        ).join("\n") + "\n";

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeUndefined();
    });

    it("does not count inline style block internals as structural lines", async () => {
      const style = `<style>\n${Array.from({ length: 320 }, (_, i) => `.rule-${i} { color: red; }`).join("\n")}\n</style>`;
      const html = `<!doctype html>
<html>
  <head>${style}</head>
  <body>
    <div data-composition-id="main" data-start="0" data-duration="1">TEXT</div>
  </body>
</html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeUndefined();
    });

    it("does not warn for large registry source block files", async () => {
      const html = Array.from({ length: 301 }, (_, i) =>
        i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
      ).join("\n");

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/registry/blocks/data-chart/data-chart.html",
      });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeUndefined();
    });

    it("warns for large installed block composition files", async () => {
      const html = Array.from({ length: 301 }, (_, i) =>
        i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
      ).join("\n");

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/data-chart.html",
      });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn for large registry-installed block composition files", async () => {
      const html =
        "<!-- hyperframes-registry-item: data-chart -->\n" +
        Array.from({ length: 300 }, (_, i) =>
          i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
        ).join("\n");

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/data-chart.html",
      });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding).toBeUndefined();
    });

    it("uses nested split copy for large sub-composition files", async () => {
      const html = Array.from({ length: 301 }, (_, i) =>
        i === 0 ? "<html><body>" : `<!-- filler ${i} -->`,
      ).join("\n");

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
        isSubComposition: true,
      });
      const finding = result.findings.find((f) => f.code === "composition_file_too_large");
      expect(finding?.fixHint).toContain("Split this sub-composition further");
    });

    it("warns when more than 3 timed elements share the same track", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0">
    <div class="clip" data-start="0" data-duration="1" data-track-index="0">A</div>
    <div class="clip" data-start="1" data-duration="1" data-track-index="0">B</div>
    <div class="clip" data-start="2" data-duration="1" data-track-index="0">C</div>
    <div class="clip" data-start="3" data-duration="1" data-track-index="0">D</div>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("Track 0 has 4 timed elements");
    });

    it("does not warn when 3 timed elements share the same track", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0">
    <div class="clip" data-start="0" data-duration="1" data-track-index="0">A</div>
    <div class="clip" data-start="1" data-duration="1" data-track-index="0">B</div>
    <div class="clip" data-start="2" data-duration="1" data-track-index="0">C</div>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeUndefined();
    });

    it("does not warn when timed elements are split across tracks", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0">
    <div class="clip" data-start="0" data-duration="1" data-track-index="0">A</div>
    <div class="clip" data-start="1" data-duration="1" data-track-index="0">B</div>
    <div class="clip" data-start="2" data-duration="1" data-track-index="1">C</div>
    <div class="clip" data-start="3" data-duration="1" data-track-index="1">D</div>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeUndefined();
    });

    it("does not count timed media or script/style tags as dense track elements", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0">
    <audio data-start="0" data-duration="1" data-track-index="0"></audio>
    <audio data-start="1" data-duration="1" data-track-index="0"></audio>
    <video muted data-start="2" data-duration="1" data-track-index="0"></video>
    <script data-start="3" data-duration="1" data-track-index="0"></script>
    <style data-start="4" data-duration="1" data-track-index="0"></style>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeUndefined();
    });

    it("does not count transcript caption cues as dense track elements", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1080" data-height="1920" data-start="0">
    <div class="caption-group clip" data-start="0" data-duration="1" data-track-index="2">一</div>
    <div class="caption-line clip" data-start="1" data-duration="1" data-track-index="2">二</div>
    <div class="caption_block clip" data-start="2" data-duration="1" data-track-index="2">三</div>
    <div class="cg-4 clip" data-start="3" data-duration="1" data-track-index="2">四</div>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeUndefined();
    });

    it("does not count root composition or mounted sub-compositions as dense elements", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-track-index="0">
    <div data-composition-id="a" data-composition-src="compositions/a.html" data-start="0" data-duration="1" data-track-index="0"></div>
    <div data-composition-id="b" data-composition-src="compositions/b.html" data-start="1" data-duration="1" data-track-index="0"></div>
    <div data-composition-id="c" data-composition-src="compositions/c.html" data-start="2" data-duration="1" data-track-index="0"></div>
    <div data-composition-id="d" data-composition-src="compositions/d.html" data-start="3" data-duration="1" data-track-index="0"></div>
  </div>
</body></html>`;

      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find((f) => f.code === "timeline_track_too_dense");
      expect(finding).toBeUndefined();
    });
  });

  describe("duplicate_composition_id", () => {
    it("flags a meta tag and root div sharing the same data-composition-id", async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="composition-id" data-composition-id="x">
</head>
<body>
  <div data-composition-id="x" data-width="1920" data-height="1080" data-start="0" data-duration="1" data-no-timeline></div>
</body>
</html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag a single valid composition id", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="1" data-no-timeline></div>
</body>
</html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeUndefined();
    });

    it("does not flag distinct composition ids in one file", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5" data-no-timeline>
    <div data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="5"></div>
  </div>
</body>
</html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeUndefined();
    });

    it("ignores composition ids inside inert template content", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="1" data-no-timeline></div>
  <template><div data-composition-id="main"></div></template>
</body></html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeUndefined();
    });

    it("flags entity-equivalent composition ids", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="1" data-no-timeline></div>
  <meta data-composition-id="&#109;ain">
</body></html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeDefined();
    });

    it("uses the browser's first value for duplicate attributes", async () => {
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="1" data-no-timeline></div>
  <meta data-composition-id="main" data-composition-id="other">
</body></html>`;

      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "duplicate_composition_id");
      expect(finding).toBeDefined();
    });
  });

  it("reports error when querySelector uses template literal variable", async () => {
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
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error for querySelectorAll with template literal variable", async () => {
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
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
  });

  it("does not report error for hardcoded querySelector strings", async () => {
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
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeUndefined();
  });

  it("reports error when a selector combines data attributes in one bracket", async () => {
    const html = `
<template id="scene-template">
  <div data-composition-id="scene" data-start="0" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="scene" data-start="0"] .title { opacity: 0; }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      const title = document.querySelector('[data-composition-id="scene" data-start="0"] .title');
      const tl = gsap.timeline({ paused: true });
      tl.to('[data-composition-id="scene" data-start="0"]', { opacity: 0, duration: 0.5 }, 4);
      window.__timelines["scene"] = tl;
    </script>
  </div>
</template>`;
    const result = await lintHyperframeHtml(html, { filePath: "compositions/scene.html" });
    const findings = result.findings.filter((f) => f.code === "split_data_attribute_selector");
    expect(findings.length).toBe(1);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.fixHint).toContain('[data-composition-id="scene"][data-start="0"]');
  });

  describe("timed_element_missing_clip_class", () => {
    it("flags element with data-start but no class='clip'", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag element that has class='clip'", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeUndefined();
    });

    it("does not flag audio or video elements", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeUndefined();
    });

    it("does not flag element with only data-track-index (layer container, no timing)", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="layer" data-track-index="0">
      <div id="box" class="clip" data-start="0" data-duration="2">Hello</div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "timed_element_missing_clip_class");
      expect(finding).toBeUndefined();
    });
  });

  describe("overlapping_clips_same_track", () => {
    it("flags overlapping clips on the same track", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag clips on different tracks", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeUndefined();
    });

    it("does not flag sequential clips on the same track", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeUndefined();
    });

    it("does not flag adjacencies where parseFloat + add drifts by a few ulps", async () => {
      // parseFloat("0.1") + parseFloat("0.2") = 0.30000000000000004
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080">
    <div class="clip" data-start="0.1" data-duration="0.2" data-track-index="0">A</div>
    <div class="clip" data-start="0.3" data-duration="0.2" data-track-index="0">B</div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "overlapping_clips_same_track");
      expect(finding).toBeUndefined();
    });
  });

  describe("root_composition_missing_html_wrapper", () => {
    it("flags bare composition div as error", async () => {
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
      const result = await lintHyperframeHtml(html, { filePath: "index.html" });
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(result.ok).toBe(false);
    });

    it("does not flag properly wrapped HTML composition", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag composition starting with <html> (no doctype)", async () => {
      const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="5"></div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag sub-compositions", async () => {
      const html = `<div data-composition-id="sub" data-width="1920" data-height="1080">
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["sub"] = gsap.timeline({ paused: true });
  </script>
</div>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag HTML without composition attributes", async () => {
      const html = `<div id="hello"><p>Not a composition</p></div>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeUndefined();
    });

    it("includes root tag snippet in finding", async () => {
      const html = `<div data-composition-id="bare" data-width="1920" data-height="1080">
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["bare"] = gsap.timeline({ paused: true });
  </script>
</div>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_html_wrapper",
      );
      expect(finding).toBeDefined();
      expect(finding?.snippet).toContain("data-composition-id");
    });
  });

  describe("standalone_composition_wrapped_in_template", () => {
    it("flags root index.html wrapped in template", async () => {
      const html = `<template id="main-template">
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag sub-compositions in template", async () => {
      const html = `<template id="sub-template">
  <div data-composition-id="sub" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["sub"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeUndefined();
    });
  });

  describe("requestanimationframe_in_composition", () => {
    it("flags requestAnimationFrame usage in script content", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    requestAnimationFrame(() => { console.log("tick"); });
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "requestanimationframe_in_composition",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not flag requestAnimationFrame in comments", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    // requestAnimationFrame(() => { });
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "requestanimationframe_in_composition",
      );
      expect(finding).toBeUndefined();
    });

    it("does not flag installed registry blocks that use rAF (e.g. particle effects)", async () => {
      const html =
        `<!-- hyperframes-registry-item: particles -->\n` +
        `<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    requestAnimationFrame(function loop() { requestAnimationFrame(loop); });
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "requestanimationframe_in_composition",
      );
      expect(finding).toBeUndefined();
    });
  });

  describe("missing_data_no_timeline", () => {
    it("warns when root has no timeline registration and no data-no-timeline", async () => {
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" data-width="320" data-height="180" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "missing_data_no_timeline");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
    });

    it("does not warn when data-no-timeline is present (boolean form)", async () => {
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" data-no-timeline data-width="320" data-height="180" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeUndefined();
    });

    it("does not warn when a script registers window.__timelines[id]", async () => {
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" data-width="320" data-height="180" data-duration="5"></div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeUndefined();
    });

    it("does not warn when there is no root composition-id", async () => {
      const html = `<!DOCTYPE html><html><body><p>hello</p></body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeUndefined();
    });

    it("does not false-positive when data-no-timeline appears only inside an attribute value", async () => {
      // Regression: /\bdata-no-timeline\b/ matched substrings inside values
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" title="add data-no-timeline here" data-width="320" data-height="180" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeDefined();
    });

    it("does not suppress when a hyphenated variant like data-no-timeline-start is present", async () => {
      // Regression: /\bdata-no-timeline\b/ matched data-no-timeline-start because
      // hyphen is a non-word char and \b fires between 'e' and '-'
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" data-no-timeline-start="0" data-width="320" data-height="180" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeDefined();
    });

    it("does not warn for sub-compositions", async () => {
      const html = `<template><div data-composition-id="c1" data-width="320" data-height="180" data-duration="5"></div></template>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeUndefined();
    });

    it("does not warn when composition has external scripts (cannot scan for timeline registration)", async () => {
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="c1" data-width="320" data-height="180" data-duration="5"></div>
  <script src="app.js"></script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(result.findings.find((f) => f.code === "missing_data_no_timeline")).toBeUndefined();
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

    it("does not warn on a docs-compliant root with no data-duration", async () => {
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
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "root_composition_missing_data_duration",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn even on the original Infinity-risk shape (no media, looping timeline)", async () => {
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
      const result = await lintHyperframeHtml(html);
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

  describe("root_composition_missing_data_start", () => {
    it("does not warn for template-wrapped sub-composition files", async () => {
      const html = `
<template id="foo-template">
  <div data-composition-id="foo" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="1"></div>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html, { isSubComposition: true });
      const finding = result.findings.find((f) => f.code === "root_composition_missing_data_start");
      expect(finding).toBeUndefined();
    });
  });

  describe("unknown_variable_binding", () => {
    it("warns when data-var-src references an undeclared variable", async () => {
      const html = `<html data-composition-variables='[{"id":"hero","type":"image","label":"Hero","default":"a.jpg"}]'><body>
<img id="i" data-start="0" data-duration="2" data-var-src="heroImge" src="a.jpg" />
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "unknown_variable_binding");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toMatch(/heroImge/);
    });

    it("stays quiet for declared binding ids and for fragment files", async () => {
      const declared = `<html data-composition-variables='[{"id":"title","type":"string","label":"T","default":"x"}]'><body>
<h1 data-var-text="title">x</h1>
</body></html>`;
      expect(
        (await lintHyperframeHtml(declared)).findings.some(
          (f) => f.code === "unknown_variable_binding",
        ),
      ).toBe(false);

      const fragment = `<div class="clip" data-start="0" data-duration="2" data-var-text="hostProvided">x</div>`;
      expect(
        (await lintHyperframeHtml(fragment)).findings.some(
          (f) => f.code === "unknown_variable_binding",
        ),
      ).toBe(false);
    });
  });

  describe("invalid_variable_values_json", () => {
    it("warns when data-variable-values is unparseable JSON", async () => {
      const html = `<html><body>
<div data-composition-id="card-1" data-composition-src="card.html" data-variable-values='{not json'></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_variable_values_json");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("warns when data-variable-values is a JSON array (must be an object)", async () => {
      const html = `<html><body>
<div data-composition-src="card.html" data-variable-values='[1,2,3]'></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_variable_values_json");
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/must be a JSON object/);
    });

    it("warns when data-variable-values is a JSON string (must be an object)", async () => {
      const html = `<html><body>
<div data-composition-src="card.html" data-variable-values='"hello"'></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_variable_values_json");
      expect(finding).toBeDefined();
    });

    it("does not warn for a valid JSON object", async () => {
      const html = `<html><body>
<div data-composition-src="card.html" data-variable-values='{"title":"Hello","count":3}'></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_variable_values_json");
      expect(finding).toBeUndefined();
    });

    it("does not warn when data-variable-values is absent", async () => {
      const html = `<html><body>
<div data-composition-src="card.html"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "invalid_variable_values_json");
      expect(finding).toBeUndefined();
    });
  });

  describe("invalid_composition_variables_declaration", () => {
    it("warns when data-composition-variables is unparseable JSON", async () => {
      const html = `<html data-composition-variables='[{not json'><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(finding).toBeDefined();
    });

    it("warns when data-composition-variables is not an array", async () => {
      const html = `<html data-composition-variables='{"title":"Hello"}'><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/array of variable declarations/);
    });

    it("warns per-entry when an entry is missing required fields", async () => {
      const html = `<html data-composition-variables='[{"id":"ok","type":"string","label":"Ok","default":"x"},{"id":"bad"}]'><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const findings = result.findings.filter(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(findings.length).toBe(1);
      expect(findings[0]?.message).toMatch(/\[1\]/);
      expect(findings[0]?.message).toMatch(/type|label|default/);
    });

    it("warns when a declaration uses an unknown type", async () => {
      const html = `<html data-composition-variables='[{"id":"x","type":"date","label":"X","default":"y"}]'><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/type/);
    });

    it("does not warn for a fully valid declarations array", async () => {
      const html = `<html data-composition-variables='[
        {"id":"title","type":"string","label":"Title","default":"Hello"},
        {"id":"count","type":"number","label":"Count","default":3},
        {"id":"theme","type":"enum","label":"Theme","default":"light","options":[{"value":"light","label":"Light"}]}
      ]'><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn when data-composition-variables is absent", async () => {
      const html = `<html><body><div data-composition-id="x"></div></body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "invalid_composition_variables_declaration",
      );
      expect(finding).toBeUndefined();
    });
  });

  describe("invalid_parent_traversal_in_asset_path", () => {
    const RULE_CODE = "invalid_parent_traversal_in_asset_path";

    it("errors when an <img> src uses ../capture/", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="../capture/assets/logo.svg" alt="logo">
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("../capture/");
    });

    it("errors when a <video> src uses ../assets/ (HF#1698 shape)", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <video src="../assets/clip.mp4" muted></video>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("../assets/");
    });

    it("errors when a <video> src uses ../../assets/ from a nested compositions/frames/ file", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <video src="../../assets/clip.mp4" muted></video>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/frames/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("../../assets/");
    });

    it("errors when a <link> href uses ../fonts/", async () => {
      const html = `<html><head>
        <link rel="stylesheet" href="../fonts/brand.css">
      </head><body>
        <div data-composition-id="x"></div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("../fonts/");
    });

    it("errors when a CSS url() uses ../assets/ in a <style> block (counts all occurrences)", async () => {
      const html = `<html><body>
        <style>
          @font-face { font-family: 'Brand'; src: url('../fonts/Brand.woff2'); }
          .hero { background-image: url('../assets/hero.png'); }
        </style>
        <div data-composition-id="x"></div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("2 asset path(s)");
    });

    it("errors when an inline style url() uses ../assets/", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <div style="background-image: url('../assets/hero.png');"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("../assets/");
    });

    it("does not flag root-relative capture/ paths", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="capture/assets/logo.svg" alt="logo">
        </div>
        <style>.hero { background-image: url('capture/assets/hero.png'); }</style>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag plain relative asset paths (e.g. assets/x.mp4)", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <video src="assets/x.mp4" muted></video>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag absolute URLs", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="https://example.com/foo.png">
          <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
          <style>.hero { background-image: url('https://example.com/hero.png'); }</style>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag data: URIs", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="data:image/png;base64,iVBORw0KGgo=">
          <style>.hero { background-image: url('data:image/svg+xml,%3Csvg/%3E'); }</style>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag root-relative absolute paths (e.g. /absolute/path.mp4)", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <video src="/absolute/path.mp4" muted></video>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it('does not flag hash refs (e.g. href="#anchor")', async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <a href="#section">jump</a>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag registry source block files", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="../assets/should-be-ignored.png">
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/registry/blocks/data-chart/data-chart.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not flag installed registry blocks", async () => {
      const html = `<!-- hyperframes-registry-item: data-chart -->\n<html><body>
        <div data-composition-id="x">
          <img src="../assets/should-be-ignored.png">
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/data-chart.html",
      });
      const finding = result.findings.find((f) => f.code === RULE_CODE);
      expect(finding).toBeUndefined();
    });

    it("does not regress under the old code (invalid_capture_path) — the rule was renamed", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="../capture/assets/logo.svg" alt="logo">
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      // The old code is gone; the new code subsumes it.
      const oldFinding = result.findings.find((f) => f.code === "invalid_capture_path");
      expect(oldFinding).toBeUndefined();
      const newFinding = result.findings.find((f) => f.code === RULE_CODE);
      expect(newFinding).toBeDefined();
    });
  });

  describe("html_dir_attribute_breaks_render", () => {
    const CODE = "html_dir_attribute_breaks_render";
    const find = (findings: { code: string }[]) => findings.find((f) => f.code === CODE);

    it('flags dir="rtl" on <html>', async () => {
      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5">مرحبا</div>
</body>
</html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain('dir="rtl"');
      expect(finding?.fixHint).toContain("direction: rtl");
    });

    it('flags dir="auto" on <html>', async () => {
      const html = `<html dir="AUTO"><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.fixHint).toContain('dir="auto"');
    });

    it('does not flag dir="ltr"', async () => {
      const html = `<html dir="ltr"><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not flag invalid dir values that browsers treat as ltr", async () => {
      const html = `<html dir="bogus"><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not flag when <html> has no dir attribute", async () => {
      const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5"></div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it('does not flag dir="rtl" scoped to an individual element (the documented fix)', async () => {
      const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-duration="5">
    <p style="direction: rtl;">مرحبا</p>
  </div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });
  });

  describe("subcomposition_blanks_before_host", () => {
    const find = (findings: Array<{ code: string }>) =>
      findings.find((f) => f.code === "subcomposition_blanks_before_host");

    it("fires on the issue #1540 shape (child shorter than host)", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="331.224" data-width="1920" data-height="1080">
          <div id="decision-tree-comp" data-composition-id="decision-tree" data-composition-src="compositions/decision_tree.html" data-start="0" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("blank");
      expect(finding?.message).toContain("331.224");
    });

    it("fires when the mount starts within the start tolerance", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0.3" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeDefined();
    });

    it("fires at exactly the start tolerance boundary (start=0.5)", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0.5" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeDefined();
    });

    it("stays silent on an intentional short intro followed by another clip", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0" data-duration="15"></div>
          <div data-composition-id="body" data-composition-src="compositions/body.html" data-start="15" data-duration="45"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent when the child matches the host window", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="15">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent when the child is longer than the host", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="15">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="30"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent for a non-sub-composition timed element", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div class="clip" data-start="0" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent when the root has no numeric data-duration", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="15"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent for a late-starting clip", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="40" data-duration="5"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });

    it("stays silent when an unknown-duration sibling covers the tail", async () => {
      const html = `<html><body>
        <div id="root" data-composition-id="main" data-start="0" data-duration="60">
          <div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="15"></div>
          <div class="clip" data-start="0"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      expect(find(result.findings)).toBeUndefined();
    });
  });

  describe("root_composition_missing_duration_source", () => {
    const CODE = "root_composition_missing_duration_source";
    const find = (findings: { code: string }[]) => findings.find((f) => f.code === CODE);

    it("errors when there is no data-duration, no GSAP timeline, and no animation signal at all", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <div>static content</div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not error when data-duration is declared on the root", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-duration="6" data-width="1920" data-height="1080">
          <div>static content</div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error when a GSAP timeline is registered", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080"></div>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error when a GSAP timeline is registered with a computed bracket key", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080"></div>
        <script>
          var spec = { id: "main" };
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines[spec.id] = tl;
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error for a finite CSS animation (runtime auto-infers duration)", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .box { animation: fadeIn 3s ease forwards; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          </style>
          <div class="box"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error for a WAAPI .animate() call (runtime auto-infers duration)", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <div class="box"></div>
        </div>
        <script>
          document.querySelector(".box").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000 });
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error for a registered Lottie animation (runtime auto-infers duration)", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <div id="anim"></div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
        <script>
          window.__hfLottie = window.__hfLottie || [];
          const anim = lottie.loadAnimation({
            container: document.getElementById("anim"),
            renderer: "svg",
            loop: false,
            autoplay: false,
            path: "animation.json",
          });
          window.__hfLottie.push(anim);
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("errors for an infinite CSS animation with no data-duration", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .spinner { animation: spin 1s linear infinite; }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          </style>
          <div class="spinner"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("errors for a mixed finite + infinite CSS animation with no data-duration (length is ambiguous)", async () => {
      // The runtime CAN infer 3s here (from the finite `fadeIn`), but an
      // unbounded `spin infinite` alongside it makes the intended total length
      // ambiguous, so the rule stays strict and requires an explicit
      // data-duration. Deliberately stricter than runtime inference — see the
      // rule's block comment. Message must NOT claim the render will fail
      // (it wouldn't — the runtime falls back to the finite animation).
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .fade { animation: fadeIn 3s ease forwards; }
            .spinner { animation: spin 1s linear infinite; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          </style>
          <div class="fade"></div>
          <div class="spinner"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      // Honest message: describes the ambiguity, does not assert a hard failure.
      expect(finding?.message).toContain("ambiguous");
      expect(finding?.message).not.toContain("will fail");
    });

    it("does not error for an infinite CSS animation when data-duration is declared", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-duration="8" data-width="1920" data-height="1080">
          <style>
            .spinner { animation: spin 1s linear infinite; }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          </style>
          <div class="spinner"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("errors for Three.js usage with no data-duration", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <canvas id="scene"></canvas>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>
        <script>
          const renderer = new THREE.WebGLRenderer();
          const scene = new THREE.Scene();
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not error for Three.js usage when data-duration is declared", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
          <canvas id="scene"></canvas>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/three@0.160/build/three.min.js"></script>
        <script>
          const renderer = new THREE.WebGLRenderer();
          const scene = new THREE.Scene();
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not apply to sub-compositions", async () => {
      const html = `<template id="scene-template">
        <div data-composition-id="scene" data-start="0" data-width="1920" data-height="1080">
          <div>static content</div>
        </div>
      </template>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "compositions/scene.html",
        isSubComposition: true,
      });
      expect(find(result.findings)).toBeUndefined();
    });

    it("errors when the only .animate() call is commented out (no real duration source)", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <div class="box"></div>
        </div>
        <script>
          // document.querySelector(".box").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000 });
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("errors when the only CSS animation is inside a comment (no real duration source)", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            /* .box { animation: spin 2s infinite; } */
            .box { color: red; }
          </style>
          <div class="box"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not error for the object-literal (PropertyIndexedKeyframes) WAAPI form", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <div class="box"></div>
        </div>
        <script>
          document.querySelector(".box").animate({ opacity: [0, 1] }, { duration: 2000 });
        </script>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("does not error for a finite CSS animation whose name merely contains 'infinite'", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .marquee { animation: infinite-spin 2s ease; }
            @keyframes infinite-spin { from { transform: translateX(0); } to { transform: translateX(-100%); } }
          </style>
          <div class="marquee"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });

    it("errors for the longhand animation-name + animation-iteration-count: infinite combination", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .spinner {
              animation-name: infinite-scroll;
              animation-duration: 1s;
              animation-iteration-count: infinite;
            }
            @keyframes infinite-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
          </style>
          <div class="spinner"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = find(result.findings);
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("does not error for the longhand animation-name form with a finite iteration count", async () => {
      const html = `<html><body>
        <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
          <style>
            .spinner {
              animation-name: infinite-scroll;
              animation-duration: 1s;
              animation-iteration-count: 3;
            }
            @keyframes infinite-scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
          </style>
          <div class="spinner"></div>
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      expect(find(result.findings)).toBeUndefined();
    });
  });

  // composition_heavy_overlay_count_high — field signal ts=1784040753.
  // See rule comments in ../rules/composition.ts for the black-frame repro
  // story. Threshold: WARN at 25+ elements with filter:blur / clip-path
  // (non-none) / radial-gradient. Presence-based: opacity:0 and
  // visibility:hidden are counted-in, display:none is counted-out.
  describe("composition_heavy_overlay_count_high", () => {
    const wrap = (bodyInner: string, headInner = ""): string =>
      `<!DOCTYPE html><html><head>${headInner}</head><body>
        <div data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
          ${bodyInner}
        </div>
      </body></html>`;

    const repeat = (n: number, template: (i: number) => string): string =>
      Array.from({ length: n }, (_, i) => template(i)).join("\n");

    it("warns when a composition has 40 blur-filtered overlays", async () => {
      const overlays = repeat(
        40,
        (i) => `<div id="ov-${i}" style="filter: blur(6px); opacity: 0.6"></div>`,
      );
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toMatch(/40 elements/);
      expect(finding?.message).toMatch(/filter:blur/);
      expect(finding?.fixHint).toMatch(/ts=1784040753/);
    });

    it("warns when 30 elements share a clip-path class defined in a <style> block", async () => {
      const head = `<style>.clipped { clip-path: circle(50%); }</style>`;
      const overlays = repeat(30, (i) => `<div id="c-${i}" class="clipped"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays, head));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/30 elements/);
    });

    it("warns when 25 mixed heavy overlays are present (blur + clip-path + radial-gradient)", async () => {
      const head = `<style>.clipped { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }</style>`;
      const blur = repeat(9, (i) => `<div id="b-${i}" style="filter: blur(4px)"></div>`);
      const clip = repeat(8, (i) => `<div id="c-${i}" class="clipped"></div>`);
      const radial = repeat(
        8,
        (i) => `<div id="r-${i}" style="background: radial-gradient(circle, red, blue)"></div>`,
      );
      const result = await lintHyperframeHtml(wrap(blur + clip + radial, head));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/25 elements/);
    });

    it("does not warn when only 5 blur overlays are present (well below threshold)", async () => {
      const overlays = repeat(5, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn on 40 plain non-overlay divs (no heavy CSS anywhere)", async () => {
      const overlays = repeat(40, (i) => `<div id="p-${i}">plain ${i}</div>`);
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("counts opacity:0 blur overlays IN (presence alone matters per field signal)", async () => {
      const overlays = repeat(
        30,
        (i) => `<div id="hidden-${i}" style="filter: blur(6px); opacity: 0"></div>`,
      );
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/30 elements/);
    });

    it("counts visibility:hidden blur overlays IN (presence alone matters)", async () => {
      const overlays = repeat(
        30,
        (i) => `<div id="hidden-${i}" style="filter: blur(6px); visibility: hidden"></div>`,
      );
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
    });

    it("counts display:none blur overlays OUT (element removed from render tree)", async () => {
      const overlays = repeat(
        40,
        (i) => `<div id="gone-${i}" style="filter: blur(6px); display: none"></div>`,
      );
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn on registry source files (block library authoring surface)", async () => {
      const overlays = repeat(40, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays), {
        filePath: "/project/registry/blocks/blur-hero/blur-hero.html",
      });
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn on registry-installed block files (`hyperframes-registry-item` marker)", async () => {
      const overlays = repeat(40, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const html =
        "<!-- hyperframes-registry-item: blur-hero -->\n" +
        `<!DOCTYPE html><html><body>
          <div data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
            ${overlays}
          </div>
        </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/blur-hero.html",
      });
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("does not warn when 24 heavy overlays are present (just below threshold)", async () => {
      const overlays = repeat(24, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("ignores `clip-path: none` (does not count as a heavy overlay)", async () => {
      const overlays = repeat(40, (i) => `<div id="none-${i}" style="clip-path: none"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeUndefined();
    });

    it("matches heavy selectors by leftmost id (e.g. `#hero { clip-path: ... }`)", async () => {
      const head = `<style>#hero-${0} { clip-path: circle(30%); }</style>`;
      // Single id selector wouldn't match 30 elements meaningfully, so use a
      // class-based repro plus one id-hit to prove the id lookup runs.
      const clipHead = `<style>.clipped { clip-path: circle(50%); }</style>${head}`;
      const clipped = repeat(29, (i) => `<div id="c-${i}" class="clipped"></div>`);
      const idHit = `<div id="hero-0"></div>`;
      const result = await lintHyperframeHtml(wrap(clipped + idHit, clipHead));
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/30 elements/);
    });

    it("uses sub-composition-flavored fix hint when isSubComposition is set", async () => {
      const overlays = repeat(30, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const result = await lintHyperframeHtml(wrap(overlays), {
        isSubComposition: true,
      });
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.fixHint).toMatch(/sub-composition further/);
    });

    it("does not double-count the composition root itself (only overlay children)", async () => {
      // 25 blur overlays live inside a root that itself has `filter: blur(...)`.
      // If we counted the root too, the count would be 26 (still fires); the
      // message must report 25 to prove the root skip is working.
      const overlays = repeat(25, (i) => `<div id="ov-${i}" style="filter: blur(6px)"></div>`);
      const html = `<!DOCTYPE html><html><body>
        <div data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080" style="filter: blur(8px)">
          ${overlays}
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "composition_heavy_overlay_count_high",
      );
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/25 elements/);
    });
  });
});
