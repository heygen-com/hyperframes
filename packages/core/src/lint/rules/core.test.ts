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
});
