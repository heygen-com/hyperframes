import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureFrame,
  captureFrameToBuffer,
  computeStaticFrameSet,
  resolveSessionMotionBlur,
  type CaptureSession,
} from "./frameCapture.js";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveMotionBlurPlan } from "./motionBlur.js";
import { decodePng, encodePng } from "../utils/alphaBlit.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshotService.js")>()),
  pageScreenshotCapture: vi.fn(),
}));

/**
 * The accumulation pass drives the real page-side seek callback, so the fake page runs
 * each `page.evaluate` argument against a stubbed `window` / `document` instead of
 * recording that a call happened. What lands in `seeks` is therefore what a browser's
 * `window.__hf.seek` would have received.
 */
interface RecordedSeek {
  time: number;
  suppressEvents?: boolean;
  subFrameDivisions?: number;
}

function installPageGlobals(seeks: RecordedSeek[]): void {
  const root = globalThis as Record<string, unknown>;
  root.window = {
    __hf: {
      seek: (time: number, options?: { suppressEvents?: boolean; subFrameDivisions?: number }) => {
        seeks.push({ time, ...options });
      },
    },
  };
  root.document = { querySelectorAll: () => [] };
}

const WIDTH = 2;
const HEIGHT = 1;

function solidPng(value: number): Buffer {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = value;
    rgba[i + 1] = value;
    rgba[i + 2] = value;
    rgba[i + 3] = 255;
  }
  return encodePng(WIDTH, HEIGHT, rgba);
}

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    page: {
      evaluate: async (fn: unknown, ...args: unknown[]) =>
        typeof fn === "function" ? (fn as (...a: unknown[]) => unknown)(...args) : undefined,
    },
    options: { fps: { num: 30, den: 1 }, format: "png", width: WIDTH, height: HEIGHT },
    captureMode: "screenshot",
    isInitialized: true,
    onBeforeCapture: null,
    capturePerf: {
      frames: 0,
      seekMs: 0,
      beforeCaptureMs: 0,
      screenshotMs: 0,
      totalMs: 0,
      frameMs: [],
    },
    // Fixed K=16 by default so the tests in this file that predate adaptive sampling
    // (accumulation, event suppression, dedup composition) keep testing exactly what
    // they did before — adaptive selection gets its own describe block below.
    motionBlur: resolveMotionBlurPlan({ samplesPerFrame: 16 }) ?? undefined,
    ...overrides,
  } as unknown as CaptureSession;
}

let seeks: RecordedSeek[];

beforeEach(() => {
  seeks = [];
  installPageGlobals(seeks);
  // Sample n is captured as the flat grey 16n, so the average over the default 16
  // samples is the mean of 0, 16, ... 240, which is 120.
  let sample = 0;
  vi.mocked(pageScreenshotCapture).mockImplementation(async () => solidPng(16 * sample++));
});

afterEach(() => {
  vi.mocked(pageScreenshotCapture).mockReset();
  const root = globalThis as Record<string, unknown>;
  delete root.window;
  delete root.document;
});

