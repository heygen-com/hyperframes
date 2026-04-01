import { describe, it, expect, vi } from "vitest";
import { lintHyperframeHtml, lintScriptUrls } from "./hyperframeLinter.js";

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

  it("reports no errors for a valid composition", () => {
    const result = lintHyperframeHtml(validComposition);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("attaches filePath to findings when option is set", () => {
    const html = "<html><body><div></div></body></html>";
    const result = lintHyperframeHtml(html, { filePath: "test.html" });
    for (const finding of result.findings) {
      expect(finding.file).toBe("test.html");
    }
  });

  it("deduplicates identical findings", () => {
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

  it("strips <template> wrapper before linting composition files", () => {
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
    const result = lintHyperframeHtml(html, { filePath: "compositions/my-comp.html" });
    const missing = result.findings.filter(
      (f) => f.code === "missing-composition-id" || f.code === "missing-dimensions",
    );
    expect(missing).toHaveLength(0);
  });
});

describe("lintScriptUrls", () => {
  it("reports error for script URL returning non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://unpkg.com/@hyperframe/player@latest/dist/player.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    const finding = findings.find((f) => f.code === "inaccessible_script_url");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("404");

    vi.unstubAllGlobals();
  });

  it("reports error for unreachable script URL", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://example.invalid/nonexistent.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    const finding = findings.find((f) => f.code === "inaccessible_script_url");
    expect(finding).toBeDefined();

    vi.unstubAllGlobals();
  });

  it("does not flag accessible script URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    expect(findings.length).toBe(0);

    vi.unstubAllGlobals();
  });

  it("skips inline scripts without src", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>console.log("inline")</script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    expect(findings.length).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
