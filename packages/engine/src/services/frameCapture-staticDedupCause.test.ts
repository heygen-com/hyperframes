import { describe, expect, it } from "vitest";
import { armStaticDedup, type CaptureSession } from "./frameCapture.js";

/** A page whose timeline walk reports `analysis`, over a 4 s film unless overridden. */
function sessionFor(analysis: Record<string, unknown>): CaptureSession {
  const page = {
    evaluate: async (fn: unknown) => {
      const source = String(fn);
      if (source.includes("getChildren")) {
        return {
          intervals: [{ start: 0, end: 1, spatial: true }],
          tweenCount: 1,
          duration: 4,
          hasVideo: false,
          hasCanvas: false,
          hasFrameSources: false,
          hasIframe: false,
          hasNonGsapAnim: false,
          hasUnresolvableClipStart: false,
          hasTimelineCall: false,
          ...analysis,
        };
      }
      if (source.includes("__hf_page_composite_prepare")) return false;
      return [];
    },
  };
  return {
    captureMode: "screenshot",
    options: { fps: { num: 30, den: 1 } },
    config: {},
    page,
  } as unknown as CaptureSession;
}

describe("why a page is ineligible for still-frame reuse", () => {
  it("names every cause the page analysis found", async () => {
    const session = sessionFor({ hasCanvas: true, tweenCount: 0, intervals: [] });
    await armStaticDedup(session, session.page, () => {});
    expect(session.staticDedupSkipReason).toBe("ineligible");
    expect(session.staticDedupIneligibleCause).toBe("canvas+no_gsap_tweens");
  });

  it("tells a page that always moves apart from a disqualified one", async () => {
    const session = sessionFor({ intervals: [{ start: 0, end: 4, spatial: true }] });
    await armStaticDedup(session, session.page, () => {});
    expect(session.staticDedupSkipReason).toBe("ineligible");
    expect(session.staticDedupIneligibleCause).toBe("no_static_frames");
  });
});
