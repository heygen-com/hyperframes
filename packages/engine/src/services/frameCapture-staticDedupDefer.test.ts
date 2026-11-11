import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armDeferredStaticDedup,
  armStaticDedup,
  prepareCaptureSessionForReuse,
  verifyStaticFramesSafe,
  type CaptureSession,
} from "./frameCapture.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./screenshotService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./screenshotService.js")>();
  return { ...actual, pageScreenshotCapture: vi.fn(async () => Buffer.from("still")) };
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A session that deferred a check predicting frames 5 and 6 still; unverified arming makes the check visible. */
function deferredSession(deferred: boolean): CaptureSession {
  const stats = { eligible: true, staticFrameSet: new Set([5, 6]), totalFrames: 10 };
  return {
    captureMode: "screenshot",
    options: { fps: { num: 30, den: 1 } },
    page: {},
    ...(deferred ? { staticDedupDeferred: stats } : {}),
  } as unknown as CaptureSession;
}

describe("still-frame check activity", () => {
  it("reports every check screenshot to onStaticDedupActivity", async () => {
    const onStaticDedupActivity = vi.fn();
    const page = { evaluate: vi.fn(async () => {}) };
    const session = { options: { onStaticDedupActivity } } as unknown as CaptureSession;
    const frames = new Set(Array.from({ length: 100 }, (_, index) => index + 1));
    const result = await verifyStaticFramesSafe(
      session,
      page as unknown as Parameters<typeof verifyStaticFramesSafe>[1],
      frames,
      30,
      1,
    );
    expect(result.stats.screenshots).toBeGreaterThan(0);
    expect(onStaticDedupActivity).toHaveBeenCalledTimes(result.stats.screenshots);
    expect(vi.mocked(pageScreenshotCapture)).toHaveBeenCalledTimes(result.stats.screenshots);
  });
});

/** A page whose timeline walk sees one tween in [0 s, 1 s) of a 4 s film; `inject()` adds the drawElement canvas. */
function fastCapturePage() {
  let injected = false;
  const page = {
    evaluate: vi.fn(async (fn: unknown) => {
      const source = String(fn);
      if (source.includes("getChildren")) {
        return {
          intervals: [{ start: 0, end: 1, spatial: true }],
          tweenCount: 1,
          duration: 4,
          hasVideo: false,
          hasCanvas: injected,
          hasFrameSources: false,
          hasIframe: false,
          hasNonGsapAnim: false,
          hasUnresolvableClipStart: false,
          hasTimelineCall: false,
        };
      }
      if (source.includes("__hf_page_composite_prepare")) return false;
      return [];
    }),
  };
  return { page, inject: () => (injected = true) };
}

describe("a probe session on the fast capture path", () => {
  it("keeps still-frame dedup when it is reused to capture after its canvas went in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-dedup-defer-"));
    dirs.push(dir);
    const { page, inject } = fastCapturePage();
    const session = {
      captureMode: "screenshot",
      options: { fps: { num: 30, den: 1 }, deferStaticDedup: true },
      config: {},
      page,
      deRiskFrames: new Set([90]),
    } as unknown as CaptureSession;
    vi.stubEnv("HF_STATIC_DEDUP_VERIFY", "false");
    let predicted = new Set<number>();
    try {
      await armStaticDedup(session, session.page, () => {});
      expect(session.staticFrames).toBeUndefined();
      predicted = new Set(session.staticDedupDeferred?.staticFrameSet ?? []);
      inject();
      session.captureMode = "drawelement";
      await prepareCaptureSessionForReuse(session, join(dir, "frames"), null);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(session.staticDedupSkipReason).toBeUndefined();
    expect(predicted.has(90)).toBe(true);
    predicted.delete(90);
    expect(session.staticFrames).toEqual(predicted);
    expect(predicted.size).toBe(87);
  });
});

describe("a deferred still-frame check", () => {
  beforeEach(() => vi.stubEnv("HF_STATIC_DEDUP_VERIFY", "false"));
  afterEach(() => vi.unstubAllEnvs());

  it("runs only on a session that deferred it", async () => {
    const other = deferredSession(false);
    await armDeferredStaticDedup(other);
    expect(other.staticFrames).toBeUndefined();

    const deferred = deferredSession(true);
    await armDeferredStaticDedup(deferred);
    expect(deferred.staticDedupDeferred).toBeUndefined();
    expect(deferred.staticFrames?.size).toBe(2);
  });

  it("runs when the session is reused to capture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-dedup-defer-"));
    dirs.push(dir);
    const deferred = deferredSession(true);
    await prepareCaptureSessionForReuse(deferred, join(dir, "frames"), null);
    expect(deferred.staticDedupDeferred).toBeUndefined();
    expect(deferred.staticFrames?.size).toBe(2);
  });
});