describe("sub-frame accumulation reaches the page with distinct sample times", () => {
  it("seeks 16 distinct sub-frame times, all on the finer grid", async () => {
    await captureFrameToBuffer(makeSession(), 10, 10 / 30);

    const samples = seeks.filter((s) => s.subFrameDivisions !== undefined);
    expect(samples).toHaveLength(16);
    expect(new Set(samples.map((s) => s.time)).size).toBe(16);
    expect(samples.every((s) => s.subFrameDivisions === 4096)).toBe(true);
    // Frame 10 at 30fps is tick 40960; the window spans 960 ticks either side.
    expect(samples[0]?.time).toBe(40000 / 122880);
    expect(samples[15]?.time).toBe(41920 / 122880);
  });

  it("fires exactly one eventful seek per frame, at the frame time", async () => {
    await captureFrameToBuffer(makeSession(), 10, 10 / 30);

    const eventful = seeks.filter((s) => s.suppressEvents !== true);
    expect(eventful).toHaveLength(1);
    expect(eventful[0]?.time).toBe(10 / 30);
    // It comes first, so a composition's own callbacks fire on the same interval they
    // would with motion blur off, before the playhead moves inside the shutter window.
    expect(seeks[0]).toBe(eventful[0]);
  });

  it("restores the playhead to the frame time so the next frame's callbacks are not skipped", async () => {
    await captureFrameToBuffer(makeSession(), 10, 10 / 30);

    const last = seeks[seeks.length - 1];
    expect(last?.time).toBe(10 / 30);
    expect(last?.suppressEvents).toBe(true);
    expect(seeks).toHaveLength(18);
  });

  it("captures K distinct samples rather than K copies of one instant", async () => {
    // Guards the failure mode where every sub-frame seek lands on the same time: the
    // average of K identical frames is the unblurred frame, which looks like the feature
    // doing nothing rather than like an error.
    const captured: string[] = [];
    vi.mocked(pageScreenshotCapture).mockImplementation(async () => {
      const png = solidPng(16 * captured.length);
      captured.push(png.toString("base64"));
      return png;
    });

    await captureFrameToBuffer(makeSession(), 10, 10 / 30);

    expect(captured).toHaveLength(16);
    expect(new Set(captured).size).toBe(16);
  });

  it("averages the captured samples into the output frame", async () => {
    const result = await captureFrameToBuffer(makeSession(), 10, 10 / 30);

    const decoded = decodePng(result.buffer);
    expect(decoded.width).toBe(WIDTH);
    expect([...decoded.data.slice(0, 4)]).toEqual([120, 120, 120, 255]);
  });

  it("reports the frame time, not the last sample time", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "hf-motion-blur-"));
    const result = await captureFrame(makeSession({ outputDir }), 10, 10 / 30);

    expect(result.time).toBe(10 / 30);
    expect(result.path).toBe(join(outputDir, "frame_000010.png"));
  });

  it("captures once per frame with motion blur off", async () => {
    await captureFrameToBuffer(makeSession({ motionBlur: undefined }), 10, 10 / 30);

    expect(vi.mocked(pageScreenshotCapture)).toHaveBeenCalledTimes(1);
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toEqual({ time: 10 / 30 });
  });
});

describe("accumulation composes with static-frame dedup", () => {
  // 720 degrees is the widest shutter After Effects offers, and the AD5 reference export
  // uses it, so it is the case a reader is most likely to check the frame ranges against.
  // Fixed K=16, same reason as makeSession's default above.
  const wideShutter =
    resolveMotionBlurPlan({ shutterAngle: 720, shutterPhase: -360, samplesPerFrame: 16 }) ??
    undefined;

  /** Reuse claims frame 11's blurred output equals frame 10's, so the whole window
   * either side of it must be static for that claim to be true. */
  async function expectFrame11Reused(overrides: Partial<CaptureSession>) {
    const anchor = solidPng(42);
    const session = makeSession({
      staticFrames: new Set([9, 10, 11, 12]),
      lastFrameBuffer: anchor,
      lastFrameAbsoluteIndex: 10,
      ...overrides,
    });
    const result = await captureFrameToBuffer(session, 11, 11 / 30);
    expect(result.buffer).toBe(anchor);
    expect(vi.mocked(pageScreenshotCapture)).not.toHaveBeenCalled();
    return session;
  }

  it("pays nothing on a static frame instead of capturing K samples of the same instant", async () => {
    const session = await expectFrame11Reused({});

    expect(seeks).toHaveLength(0);
    expect(session.staticDedupCount).toBe(1);
  });

  it("pays K captures on a moving frame", async () => {
    const session = makeSession({
      staticFrames: new Set([11]),
      lastFrameBuffer: solidPng(42),
      lastFrameAbsoluteIndex: 10,
    });

    await captureFrameToBuffer(session, 12, 12 / 30);

    expect(vi.mocked(pageScreenshotCapture)).toHaveBeenCalledTimes(16);
  });

  // The defect this locks: dedup asked only whether THIS frame matched its predecessor.
  // The shutter window reads either side of the frame instant, so a still frame sitting
  // next to a moving one reused a buffer that carries none of that motion. Frame 11 is
  // static and 12 is not, and at a 720 degree shutter frame 11's window runs to 11.94, so
  // it reaches motion the reused buffer cannot contain. Guard from #4013 by Dante-dan.
  it("captures rather than reuses when the shutter window reaches a moving frame", async () => {
    const session = makeSession({
      motionBlur: wideShutter,
      staticFrames: new Set([9, 10, 11]),
      lastFrameBuffer: solidPng(42),
      lastFrameAbsoluteIndex: 10,
    });

    await captureFrameToBuffer(session, 11, 11 / 30);

    expect(vi.mocked(pageScreenshotCapture)).toHaveBeenCalledTimes(16);
    expect(session.staticDedupCount).toBeUndefined();
  });

  it("still reuses at 720 degrees when the whole window is static", async () => {
    await expectFrame11Reused({ motionBlur: wideShutter });
  });
});

