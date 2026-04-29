import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("core rules", () => {
  it("reports error when root is missing data-composition-id", () => {
    const html = `
<html><body>
  <div id="root" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_composition_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error when root is missing data-width or data-height", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_dimensions");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error when timeline registry is missing", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    const tl = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_timeline_registry");
    expect(finding).toBeDefined();
  });

  it("reports error for composition host missing data-composition-id", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="host1" data-composition-src="child.html"></div>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "host_missing_composition_id");
    expect(finding).toBeDefined();
  });

  it("reports error when timeline registry is assigned without initializing", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("without initializing");
  });

  it("does not flag timeline assignment when init guard is present", () => {
    const validComposition = `
<html>
<body>
  <div id="root" data-composition-id="comp-1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script src="https://cdn.gsap.com/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["comp-1"] = tl;
  </script>
</body>
</html>`;
    const result = lintHyperframeHtml(validComposition);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeUndefined();
  });

  describe("non_deterministic_code", () => {
    it("detects Math.random() in script content", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const x = Math.random();
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("Math.random");
    });

    it("detects Date.now() in script content", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const ts = Date.now();
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain("Date.now");
    });

    it("does not flag non-deterministic calls inside single-line comments", () => {
      const html = `
<html><body>
  <div data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    // const x = Math.random();
    // Date.now() is not used here
    window.__timelines["c1"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "non_deterministic_code");
      expect(finding).toBeUndefined();
    });
  });

  describe("composition_self_attribute_selector", () => {
    it("warns when inline CSS targets the root composition id", () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="scene"] .title { opacity: 0; }
      [data-composition-id="other"] .title { color: red; }
    </style>
    <h1 class="title">Hello</h1>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const findings = result.findings.filter(
        (f) => f.code === "composition_self_attribute_selector",
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe("warning");
      expect(findings[0]?.selector).toBe('[data-composition-id="scene"] .title');
      expect(findings[0]?.fixHint).toContain("#scene");
      expect(findings[0]?.fixHint).not.toContain("#556");
    });

    it("warns when external CSS targets the root composition id", () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = lintHyperframeHtml(html, {
        externalStyles: [
          {
            href: "scene.css",
            content: '[data-composition-id="scene"] .title { opacity: 0; }',
          },
        ],
      });
      const finding = result.findings.find((f) => f.code === "composition_self_attribute_selector");

      expect(finding).toBeDefined();
      expect(finding?.selector).toBe('[data-composition-id="scene"] .title');
    });

    it("does not warn when CSS targets a different composition id", () => {
      const html = `
<html><body>
  <div id="scene" data-composition-id="scene" data-width="1920" data-height="1080">
    <style>[data-composition-id="other"] .title { opacity: 0; }</style>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
      const result = lintHyperframeHtml(html);
      const finding = result.findings.find((f) => f.code === "composition_self_attribute_selector");

      expect(finding).toBeUndefined();
    });
  });
});
