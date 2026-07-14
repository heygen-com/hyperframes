import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clonePinStyleFor,
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

describe("clonePinStyleFor", () => {
  it("fixes a 0x0 inset:0 scene root to its live-measured box (the collapse this exists to prevent)", () => {
    // A scene root sized only by `position:absolute; inset:0` measures as
    // the full composition frame in the live document (its containing block
    // there is the real ancestor chain) — collapses to 0x0 only once cloned
    // into the staging canvas's own layout subtree.
    const pin = clonePinStyleFor({ left: 0, top: 0, width: 1080, height: 1920 });
    expect(pin).toEqual({ left: "0px", top: "0px", width: "1080px", height: "1920px" });
  });

  it("preserves an authored explicit width/height and offset instead of overriding it", () => {
    // A scene root with its own explicit size/position (e.g. a picture-in-
    // picture panel) measures as that exact box in the live document —
    // clonePinStyleFor must reproduce it verbatim, not the full composition
    // frame, or the clone would silently grow to fill the canvas.
    const pin = clonePinStyleFor({ left: 120, top: 240, width: 400, height: 300 });
    expect(pin).toEqual({ left: "120px", top: "240px", width: "400px", height: "300px" });
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