describe("every path that marks a session ready also resolves the plan", () => {
  // The defect this locks: `initializeSession` has two exits, and screenshot mode (the only
  // mode motion blur supports) returns from the first one. Resolving the plan at the other
  // exit left `session.motionBlur` undefined on exactly the path the feature runs on, so a
  // real render captured one frame per output frame and produced no blur at all, while the
  // plan, the producer wiring and every unit test stayed correct.
  const source = readFileSync(new URL("./frameCapture.ts", import.meta.url), "utf8");

  it("assigns isInitialized in exactly one place", () => {
    const assignments = source.match(/session\.isInitialized = true/g) ?? [];
    expect(assignments).toHaveLength(1);
  });

  it("resolves the motion-blur plan in that same place", () => {
    const start = source.indexOf("function finalizeSessionInit");
    const finalize = source.slice(start, start + 400);
    expect(finalize).toContain("resolveSessionMotionBlur");
    expect(finalize).toContain("session.isInitialized = true");
  });
});

describe("resolveSessionMotionBlur rejects what accumulation cannot render", () => {
  const withOptions = (overrides: Partial<CaptureSession>): CaptureSession =>
    makeSession({
      options: {
        fps: { num: 30, den: 1 },
        format: "png",
        width: WIDTH,
        height: HEIGHT,
        motionBlur: {},
      },
      ...overrides,
    } as Partial<CaptureSession>);

  it("is off when the composition did not ask for it", () => {
    expect(resolveSessionMotionBlur(makeSession())).toBeUndefined();
  });

  it("resolves a plan for a screenshot-mode PNG session", () => {
    const plan = resolveSessionMotionBlur(withOptions({}));
    expect(plan).not.toBeUndefined();
    // `options.motionBlur: {}` sets no explicit samplesPerFrame, so the plan is adaptive.
    expect(plan?.fixedSamplesPerFrame).toBeNull();
  });

  it("rejects a capture mode whose sampling is not implemented yet", () => {
    expect(() => resolveSessionMotionBlur(withOptions({ captureMode: "beginframe" }))).toThrow(
      /screenshot capture mode/,
    );
  });

  it("rejects a lossy output format", () => {
    const session = withOptions({});
    session.options.format = "jpeg";
    expect(() => resolveSessionMotionBlur(session)).toThrow(/format "png"/);
  });

  it("rejects injected video frames, which cannot follow a sub-frame seek", () => {
    expect(() =>
      resolveSessionMotionBlur(withOptions({ onBeforeCapture: async () => {} })),
    ).toThrow(/video/);
  });
});

