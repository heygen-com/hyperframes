import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_DEVICE_SCALE_GLOBAL,
  PAGE_MOTION_BLUR_OFF_GLOBAL,
  acceleratedCanvasTrackerSource,
} from "@hyperframes/core";
import {
  describePageMotionBlur,
  describePageMotionBlurAtEnd,
  installPageMotionBlur,
} from "./pageMotionBlur";
import { closeCaptureSession } from "./frameCapture";

const fakePage = () => ({ evaluateOnNewDocument: vi.fn(async () => ({ identifier: "1" })) });

describe("installPageMotionBlur", () => {
  it("tells the page to stand down when the engine blurs", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { motionBlur: { samplesPerFrame: 16 } });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(2);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "engine-motion-blur",
    );
  });

  it("turns the page off when the Studio preview could not blur", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { pageMotionBlur: "off" });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_MOTION_BLUR_OFF_GLOBAL,
      "preview-unsupported",
    );
  });

  it("says why when the render route cannot host the blur", async () => {
    for (const route of ["hdr-render", "layered-composite", "distributed-render"] as const) {
      const page = fakePage();
      await installPageMotionBlur(page, { pageMotionBlur: route });
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.any(Function),
        PAGE_MOTION_BLUR_OFF_GLOBAL,
        route,
      );
    }
  });

  it("tells the page the render's device scale when it is not 1", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, { deviceScaleFactor: 2 });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.any(Function),
      PAGE_DEVICE_SCALE_GLOBAL,
      2,
    );
  });

  it("installs the canvas tracker before any page script, and nothing else by default", async () => {
    const page = fakePage();
    await installPageMotionBlur(page, {});
    expect(page.evaluateOnNewDocument.mock.calls).toEqual([[acceleratedCanvasTrackerSource()]]);
  });
});

describe("describePageMotionBlur", () => {
  afterEach(() => vi.unstubAllGlobals());
  // Runs the page-side function in this process, with `window` standing in for the page.
  const inPage = { evaluate: async (fn: () => unknown) => fn() } as never;

  it("summarises the runtime's report in one line", async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: { report: () => ({ state: "off", reasonCode: "renderer-off", movers: 0 }) },
    });
    expect(await describePageMotionBlur(inPage)).toBe(
      "[motion-blur] off reasonCode=renderer-off movers=0 failedFrames=0",
    );
  });

  it("reports a running blur with its movers", async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: { report: () => ({ state: "on", reasonCode: null, movers: 24 }) },
    });
    expect(await describePageMotionBlur(inPage)).toBe(
      "[motion-blur] on reasonCode=null movers=24 failedFrames=0",
    );
  });

  it("names the tier that drew the blur, so a fallback is visible in the log", async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: {
        report: () => ({
          state: "on",
          tier: "filter",
          reasonCode: "accelerated-canvas",
          movers: 2,
        }),
      },
    });
    expect(await describePageMotionBlur(inPage)).toBe(
      "[motion-blur] on reasonCode=accelerated-canvas movers=2 failedFrames=0 tier=filter",
    );
  });

  it('carries the frames that fell back to plain DOM, so "on" cannot hide them', async () => {
    vi.stubGlobal("window", {
      __hfMotionBlur: {
        report: () => ({ state: "on", reasonCode: null, movers: 3, failures: 0, failedFrames: 17 }),
      },
    });
    expect(await describePageMotionBlur(inPage)).toBe(
      "[motion-blur] on reasonCode=null movers=3 failedFrames=17",
    );
  });

  it("says nothing when the page never asked for blur", async () => {
    vi.stubGlobal("window", {});
    expect(await describePageMotionBlur(inPage)).toBeNull();
  });
});

describe("describePageMotionBlurAtEnd", () => {
  afterEach(() => vi.unstubAllGlobals());
  const inPage = { evaluate: async (fn: () => unknown) => fn() } as never;
  const report = (over: Record<string, unknown>) =>
    vi.stubGlobal("window", {
      __hfMotionBlur: {
        report: () => ({ state: "on", reasonCode: null, movers: 2, failedFrames: 0, ...over }),
      },
    });

  it("stays quiet for a session that blurred every frame, or never could", async () => {
    report({});
    expect(await describePageMotionBlurAtEnd(inPage)).toBeNull();
    report({ state: "off", reasonCode: "engine-motion-blur", movers: 0 });
    expect(await describePageMotionBlurAtEnd(inPage)).toBeNull();
  });

  it("says so when frames fell back to plain DOM, even though blur is still on", async () => {
    report({ failedFrames: 4 });
    expect(await describePageMotionBlurAtEnd(inPage)).toBe(
      "[motion-blur] on reasonCode=null movers=2 failedFrames=4 (session end)",
    );
  });

  it("says so when the failures ended blur", async () => {
    report({ state: "off", reasonCode: "capture-failures", failedFrames: 3 });
    expect(await describePageMotionBlurAtEnd(inPage)).toBe(
      "[motion-blur] off reasonCode=capture-failures movers=2 failedFrames=3 (session end)",
    );
  });

  it("gives up on a page that does not answer, or is gone", async () => {
    const stuck = { evaluate: () => new Promise(() => {}) } as never;
    expect(await describePageMotionBlurAtEnd(stuck, 10)).toBeNull();
    const gone = { evaluate: async () => Promise.reject(new Error("closed")) } as never;
    expect(await describePageMotionBlurAtEnd(gone)).toBeNull();
  });
});

describe("closeCaptureSession", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the blur's closing line once, before the page closes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const order: string[] = [];
    vi.stubGlobal("window", {
      __hfMotionBlur: {
        report: () => ({ state: "on", reasonCode: null, movers: 1, failedFrames: 2 }),
      },
    });
    const session = {
      page: {
        evaluate: async (fn: () => unknown) => {
          order.push("read");
          return fn();
        },
        close: async () => order.push("close"),
      },
      pageReleased: false,
      browserReleased: true,
      staticDedupCount: 0,
    };
    await closeCaptureSession(session as never);
    await closeCaptureSession(session as never);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      "[motion-blur] on reasonCode=null movers=1 failedFrames=2 (session end)",
    ]);
    expect(order).toEqual(["read", "close"]);
    expect(stdout).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
