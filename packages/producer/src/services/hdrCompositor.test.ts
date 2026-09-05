import { describe, expect, it } from "vitest";
import type { ElementStackingInfo } from "@hyperframes/engine";
import { isHdrLayerBlittable, selectDomLayerShowIds } from "./hdrCompositor.js";

function makeEl(id: string, overrides?: Partial<ElementStackingInfo>): ElementStackingInfo {
  return {
    id,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    layoutWidth: 1920,
    layoutHeight: 1080,
    opacity: 1,
    visible: true,
    renderFrameVisible: false,
    isHdr: false,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "fill",
    objectPosition: "50% 50%",
    clipRect: null,
    ...overrides,
  };
}

describe("isHdrLayerBlittable", () => {
  it("skips HDR video elements outside their sub-composition window", () => {
    // Native videos are hidden during capture (visible=false), so
    // renderFrameVisible tracks the replacement <img>'s paintability.
    // When the scene's time window has ended, both are false.
    expect(isHdrLayerBlittable(makeEl("v1", { visible: false, renderFrameVisible: false }))).toBe(
      false,
    );
  });

  it("keeps HDR video elements within their sub-composition window", () => {
    // During capture the video itself is hidden, but the replacement frame is visible.
    expect(isHdrLayerBlittable(makeEl("v1", { visible: false, renderFrameVisible: true }))).toBe(
      true,
    );
  });

  it("keeps visible HDR image elements", () => {
    // Images are not hidden by the frame injector — visible tracks the time window.
    expect(isHdrLayerBlittable(makeEl("img1", { visible: true, renderFrameVisible: false }))).toBe(
      true,
    );
  });

  it("skips HDR image elements outside their time window", () => {
    expect(isHdrLayerBlittable(makeEl("img1", { visible: false, renderFrameVisible: false }))).toBe(
      false,
    );
  });

  it("skips zero-opacity elements regardless of visibility", () => {
    expect(isHdrLayerBlittable(makeEl("v1", { opacity: 0, renderFrameVisible: true }))).toBe(false);
  });
});

describe("selectDomLayerShowIds", () => {
  it("does not re-show hidden DOM elements while preserving visible injected video frames", () => {
    expect(
      selectDomLayerShowIds(
        ["visible-overlay", "hidden-later-scene", "hidden-sdr-video"],
        [
          makeEl("visible-overlay"),
          makeEl("hidden-later-scene", { visible: false }),
          makeEl("hidden-sdr-video", {
            visible: false,
            renderFrameVisible: true,
          }),
        ],
      ),
    ).toEqual(["visible-overlay", "hidden-sdr-video"]);
  });

  it("does not re-show opacity-zero scene members or their injected frames", () => {
    expect(
      selectDomLayerShowIds(
        ["active-overlay", "inactive-scene-video", "inactive-scene-label"],
        [
          makeEl("active-overlay"),
          makeEl("inactive-scene-video", {
            opacity: 0,
            visible: false,
            renderFrameVisible: true,
          }),
          makeEl("inactive-scene-label", {
            opacity: 0,
            visible: true,
          }),
        ],
      ),
    ).toEqual(["active-overlay"]);
  });
});
