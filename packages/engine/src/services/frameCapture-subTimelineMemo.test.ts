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

function makeSession(
  memo: SubTimelineWaitMemo,
  extra: Partial<Pick<CaptureSession, "pageErrors" | "scriptLoadFailures" | "vfxFailure">> = {},
): CaptureSession {
  return {
    subTimelineWaitMemo: memo,
    scriptLoadFailures: [],
    pageErrors: [],
    ...extra,
  } as unknown as CaptureSession;
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

  it("does not remember a timeout whose session saw a page error", async () => {
    const memo: SubTimelineWaitMemo = {};
    const session = makeSession(memo, { pageErrors: ["TypeError: d.items is undefined"] });
    const wait = track(
      waitForSubCompositionTimelines(session, makeDomPage({ main: {} }), TIMEOUT_MS),
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    await wait.promise;
    expect(session.subTimelineWaitOutcome).toBe("timeout");
    expect(memo.unregisteredIds).toBeUndefined();
  });

  it("does not remember a wait a VFX failure stopped early", async () => {
    const memo: SubTimelineWaitMemo = {};
    const session = makeSession(memo, { vfxFailure: "chain failed" });
    await waitForSubCompositionTimelines(session, makeDomPage({ main: {} }), TIMEOUT_MS);
    expect(session.subTimelineWaitOutcome).toBe("timeout");
    expect(memo.unregisteredIds).toBeUndefined();
  });

  it("a replaying session that sees a failed script load reports a script failure", async () => {
    const session = makeSession(
      { unregisteredIds: ["badge"] },
      { scriptLoadFailures: ["http://127.0.0.1:3000/badge.js"] },
    );
    const wait = track(
      waitForSubCompositionTimelines(session, makeDomPage({ main: {} }), TIMEOUT_MS),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(wait.settled()).toBe(true);
    expect(session.subTimelineWaitOutcome).toBe("script_failure");
  });

  it("still waits out the timeout for hosts the memo does not name", async () => {
    const onPending = vi.fn();
    const wait = track(
      pollSubCompositionTimelines(makeDomPage({}), TIMEOUT_MS, {
        onPending,
        knownUnregisteredIds: ["badge"],
      }),
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(wait.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await wait.promise).toBe("timeout");
    expect(onPending).toHaveBeenCalledWith(["main", "badge"]);
  });

  it("reports ready and rebinds when a memo host has registered since", async () => {
    const page = makeDomPage({ main: {}, badge: {} });
    const outcome = await pollSubCompositionTimelines(page, TIMEOUT_MS, {
      knownUnregisteredIds: ["badge"],
    });
    expect(outcome).toBe("ready");
    const exprs = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(exprs.some((e) => e.includes("__hfForceTimelineRebind"))).toBe(true);
  });
});
