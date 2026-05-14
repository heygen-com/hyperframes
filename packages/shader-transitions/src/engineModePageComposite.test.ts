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

  it("returns true when drawElementImage is exposed", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: () => ({ drawElementImage: () => undefined }),
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(true);
  });

  it("returns false when drawElementImage is missing", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: () => ({}),
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(false);
  });
});

describe("page-side compositor exported constants", () => {
  // These constants are load-bearing for the bundled-CLI smoke: the
  // validation script greps the shipped bundle for the canary to confirm
  // the page-side path is in the production tsup output, not just the
  // source tree.
  it("exports a stable canary string used by the bundled-CLI smoke", () => {
    expect(PAGE_COMPOSITOR_BUILD_CANARY).toBe("__hf_page_compositor_v1__");
  });

  it("exports a stable canvas id", () => {
    expect(PAGE_COMPOSITOR_CANVAS_ID).toBe("__hf-page-side-compositor");
  });
});
