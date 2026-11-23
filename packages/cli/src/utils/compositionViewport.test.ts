import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCompositionViewportFromHtml } from "./compositionViewport.js";

afterEach(() => vi.unstubAllGlobals());

describe("resolveCompositionViewportFromHtml", () => {
  it("reads dimensions with the server parser without executing HTML or using an ambient parser", () => {
    const parseFromString = vi.fn(() => {
      throw new Error("ambient parser called");
    });
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString = parseFromString;
      },
    );
    vi.stubGlobal("viewportScriptRan", false);
    const html = `<html><body><script>globalThis.viewportScriptRan = true;</script>
      <div data-composition-id="main" data-width="640" data-height="360"></div>
      <img src="missing" onerror="globalThis.viewportScriptRan = true;"></body></html>`;
    expect(resolveCompositionViewportFromHtml(html)).toEqual({ width: 640, height: 360 });
    expect(parseFromString).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, "viewportScriptRan")).toBe(false);
  });
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
