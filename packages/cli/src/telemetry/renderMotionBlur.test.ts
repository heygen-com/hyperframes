import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageMotionBlurSummary } from "@hyperframes/engine";

const trackEvent = vi.fn();
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  flush: () => Promise.resolve(),
  shouldTrack: () => true,
}));
vi.mock("./system.js", async () => ({
  ...(await vi.importActual<typeof import("./system.js")>("./system.js")),
  getPowerState: () => ({ on_battery: false, low_power_mode: false }),
}));

const { trackRenderComplete } = await import("./events.js");
const { renderMotionBlurEventProperties, renderMotionBlurTelemetryPayload } =
  await import("./renderMotionBlur.js");

const fingerprint = (over: Partial<NonNullable<PageMotionBlurSummary["fingerprint"]>>) => ({
  canvas2d: 0,
  webgl: 0,
  video: 0,
  iframe: 0,
  customElement: 0,
  svgClip: 0,
  mask: 0,
  scrollContainer: 0,
  threeD: 0,
  overflowingMover: 0,
  frontOfMover: 0,
  blendMode: 0,
  fixedInMover: 0,
  pseudoOutside: 0,
  ...over,
});

const blur = (over: Partial<PageMotionBlurSummary> = {}): PageMotionBlurSummary => ({
  tier: "filter",
  reasonCode: "accelerated-canvas",
  movers: 4,
  failedFrames: 0,
  readEvents: false,
  fingerprint: fingerprint({}),
  ...over,
});

const complete = (motionBlur: PageMotionBlurSummary | undefined) => {
  trackRenderComplete({
    durationMs: 1,
    fps: 30,
    quality: "draft",
    docker: false,
    gpu: false,
    ...renderMotionBlurTelemetryPayload(motionBlur),
  });
  return trackEvent.mock.calls[0]?.[1] as Record<string, unknown>;
};

describe("render_complete motion blur properties", () => {
  beforeEach(() => trackEvent.mockClear());

  it("sends the tier, movers, failed frames and one property per non-zero count", () => {
    const props = complete(
      blur({
        failedFrames: 7,
        fingerprint: fingerprint({ webgl: 1, overflowingMover: 3, canvas2d: 2 }),
      }),
    );
    expect(props).toMatchObject({
      motion_blur_tier: "filter",
      motion_blur_movers: 4,
      motion_blur_failed_frames: 7,
      motion_blur_fp_canvas2d: 2,
      motion_blur_fp_webgl: 1,
      motion_blur_fp_overflowing_mover: 3,
    });
    const keys = Object.keys(props).filter((k) => k.startsWith("motion_blur_"));
    expect(keys.sort()).toEqual([
      "motion_blur_failed_frames",
      "motion_blur_fp_canvas2d",
      "motion_blur_fp_overflowing_mover",
      "motion_blur_fp_webgl",
      "motion_blur_movers",
      "motion_blur_tier",
    ]);
  });

  it("sends nothing when blur was never on", () => {
    const sent = Object.entries(complete(undefined)).filter(
      ([key, value]) => key.startsWith("motion_blur_") && value !== undefined,
    );
    expect(sent).toEqual([]);
  });

  it("sends failed frames for a blur that ended before it named a tier, and no zero counts", () => {
    const props = renderMotionBlurEventProperties(
      renderMotionBlurTelemetryPayload(blur({ tier: null, failedFrames: 5, fingerprint: null })),
    );
    expect(props).toEqual({
      motion_blur_tier: undefined,
      motion_blur_movers: 4,
      motion_blur_failed_frames: 5,
    });
  });

  it("names every count the runtime can report, in snake case", () => {
    const all = Object.fromEntries(
      Object.keys(fingerprint({})).map((field) => [field, 1]),
    ) as ReturnType<typeof fingerprint>;
    const props = renderMotionBlurEventProperties({ motionBlurFingerprint: all });
    expect(Object.keys(props).filter((k) => k.startsWith("motion_blur_fp_"))).toEqual([
      "motion_blur_fp_canvas2d",
      "motion_blur_fp_webgl",
      "motion_blur_fp_video",
      "motion_blur_fp_iframe",
      "motion_blur_fp_custom_element",
      "motion_blur_fp_svg_clip",
      "motion_blur_fp_mask",
      "motion_blur_fp_scroll_container",
      "motion_blur_fp_three_d",
      "motion_blur_fp_overflowing_mover",
      "motion_blur_fp_front_of_mover",
      "motion_blur_fp_blend_mode",
      "motion_blur_fp_fixed_in_mover",
      "motion_blur_fp_pseudo_outside",
    ]);
  });
});
