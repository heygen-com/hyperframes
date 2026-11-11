import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armDeferredStaticDedup,
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

/** A session whose config turns dedup off, so running its check is visible without a browser. */
function sessionWithDedupOff(deferred: boolean): CaptureSession {
  return {
    captureMode: "screenshot",
    options: {},
    config: { staticFrameDedup: false },
    page: {},
    ...(deferred ? { staticDedupDeferred: true } : {}),
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

describe("a deferred still-frame check", () => {
  it("runs only on a session that deferred it", async () => {
    const other = sessionWithDedupOff(false);
    await armDeferredStaticDedup(other);
    expect(other.staticDedupEnabled).toBeUndefined();

    const deferred = sessionWithDedupOff(true);
    await armDeferredStaticDedup(deferred);
    expect(deferred.staticDedupDeferred).toBe(false);
    expect(deferred.staticDedupEnabled).toBe(false);
  });

  it("runs when the session is reused to capture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-dedup-defer-"));
    dirs.push(dir);
    const deferred = sessionWithDedupOff(true);
    await prepareCaptureSessionForReuse(deferred, join(dir, "frames"), null);
    expect(deferred.staticDedupDeferred).toBe(false);
    expect(deferred.staticDedupEnabled).toBe(false);
  });
});