describe("adaptive sample count (issue #4029)", () => {
  // No explicit samplesPerFrame → adaptive.
  const adaptivePlan = resolveMotionBlurPlan({}) ?? undefined;

  it("probes the true window edges, escalates K on a large diff, and never lets a probe into the average", async () => {
    // First two screenshots are the probes (0, 255 — a large diff); everything after is
    // a constant 100, so if a probe leaked into the accumulator the average would move.
    let call = 0;
    vi.mocked(pageScreenshotCapture).mockImplementation(async () =>
      solidPng(call++ < 2 ? [0, 255][call - 1] : 100),
    );

    const result = await captureFrameToBuffer(
      makeSession({ motionBlur: adaptivePlan }),
      10,
      10 / 30,
    );

    // A 0/255 probe diff is well past the top step, so K=64.
    expect(vi.mocked(pageScreenshotCapture)).toHaveBeenCalledTimes(2 + 64);
    expect([...decodePng(result.buffer).data.slice(0, 4)]).toEqual([100, 100, 100, 255]);
    // seeks[0] is the one eventful seek; the two probe seeks come right after it, both
    // suppressed, and distinct from each other (the true window edges, not one point).
    const [probeA, probeB] = seeks.slice(1, 3);
    expect(probeA?.suppressEvents).toBe(true);
    expect(probeB?.suppressEvents).toBe(true);
    expect(probeA?.time).not.toBe(probeB?.time);
  });

  it("skips the probe and uses the floor for a frame confirmed non-spatial", async () => {
    let calls = 0;
    vi.mocked(pageScreenshotCapture).mockImplementation(async () => {
      calls++;
      return solidPng(50);
    });

    await captureFrameToBuffer(
      makeSession({ motionBlur: adaptivePlan, motionBlurNonSpatialFrames: new Set([10]) }),
      10,
      10 / 30,
    );

    expect(calls).toBe(16); // floor only, no probe pair
  });

  it("probes (rather than assuming the floor) for a frame outside the confirmed non-spatial set", async () => {
    let calls = 0;
    vi.mocked(pageScreenshotCapture).mockImplementation(async () => {
      calls++;
      return solidPng(50); // identical probes -> zero diff -> floor, but via the probe path
    });

    await captureFrameToBuffer(
      makeSession({ motionBlur: adaptivePlan, motionBlurNonSpatialFrames: new Set([999]) }),
      10,
      10 / 30,
    );

    expect(calls).toBe(2 + 16); // probed, diff was zero, landed on the floor anyway
  });
});

describe("computeStaticFrameSet classifies spatial vs non-spatial intervals", () => {
  function makePage(intervals: Array<{ start: number; end: number; spatial: boolean }>) {
    return {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          intervals,
          tweenCount: intervals.length,
          duration: 10,
          hasVideo: false,
          hasCanvas: false,
          hasNonGsapAnim: false,
          hasUnresolvableClipStart: false,
          hasTimelineCall: false,
        })
        .mockResolvedValueOnce([]), // computeClipBoundaryFrames' own [data-start] scan
    } as unknown as Parameters<typeof computeStaticFrameSet>[0];
  }

  it("marks a frame touched only by a non-spatial interval (e.g. opacity) as safe to skip the probe", async () => {
    const page = makePage([{ start: 0, end: 1, spatial: false }]);

    const result = await computeStaticFrameSet(page, 30);

    expect(result.eligible).toBe(true);
    expect(result.nonSpatialOnlyFrameSet.has(0)).toBe(true);
  });

  it("does not mark a frame touched by any spatial interval (e.g. x), even alongside a non-spatial one", async () => {
    const page = makePage([
      { start: 0, end: 1, spatial: false },
      { start: 0, end: 1, spatial: true },
    ]);

    const result = await computeStaticFrameSet(page, 30);

    expect(result.nonSpatialOnlyFrameSet.has(0)).toBe(false);
  });

  it("reports an empty set when the analysis is ineligible, never a false 'confirmed non-spatial'", async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          intervals: [{ start: 0, end: 1, spatial: false }],
          tweenCount: 0, // no GSAP tweens -> ineligible, per the existing "reasons" gate
          duration: 10,
          hasVideo: false,
          hasCanvas: false,
          hasNonGsapAnim: false,
          hasUnresolvableClipStart: false,
          hasTimelineCall: false,
        })
        .mockResolvedValueOnce([]), // computeClipBoundaryFrames' own [data-start] scan
    } as unknown as Parameters<typeof computeStaticFrameSet>[0];

    const result = await computeStaticFrameSet(page, 30);

    expect(result.eligible).toBe(false);
    expect(result.nonSpatialOnlyFrameSet.size).toBe(0);
  });
});

