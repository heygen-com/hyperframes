import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("composition rules", () => {
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

  it("reports info for composition with external CDN script dependency", async () => {
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
    const result = await lintHyperframeHtml(html, { filePath: "compositions/rockets.html" });
    const finding = result.findings.find(
      (f) => f.code === "external_script_dependency" && f.message.includes("cdnjs.cloudflare.com"),
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    // info findings do not count as errors — ok should still be true
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("does not report external_script_dependency for inline scripts", async () => {
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
    const result = await lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "external_script_dependency")).toBeUndefined();
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
      expect(finding?.severity).toBe("warning");
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
      // Fixture deliberately uses id="root" — a non-`-template` suffix — so
      // it stays a true positive after the sub-composition-template
      // self-suppression FP fix. The `-template` id suffix is the documented
      // sub-composition signal; anything else is a likely misuse.
      const html = `<template id="root">
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
      expect(finding?.severity).toBe("warning");
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

    it("does not flag a `<template id='*-template'>` wrapper even without isSubComposition (FP fix)", async () => {
      // `compositions/beat-1.html` is a sub-composition by convention. When
      // a caller forgets to pass `isSubComposition: true`, the file's top-
      // level `<template id='beat-1-template'>` wrapper is itself the
      // signal, so the rule should self-suppress.
      const html = `<template id="beat-1-template">
  <div data-composition-id="beat-1" data-width="1920" data-height="1080">
    <div class="hero"></div>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeUndefined();
    });

    it("still flags a bare `<template>` wrapper with no `-template` id (true positive)", async () => {
      // No `-template` id suffix means we can't distinguish this from a
      // genuine misuse of `<template>` at the document root.
      const html = `<template>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
</template>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find(
        (f) => f.code === "standalone_composition_wrapped_in_template",
      );
      expect(finding).toBeDefined();
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
      expect(finding?.severity).toBe("warning");
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
  });

  describe("set_timeout_in_composition", () => {
    it("flags setTimeout usage in script content", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    setTimeout(() => { console.log("delayed"); }, 1000);
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "set_timeout_in_composition");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("setTimeout");
    });

    it("flags setInterval usage", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    setInterval(() => {}, 500);
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "set_timeout_in_composition");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("setInterval");
    });

    it("does not flag setTimeout inside comments or string literals", async () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    // setTimeout(() => {}, 1000);
    const note = "use setTimeout instead";
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "set_timeout_in_composition");
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

    it("does not warn when the file is wrapped in `<template id='*-template'>` (FP fix)", async () => {
      // Real-world: linting `compositions/beat-1.html` standalone, without
      // the caller flagging `isSubComposition`. The `-template` id suffix
      // is the sub-composition signal.
      const html = `<template id="beat-1-template">
  <div data-composition-id="beat-1" data-width="1920" data-height="1080">
    <div class="hero"></div>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "root_composition_missing_data_start");
      expect(finding).toBeUndefined();
    });

    it("still warns on a real root composition missing data-start (true positive)", async () => {
      // Plain HTML document with a root `data-composition-id` and no
      // `data-start` — the rule must still fire so the FP-fix doesn't
      // silently broaden suppression.
      const html = `<!DOCTYPE html><html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="hero"></div>
  </div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "root_composition_missing_data_start");
      expect(finding).toBeDefined();
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
      expect(finding?.severity).toBe("warning");
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

  describe("invalid_capture_path", () => {
    it("errors when an <img> src uses ../capture/", async () => {
      const html = `<html><body>
        <div data-composition-id="x">
          <img src="../capture/assets/logo.svg" alt="logo">
        </div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === "invalid_capture_path");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
    });

    it("errors when a CSS url() uses ../capture/ (counts all occurrences)", async () => {
      const html = `<html><body>
        <style>
          @font-face { font-family: 'Brand'; src: url('../capture/assets/fonts/Brand.woff2'); }
          .hero { background-image: url('../capture/assets/hero.png'); }
        </style>
        <div data-composition-id="x"></div>
      </body></html>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
      });
      const finding = result.findings.find((f) => f.code === "invalid_capture_path");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("2 asset path(s)");
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
      const finding = result.findings.find((f) => f.code === "invalid_capture_path");
      expect(finding).toBeUndefined();
    });
  });

  describe("sfx_data_start_must_be_master_time", () => {
    it("warns when an SFX <audio data-start> equals the beat-relative offset rather than master time", async () => {
      // beat-2 host starts at master t=6.5. Script inside the beat calls
      // playSfx('sfx-click') at position 2.0 (beat-relative). Author copied
      // the 2.0 directly to data-start, but master time should be 8.5.
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="compositions/beat-2.html" data-start="6.5" data-duration="3"></div>
    <audio id="sfx" data-track-name="sfx-click" data-start="2.0" src="capture/sfx-click.mp3"></audio>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.call(playSfx, ['sfx-click'], 2.0);
    </script>
  </div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "sfx_data_start_must_be_master_time");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("8.50");
    });

    it("does not warn when data-start is already in master time", async () => {
      // Same beat starting at master t=6.5, script call at beat-relative
      // 2.0, but data-start correctly set to 8.5 (master time).
      const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    <div data-composition-src="compositions/beat-2.html" data-start="6.5" data-duration="3"></div>
    <audio id="sfx" data-track-name="sfx-click" data-start="8.5" src="capture/sfx-click.mp3"></audio>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.call(playSfx, ['sfx-click'], 8.5);
    </script>
  </div>
</body></html>`;
      const result = await lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "sfx_data_start_must_be_master_time");
      expect(finding).toBeUndefined();
    });
  });

  describe("master_timeline_orchestrates_sub_compositions", () => {
    // Helper: build a root index.html with N sub-comp hosts. `masterScript`
    // is the body of the master <script> block (everything *between* the
    // `window.__timelines = ...` boilerplate and the `window.__timelines["main"] = tl`
    // assignment).
    const buildRoot = (subCompCount: number, masterScript: string) => {
      const hosts = Array.from(
        { length: subCompCount },
        (_, i) =>
          `<div data-composition-id="beat-${i + 1}" data-composition-src="compositions/beat-${i + 1}.html" data-start="${i * 4}" data-duration="4"></div>`,
      ).join("\n    ");
      return `<!DOCTYPE html>
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="${subCompCount * 4}">
    ${hosts}
    <audio data-track-name="vo" data-start="0" src="capture/vo.mp3"></audio>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${masterScript}
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
    };

    it("fires when 5 sub-comp hosts and master tl is only a sentinel + audio sync", async () => {
      // Sentinel-only master: tl.to({}, {duration: 20}) — orchestrates nothing.
      const html = buildRoot(5, `tl.to({}, { duration: 20 });`);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("ZERO of the 5");
      expect(finding?.message).toContain("#beat-1");
      expect(finding?.message).toContain("#beat-5");
    });

    it("does NOT fire when master tl nests each sub-comp via tl.add(window.__timelines['X'])", async () => {
      const orchestration = Array.from(
        { length: 5 },
        (_, i) => `tl.add(window.__timelines['beat-${i + 1}'], ${i * 4});`,
      ).join("\n      ");
      const html = buildRoot(5, orchestration);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });

    it("does NOT fire when master tl issues fromTo autoAlpha visibility tweens per sub-comp", async () => {
      const orchestration = Array.from(
        { length: 5 },
        (_, i) =>
          `tl.fromTo('#beat-${i + 1}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, ${i * 4});`,
      ).join("\n      ");
      const html = buildRoot(5, orchestration);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });

    it("does NOT fire when master tl assigns an alias and adds it (pattern d)", async () => {
      // tl.add(beat1Tl, 0) where beat1Tl = window.__timelines['beat-1'].
      const orchestration = Array.from(
        { length: 5 },
        (_, i) =>
          `const beat${i + 1}Tl = window.__timelines['beat-${i + 1}'];\n      tl.add(beat${i + 1}Tl, ${i * 4});`,
      ).join("\n      ");
      const html = buildRoot(5, orchestration);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });

    it('does NOT fire when master tl uses [data-composition-id="X"] selector form', async () => {
      const orchestration = Array.from(
        { length: 5 },
        (_, i) =>
          `tl.set('[data-composition-id="beat-${i + 1}"]', { className: '+=visible' }, ${i * 4});`,
      ).join("\n      ");
      const html = buildRoot(5, orchestration);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });

    it("does NOT fire when there is only one sub-comp host (single-beat composition)", async () => {
      const html = buildRoot(1, `tl.to({}, { duration: 4 });`);
      const result = await lintHyperframeHtml(html, { filePath: "/project/index.html" });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });

    it("does NOT fire on sub-compositions (template-wrapped)", async () => {
      // Sub-comps register their own paused timeline; they are not expected
      // to orchestrate siblings. Even with multiple inner hosts (which would
      // be unusual), this rule must skip when wrapped in <template>.
      const html = `<template id="scene-template">
  <div data-composition-id="scene" data-start="0" data-width="1920" data-height="1080">
    <div data-composition-id="inner-1" data-composition-src="x.html" data-start="0" data-duration="2"></div>
    <div data-composition-id="inner-2" data-composition-src="y.html" data-start="2" data-duration="2"></div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to({}, { duration: 4 });
      window.__timelines["scene"] = tl;
    </script>
  </div>
</template>`;
      const result = await lintHyperframeHtml(html, {
        filePath: "/project/compositions/scene.html",
        isSubComposition: true,
      });
      const finding = result.findings.find(
        (f) => f.code === "master_timeline_orchestrates_sub_compositions",
      );
      expect(finding).toBeUndefined();
    });
  });
});
