import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "./hyperframeLinter.js";

describe("lintHyperframeHtml — orchestrator", () => {
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

  it("reports no errors for a valid composition", async () => {
    const result = await lintHyperframeHtml(validComposition);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("attaches filePath to findings when option is set", async () => {
    const html = "<html><body><div></div></body></html>";
    const result = await lintHyperframeHtml(html, { filePath: "test.html" });
    for (const finding of result.findings) {
      expect(finding.file).toBe("test.html");
    }
  });

  it("deduplicates identical findings", async () => {
    const html = `
<html><body>
  <div id="root"></div>
  <script>const tl = gsap.timeline();</script>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const codes = result.findings.map((f) => `${f.code}|${f.message}`);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });

  it("strips <template> wrapper before linting composition files", async () => {
    const html = `<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080"
       style="position:relative;width:1920px;height:1080px;">
    <div id="stage"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["my-comp"] = tl;
  </script>
</template>`;
    const result = await lintHyperframeHtml(html, { filePath: "compositions/my-comp.html" });
    const missing = result.findings.filter(
      (f) => f.code === "missing-composition-id" || f.code === "missing-dimensions",
    );
    expect(missing).toHaveLength(0);
  });
});
