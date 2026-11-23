import { describe, expect, it } from "vitest";
import { shouldUseLayeredComposite } from "../hdrCompositor.js";
import { createCapturePlan } from "./capturePlan.js";
import { assertOutputScaleSupported } from "./outputScaleRoute.js";
import { outputSupportsPageSideShaderCompositing } from "./renderFormat.js";
import { resolveDeviceScaleFactor } from "./shared.js";

describe("assertOutputScaleSupported", () => {
  it("refuses a scaled output on the layered route, larger or smaller", () => {
    for (const scale of [2, 1280 / 1920, 854 / 1920])
      expect(() => assertOutputScaleSupported(scale, "hdr_layered")).toThrow(/hdr_layered/);
  });

  it("names the ways out that apply: --sdr for HDR footage, mp4 for shader transitions", () => {
    expect(() => assertOutputScaleSupported(2, "hdr_layered")).toThrow(/add --sdr/);
    expect(() => assertOutputScaleSupported(2, "hdr_layered")).toThrow(/render as mp4/);
    expect(() => assertOutputScaleSupported(2, "hdr_layered")).not.toThrow(/page-side compositing/);
  });

  it("lets every route run at the composition's size, and the screenshot routes scale", () => {
    for (const route of ["sdr_streaming", "sdr_disk", "sdr_segmented", "hdr_layered"] as const)
      expect(() => assertOutputScaleSupported(1, route)).not.toThrow();
    for (const route of ["sdr_streaming", "sdr_disk", "sdr_segmented"] as const)
      expect(() => assertOutputScaleSupported(854 / 1920, route)).not.toThrow();
  });

  it("refuses 1080p from a 4K composition with shader transitions as mov, through the real route choice", () => {
    const pageSide = outputSupportsPageSideShaderCompositing("mov");
    const layered =
      !pageSide &&
      shouldUseLayeredComposite({
        hasHdrContent: false,
        hasShaderTransitions: true,
        isPngSequence: false,
      });
    const plan = createCapturePlan({
      workerCount: 1,
      forceScreenshot: false,
      useStreamingEncode: false,
      useLayeredComposite: layered,
      usePageSideCompositing: pageSide,
      hasHdrContent: false,
      needsAlpha: false,
    });
    const scale = resolveDeviceScaleFactor({
      compositionWidth: 3840,
      compositionHeight: 2160,
      outputResolution: "landscape",
      hdrRequested: false,
      alphaRequested: false,
    });
    expect(plan.kind).toBe("hdr_layered");
    expect(scale).toBe(0.5);
    expect(() => assertOutputScaleSupported(scale, plan.kind)).toThrow(/hdr_layered/);
  });
});
