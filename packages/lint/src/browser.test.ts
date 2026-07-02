import { describe, expect, it } from "vitest";
import { lintHyperframeHtml, shouldBlockRender } from "./browser.js";

// Guards that @hyperframes/lint/browser exposes a working, node-free rule engine.
// (The platform:"browser" tsup build is the compile-time node-free guarantee;
// this verifies the API actually runs.)
describe("@hyperframes/lint/browser", () => {
  it("lints an HTML string with no filesystem access", async () => {
    const html = `<html><body>
      <div data-composition-id="main" data-width="1920" data-height="1080"></div>
    </body></html>`;
    const result = await lintHyperframeHtml(html, { filePath: "index.html" });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("exposes the pure shouldBlockRender gate", () => {
    expect(shouldBlockRender(true, false, 1, 0)).toBe(true);
    expect(shouldBlockRender(true, false, 0, 3)).toBe(false);
    expect(shouldBlockRender(false, true, 0, 1)).toBe(true);
  });
});