describe("armStaticDedup reads the raw caller options for the adaptive gate, not the resolved plan", () => {
  // armStaticDedup always runs before finalizeSessionInit sets session.motionBlur, so a
  // gate reading that field is always false; it must read session.options.motionBlur.
  const source = readFileSync(new URL("./frameCapture.ts", import.meta.url), "utf8");

  it("gates the adaptive classification block on session.options.motionBlur", () => {
    // Anchored on the `let` declaration, AFTER the explanatory comment above it, so this
    // reads only the functional `if (...)` condition — not prose that could name either
    // symbol without the code actually using it.
    const start = source.indexOf("let sharedStaticFrameStats");
    if (start < 0) throw new Error("sharedStaticFrameStats declaration not found");
    const conditionEnd = source.indexOf(") {", start);
    const condition = source.slice(start, conditionEnd);
    expect(condition).toContain("session.options.motionBlur");
    // Bare "session.motionBlur" (the resolved plan) not followed by a letter, so this
    // does not false-positive on the unrelated "session.motionBlurNonSpatialFrames".
    expect(condition).not.toMatch(/session\.motionBlur(?![A-Za-z])/);
  });

  it("every armStaticDedup call site runs before finalizeSessionInit in the same init path", () => {
    // Confirms the premise: if a future refactor made these coincide, the raw-options
    // gate above would still be correct (session.options.motionBlur is set unconditionally
    // at session creation), but this pins today's actual ordering as documented context.
    const finalizeCalls = [...source.matchAll(/finalizeSessionInit\(session\)/g)].map(
      (m) => m.index as number,
    );
    const armCalls = [...source.matchAll(/armStaticDedup\(session,/g)].map(
      (m) => m.index as number,
    );
    expect(finalizeCalls.length).toBeGreaterThan(0);
    for (const finalizeAt of finalizeCalls) {
      const precedingArm = armCalls.filter((a) => a < finalizeAt).at(-1);
      expect(precedingArm).toBeDefined();
    }
  });
});

describe("computeStaticFrameSet's real page-side property matching (not a canned mock)", () => {
  // Runs the ACTUAL closure passed to page.evaluate, against a stubbed window/document —
  // the other computeStaticFrameSet tests above mock the whole result and never exercise
  // isSpatial()/SPATIAL_PROPS at all, which is how xPercent/yPercent went unclassified.
  function makeTimeline(vars: Record<string, unknown>) {
    const child = { startTime: () => 0, duration: () => 1, totalDuration: () => 1, vars };
    return { getChildren: () => [child], duration: () => 1 };
  }

  function makePage(timelines: Record<string, unknown>) {
    const root = globalThis as Record<string, unknown>;
    root.window = { __timelines: timelines, __hf: { duration: 1 } };
    root.document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      getAnimations: undefined,
    };
    return {
      evaluate: async (fn: unknown, ...args: unknown[]) =>
        typeof fn === "function" ? (fn as (...a: unknown[]) => unknown)(...args) : undefined,
    } as unknown as Parameters<typeof computeStaticFrameSet>[0];
  }

  afterEach(() => {
    const root = globalThis as Record<string, unknown>;
    delete root.window;
    delete root.document;
  });

  it.each(["xPercent", "yPercent", "perspective", "transformPerspective", "rotate"])(
    "classifies a tween on %s as spatial",
    async (prop) => {
      const page = makePage({ main: makeTimeline({ [prop]: 50 }) });

      const result = await computeStaticFrameSet(page, 30);

      expect(result.nonSpatialOnlyFrameSet.has(0)).toBe(false);
    },
  );

  it("does not classify transformOrigin alone as spatial (a pivot-point modifier, not independent motion)", async () => {
    const page = makePage({ main: makeTimeline({ transformOrigin: "center" }) });

    const result = await computeStaticFrameSet(page, 30);

    expect(result.nonSpatialOnlyFrameSet.has(0)).toBe(true);
  });

  it("classifies a tween on opacity as non-spatial", async () => {
    const page = makePage({ main: makeTimeline({ opacity: 0.5 }) });

    const result = await computeStaticFrameSet(page, 30);

    expect(result.nonSpatialOnlyFrameSet.has(0)).toBe(true);
  });
});
