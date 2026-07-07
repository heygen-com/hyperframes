import { describe, expect, it, vi } from "vitest";
import {
  navigationTimeoutHint,
  raceMediaReady,
  resolveNavigationTimeoutMs,
  shouldIgnoreRequestFailure,
  waitForPreferredSeekTarget,
} from "./browserValidate.js";

// Regression for the validate audio-duration-probe timeout: a slow-loading
// media element's duration was snapshotted once, at a fixed point in time,
// and any element still mid-load was permanently misreported as unreadable.
// raceMediaReady is the extracted wiring auditClipDurations now uses to wait
// for `loadedmetadata` up to a deadline instead. Node's built-in EventTarget
// satisfies the same duck-typed shape as a real HTMLMediaElement here, so
// this is a real test of the race/cleanup logic, not a browser mock.
describe("raceMediaReady", () => {
  class FakeMediaElement extends EventTarget {
    duration = NaN;
  }

  it("resolves immediately when duration is already available", async () => {
    const el = new FakeMediaElement();
    el.duration = 12.5;
    const start = Date.now();
    await raceMediaReady(el, Date.now() + 5000);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("resolves as soon as loadedmetadata fires, before the deadline", async () => {
    const el = new FakeMediaElement();
    const promise = raceMediaReady(el, Date.now() + 5000);
    setTimeout(() => {
      el.duration = 8;
      el.dispatchEvent(new Event("loadedmetadata"));
    }, 20);
    const start = Date.now();
    await promise;
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("resolves on error without hanging until the deadline", async () => {
    const el = new FakeMediaElement();
    const promise = raceMediaReady(el, Date.now() + 5000);
    setTimeout(() => el.dispatchEvent(new Event("error")), 20);
    const start = Date.now();
    await promise;
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("falls back to the deadline when no event ever fires", async () => {
    const el = new FakeMediaElement();
    const start = Date.now();
    await raceMediaReady(el, Date.now() + 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("shouldIgnoreRequestFailure", () => {
  it("ignores aborted media preload requests", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_ABORTED"),
    ).toBe(true);
    expect(shouldIgnoreRequestFailure("http://127.0.0.1:3000/video.mp4", "net::ERR_ABORTED")).toBe(
      true,
    );
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "media",
      ),
    ).toBe(true);
  });

  it("keeps non-media and non-aborted failures reportable", () => {
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/map.png", "net::ERR_ABORTED"),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure(
        "https://www.heygenverse.com/s/50f13ccf-9002-4d80-b567-9d4c0eac30d8/raw",
        "net::ERR_ABORTED",
        "xhr",
      ),
    ).toBe(false);
    expect(
      shouldIgnoreRequestFailure("http://127.0.0.1:3000/assets/sfx.wav", "net::ERR_FAILED"),
    ).toBe(false);
  });
});

describe("waitForPreferredSeekTarget", () => {
  it("waits for the runtime player/bridge target before falling back to raw timelines", async () => {
    const page = {
      waitForFunction: vi.fn(async () => undefined),
    };

    await waitForPreferredSeekTarget(page, 123);

    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), { timeout: 123 });
  });

  it("does not fail validation when only the legacy raw timeline fallback is available", async () => {
    const page = {
      waitForFunction: vi.fn(async () => {
        throw new Error("waiting failed: timeout");
      }),
    };

    await expect(waitForPreferredSeekTarget(page, 1)).resolves.toBeUndefined();
  });
});

// Regression: `validate` used a hardcoded 10s page-navigation timeout that
// ignored --timeout, so a composition loading GSAP from a CDN <script> (which
// blocks domcontentloaded) failed with an opaque "Navigation timeout of 10000ms"
// even though the full render's larger budget rode it out — with no knob to
// extend it. resolveNavigationTimeoutMs makes --timeout raise the nav budget
// (never below the 10s floor); navigationTimeoutHint replaces the opaque error.
describe("resolveNavigationTimeoutMs", () => {
  it("keeps the 10s floor when --timeout is unset or smaller", () => {
    expect(resolveNavigationTimeoutMs(undefined)).toBe(10000);
    expect(resolveNavigationTimeoutMs(3000)).toBe(10000); // the default --timeout
    expect(resolveNavigationTimeoutMs(0)).toBe(10000);
  });

  it("raises the navigation budget to --timeout when it exceeds the floor", () => {
    expect(resolveNavigationTimeoutMs(30000)).toBe(30000);
  });
});

describe("navigationTimeoutHint", () => {
  it("replaces a Puppeteer navigation-timeout error with an actionable CDN/--timeout hint", () => {
    const hinted = navigationTimeoutHint(
      new Error("Navigation timeout of 10000 ms exceeded"),
      10000,
    );
    expect(hinted).toBeInstanceOf(Error);
    expect(hinted?.message).toContain("10000ms");
    expect(hinted?.message).toContain("CDN");
    expect(hinted?.message).toContain("--timeout");
  });

  it("returns null for any non-navigation-timeout error so the caller rethrows it as-is", () => {
    expect(navigationTimeoutHint(new Error("net::ERR_CONNECTION_REFUSED"), 10000)).toBeNull();
    expect(navigationTimeoutHint("some string failure", 10000)).toBeNull();
  });
});
