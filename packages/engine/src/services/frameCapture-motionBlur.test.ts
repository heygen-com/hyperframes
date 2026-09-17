import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureFrame,
  captureFrameToBuffer,
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
    motionBlur: resolveMotionBlurPlan({}) ?? undefined,
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
  it("pays nothing on a static frame instead of capturing K samples of the same instant", async () => {
    const anchor = solidPng(42);
    const session = makeSession({
      staticFrames: new Set([11]),
      lastFrameBuffer: anchor,
      lastFrameAbsoluteIndex: 10,
    });

    const result = await captureFrameToBuffer(session, 11, 11 / 30);

    expect(result.buffer).toBe(anchor);
    expect(vi.mocked(pageScreenshotCapture)).not.toHaveBeenCalled();
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
    expect(resolveSessionMotionBlur(withOptions({}))?.sampleTickOffsets).toHaveLength(16);
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
