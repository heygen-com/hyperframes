import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armFromSharedStaticDedup,
  claimStaticDedupCheck,
  pickStaticSpotCheck,
  shareableStaticFrames,
  staticDedupMemoKey,
  type CaptureSession,
  type StaticVerificationResult,
} from "./frameCapture.js";
import type { CaptureOptions, StaticDedupMemo } from "../types.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./screenshotService.js")>();
  return { ...actual, pageScreenshotCapture: vi.fn() };
});

const fps = 30;

function framesOf(runs: Array<[number, number]>): number[] {
  return runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, index) => a + index));
}

// Twenty still runs of 60 frames, one every 100 frames, across a 2,000-frame film.
const STILL_RUNS: Array<[number, number]> = Array.from({ length: 20 }, (_, k) => [
  k * 100 + 10,
  k * 100 + 69,
]);
const STILL = framesOf(STILL_RUNS);

function sessionWith(memo: StaticDedupMemo, options: Partial<CaptureOptions> = {}): CaptureSession {
  return {
    captureMode: "screenshot",
    options: {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "png",
      transparent: true,
      staticDedupMemo: memo,
      compositionHash: "composition-a",
      ...options,
    },
  } as unknown as CaptureSession;
}

/** A fake verification page: seeks set the current frame, screenshots return `contentAt` of it. */
function fakePage(contentAt: (frame: number) => string) {
  const seen: number[] = [];
  let frame = 0;
  const page = {
    evaluate: vi.fn(async (_fn: unknown, t: number) => {
      frame = Math.round(t * fps);
    }),
    close: vi.fn(async () => {}),
  };
  vi.mocked(pageScreenshotCapture).mockImplementation(async () => {
    seen.push(frame);
    return Buffer.from(contentAt(frame));
  });
  const openVerificationPage = vi.fn(async () => page as never);
  return { seen, openVerificationPage };
}

function verdictOf(
  outcome: StaticVerificationResult["outcome"],
  frames: number[],
): StaticVerificationResult {
  return {
    outcome,
    verifiedFrames: new Set(frames),
    stats: {} as StaticVerificationResult["stats"],
  };
}

beforeEach(() => {
  vi.mocked(pageScreenshotCapture).mockReset();
});

describe("staticDedupMemoKey", () => {
  it("matches only when every pixel-deciding input matches", () => {
    const memo: StaticDedupMemo = {};
    const base = staticDedupMemoKey(sessionWith(memo));
    expect(base).toBeDefined();
    expect(
      staticDedupMemoKey(sessionWith(memo, { staticDedupFrameRange: { start: 0, end: 9 } })),
    ).toBe(base);
    for (const change of [
      { compositionHash: "composition-b" },
      { width: 1280 },
      { deviceScaleFactor: 2 },
      { transparent: false },
      { format: "jpeg" as const },
      { variables: { title: "other" } },
      { hiddenElementIds: ["logo"] },
    ]) {
      expect(staticDedupMemoKey(sessionWith(memo, change))).not.toBe(base);
    }
    const beginframe = { ...sessionWith(memo), captureMode: "beginframe" } as CaptureSession;
    expect(staticDedupMemoKey(beginframe)).not.toBe(base);
  });

  it("is absent without a memo or a composition hash, so the session verifies for itself", () => {
    expect(staticDedupMemoKey(sessionWith(undefined as never))).toBeUndefined();
    expect(staticDedupMemoKey(sessionWith({}, { compositionHash: undefined }))).toBeUndefined();
  });
});

describe("shareableStaticFrames", () => {
  it("shares the frames of a verdict that verified runs, including one stopped by its budget", () => {
    expect(shareableStaticFrames(verdictOf("time_budget", [10, 11, 12]))).toEqual([10, 11, 12]);
  });

  it.each([
    ["no verdict at all", null],
    ["a budget stop with no run verified", verdictOf("time_budget", [])],
    ["a mismatch", verdictOf("mismatch", [])],
    ["an infrastructure failure", verdictOf("infrastructure", [])],
    ["an unprofitable plan", verdictOf("unprofitable", [])],
  ])("shares dedup off after %s", (_label, verdict) => {
    expect(shareableStaticFrames(verdict)).toBeNull();
  });
});

