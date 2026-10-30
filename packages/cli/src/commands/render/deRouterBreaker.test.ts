import { describe, expect, it } from "vitest";
import {
  DE_ROUTER_BREAKER_WINDOW,
  afterCleanRender,
  afterRevert,
  forVersion,
  isRouterOff,
} from "./deRouterBreaker.js";

const revert = (atRender: number, version = "1.0.0") => ({
  reason: "psnr",
  frameIndex: 812,
  failedDb: 24.5,
  thresholdDb: 32,
  at: "2026-10-01T00:00:00.000Z",
  version,
  atRender,
});

describe("deRouterBreaker", () => {
  it("keeps the router on after one revert and remembers it", () => {
    const next = afterRevert(undefined, revert(3));
    expect(next).toEqual({ strike: revert(3) });
    expect(isRouterOff(next, "1.0.0")).toBe(false);
  });

  it("turns the router off on a second revert inside the window, keeping the first one's frame detail out of the record", () => {
    const next = afterRevert({ strike: revert(3) }, revert(3 + DE_ROUTER_BREAKER_WINDOW - 1));
    expect(next.trip).toEqual({ ...revert(3 + DE_ROUTER_BREAKER_WINDOW - 1), cleanRenders: 0 });
    expect(isRouterOff(next, "1.0.0")).toBe(true);
  });

  it("treats a second revert a full window later as a new first one", () => {
    const next = afterRevert({ strike: revert(3) }, revert(3 + DE_ROUTER_BREAKER_WINDOW));
    expect(next).toEqual({ strike: revert(3 + DE_ROUTER_BREAKER_WINDOW) });
  });

  it("is on again for a different CLI version", () => {
    const off = afterRevert({ strike: revert(1) }, revert(2));
    expect(isRouterOff(off, "1.0.1")).toBe(false);
    expect(forVersion(off, "1.0.1")).toBeUndefined();
    expect(forVersion(off, "1.0.0")).toBe(off);
  });

  it("drops a strike recorded by another version", () => {
    expect(forVersion({ strike: revert(1) }, "1.0.1")).toBeUndefined();
  });

  it("counts clean renders while off and brings the router back on the 20th", () => {
    let state = afterRevert({ strike: revert(1) }, revert(2)) as ReturnType<
      typeof afterCleanRender
    >;
    for (let i = 1; i < DE_ROUTER_BREAKER_WINDOW; i++) {
      state = afterCleanRender(state);
      expect(state?.trip?.cleanRenders).toBe(i);
    }
    expect(afterCleanRender(state)).toBeUndefined();
  });

  it("leaves an armed breaker alone on a clean render", () => {
    expect(afterCleanRender(undefined)).toBeUndefined();
    expect(afterCleanRender({ strike: revert(1) })).toEqual({ strike: revert(1) });
  });
});
