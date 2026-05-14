import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPageSideCompositingSupported,
  PAGE_COMPOSITOR_BUILD_CANARY,
  PAGE_COMPOSITOR_CANVAS_ID,
} from "./engineModePageComposite.js";

describe("isPageSideCompositingSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false outside the browser (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns false outside the browser (no document)", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns true when drawElementImage and WebGL are both available", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            setAttribute: () => undefined,
            layoutSubtree: true,
            getContext: (type: string) => {
              if (type === "2d") return { drawElementImage: () => undefined };
              if (type === "webgl")
                return { getExtension: () => ({ loseContext: () => undefined }) };
              return null;
            },
          };
        }
        return {};
      },
    });
    expect(isPageSideCompositingSupported()).toBe(true);
  });

  it("returns false when drawElementImage is missing", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        getContext: (type: string) =>
          type === "webgl" ? { getExtension: () => ({ loseContext: () => undefined }) } : {},
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns false when WebGL is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: (type: string) =>
          type === "2d" ? { drawElementImage: () => undefined } : null,
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(false);
  });
});

describe("page-side compositor exported constants", () => {
  it("exports a stable canary string used by the bundled-CLI smoke", () => {
    expect(PAGE_COMPOSITOR_BUILD_CANARY).toBe("__hf_page_compositor_v1__");
  });

  it("exports a stable canvas id", () => {
    expect(PAGE_COMPOSITOR_CANVAS_ID).toBe("__hf-page-side-compositor");
  });
});