describe("claimStaticDedupCheck", () => {
  it("lets the first session for a key verify and the later ones wait for its result", async () => {
    const memo: StaticDedupMemo = {};
    const first = claimStaticDedupCheck(sessionWith(memo));
    const second = claimStaticDedupCheck(
      sessionWith(memo, { staticDedupFrameRange: { start: 0, end: 9 } }),
    );
    expect(first?.kind).toBe("verify");
    expect(second?.kind).toBe("reuse");
    if (first?.kind !== "verify" || second?.kind !== "reuse") throw new Error("unexpected claims");
    first.settle([10, 11]);
    await expect(second.check).resolves.toEqual([10, 11]);
  });

  it("passes a failed check on as off, so a waiting session takes no screenshot", async () => {
    const memo: StaticDedupMemo = {};
    const first = claimStaticDedupCheck(sessionWith(memo));
    const second = claimStaticDedupCheck(sessionWith(memo));
    if (first?.kind !== "verify" || second?.kind !== "reuse") throw new Error("unexpected claims");
    first.settle(shareableStaticFrames(verdictOf("time_budget", [])));
    const { seen, openVerificationPage } = fakePage(() => "still");
    const session = sessionWith(memo);
    await armFromSharedStaticDedup(session, await second.check, new Set(STILL), fps, vi.fn(), {
      openVerificationPage,
    });
    expect(session.staticDedupSkipReason).toBe("verification_failed");
    expect(openVerificationPage).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it("gives a session with a different page its own check", () => {
    const memo: StaticDedupMemo = {};
    claimStaticDedupCheck(sessionWith(memo));
    expect(
      claimStaticDedupCheck(sessionWith(memo, { compositionHash: "composition-b" }))?.kind,
    ).toBe("verify");
  });

  it("claims nothing without a memo or a composition hash", () => {
    expect(claimStaticDedupCheck(sessionWith(undefined as never))).toBeUndefined();
    expect(claimStaticDedupCheck(sessionWith({}, { compositionHash: undefined }))).toBeUndefined();
  });
});

describe("pickStaticSpotCheck", () => {
  it("picks at most 4 runs of at most 48 frames, all inside the session's frames", () => {
    const picked = [...pickStaticSpotCheck(new Set(STILL), { start: 500, end: 1500 })];
    expect(picked.every((frame) => frame >= 500 && frame < 1500)).toBe(true);
    const runStarts = picked.filter((frame) => !picked.includes(frame - 1));
    expect(runStarts).toEqual([510, 810, 1110, 1410]);
    expect(picked.length).toBe(4 * 48);
  });

  it("skips runs that start at frame 0 or are too short to verify", () => {
    const picked = pickStaticSpotCheck(new Set([0, 1, 2, 3, 20, 21, 40, 41, 42]), undefined);
    expect([...picked]).toEqual([40, 41, 42]);
  });
});

describe("armFromSharedStaticDedup", () => {
  const worker = (memo: StaticDedupMemo, options: Partial<CaptureOptions> = {}) =>
    sessionWith(memo, { staticDedupFrameRange: { start: 500, end: 1500 }, ...options });

  it("reuses the shared set after a spot check of 12 screenshots inside the worker's frames", async () => {
    const { seen, openVerificationPage } = fakePage(() => "still");
    const session = worker({});
    const log = vi.fn();
    await armFromSharedStaticDedup(session, STILL, new Set(STILL), fps, log, {
      openVerificationPage,
    });
    expect(session.staticFrames).toEqual(new Set(STILL));
    expect(seen.length).toBe(12);
    expect(seen.every((frame) => frame >= 500 && frame < 1500)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps only the shared frames this worker also predicts still", async () => {
    const { openVerificationPage } = fakePage(() => "still");
    const session = worker({});
    const predicted = new Set(framesOf(STILL_RUNS.slice(0, 10)));
    await armFromSharedStaticDedup(session, STILL, predicted, fps, vi.fn(), {
      openVerificationPage,
    });
    expect(session.staticFrames).toEqual(predicted);
  });

  it("takes no screenshot when the render already found verification gives nothing", async () => {
    const { seen, openVerificationPage } = fakePage(() => "still");
    const session = worker({});
    const log = vi.fn();
    await armFromSharedStaticDedup(session, null, new Set(STILL), fps, log, {
      openVerificationPage,
    });
    expect(session.staticFrames).toBeUndefined();
    expect(session.staticDedupSkipReason).toBe("verification_failed");
    expect(openVerificationPage).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("turns dedup off for the worker when the shared set is wrong for its page", async () => {
    // The shared set says these frames are still, but on this page everything from 800 on moves.
    const { openVerificationPage } = fakePage((frame) =>
      frame < 800 ? "still" : `frame ${frame}`,
    );
    const session = worker({});
    const log = vi.fn();
    await armFromSharedStaticDedup(session, STILL, new Set(STILL), fps, log, {
      openVerificationPage,
    });
    expect(session.staticFrames).toBeUndefined();
    expect(session.staticDedupSkipReason).toBe("verification_failed");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("spot check of the shared set: mismatch");
  });
});
