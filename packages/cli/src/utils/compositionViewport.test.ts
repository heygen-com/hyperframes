import { describe, expect, it } from "vitest";
import { resolveCompositionViewportFromHtml } from "./compositionViewport.js";

describe("resolveCompositionViewportFromHtml", () => {
  it("uses root composition dimensions", () => {
    const html = `
<html><body>
  <div data-composition-id="portrait" data-width="1080" data-height="1920"></div>
</body></html>`;

    expect(resolveCompositionViewportFromHtml(html)).toEqual({ width: 1080, height: 1920 });
  });

  it("falls back to landscape defaults when dimensions are missing", () => {
    expect(resolveCompositionViewportFromHtml("<html><body></body></html>")).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});
