// A host that never registers a timeline costs the full wait once per render: later
// sessions sharing the render's memo report the same timeout without waiting again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import {
  type CaptureSession,
  pollSubCompositionTimelines,
  waitForSubCompositionTimelines,
} from "./frameCapture.js";
import type { SubTimelineWaitMemo } from "../types.js";

const TIMEOUT_MS = 45_000;

// Runs the page-side check scripts against a fake DOM with hosts "main" and "badge".
function makeDomPage(timelines: Record<string, unknown>): Page {
  const host = (id: string) => ({
    hasAttribute: () => false,
    getAttribute: (name: string) => (name === "data-composition-id" ? id : null),
  });
  const document = { querySelectorAll: () => [host("main"), host("badge")] };
  const window = { __timelines: timelines, __hfForceTimelineRebind: vi.fn() };
  return {
    evaluate: vi.fn(async (expr: string) =>
      new Function("document", "window", `return ${expr}`)(document, window),
    ),
  } as unknown as Page;
}

function makeSession(memo: SubTimelineWaitMemo): CaptureSession {
  return { subTimelineWaitMemo: memo, scriptLoadFailures: [] } as unknown as CaptureSession;
}

function track<T>(promise: Promise<T>): { settled: () => boolean; promise: Promise<T> } {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  return { settled: () => done, promise };
}

describe("sub-composition timeline wait memo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a later session sharing the memo reports the timeout without waiting again", async () => {
    const memo: SubTimelineWaitMemo = {};
    const first = makeSession(memo);
    const firstWait = track(
      waitForSubCompositionTimelines(first, makeDomPage({ main: {} }), TIMEOUT_MS),
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(firstWait.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await firstWait.promise;
    expect(first.subTimelineWaitOutcome).toBe("timeout");
    expect(memo.unregisteredIds).toEqual(["badge"]);

    const second = makeSession(memo);
    const secondWait = track(
      waitForSubCompositionTimelines(second, makeDomPage({ main: {} }), TIMEOUT_MS),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(secondWait.settled()).toBe(true);
    expect(second.subTimelineWaitOutcome).toBe("timeout");
    expect(second.pendingTimelineIds).toEqual(["badge"]);
  });

  it("still waits out the timeout for hosts the memo does not name", async () => {
    const onPending = vi.fn();
    const wait = track(
      pollSubCompositionTimelines(
        makeDomPage({}),
        TIMEOUT_MS,
        undefined,
        undefined,
        undefined,
        onPending,
        undefined,
        ["badge"],
      ),
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(wait.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await wait.promise).toBe("timeout");
    expect(onPending).toHaveBeenCalledWith(["main", "badge"]);
  });

  it("reports ready and rebinds when a memo host has registered since", async () => {
    const page = makeDomPage({ main: {}, badge: {} });
    const outcome = await pollSubCompositionTimelines(
      page,
      TIMEOUT_MS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["badge"],
    );
    expect(outcome).toBe("ready");
    const exprs = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(exprs.some((e) => e.includes("__hfForceTimelineRebind"))).toBe(true);
  });
});
