import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "./hyperframeLinter.js";

describe("lintHyperframeHtml", () => {
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

  it("reports no errors for a valid composition", () => {
    const result = lintHyperframeHtml(validComposition);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

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

  it("reports error for duplicate media ids", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" src="a.mp4" data-start="0" data-duration="5"></video>
    <video id="v1" src="b.mp4" data-start="0" data-duration="3"></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "duplicate_media_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("v1");
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

  it("attaches filePath to findings when option is set", () => {
    const html = "<html><body><div></div></body></html>";
    const result = lintHyperframeHtml(html, { filePath: "test.html" });
    for (const finding of result.findings) {
      expect(finding.file).toBe("test.html");
    }
  });

  it("deduplicates identical findings", () => {
    // Calling with the same HTML should not produce duplicate entries
    const html = `
<html><body>
  <div id="root"></div>
  <script>const tl = gsap.timeline();</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const codes = result.findings.map((f) => `${f.code}|${f.message}`);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });
});
