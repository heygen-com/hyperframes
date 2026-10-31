import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetSteering, isSteering, steerMedia } from "./mediaSteer";

const media = (tag: "audio" | "video") => document.createElement(tag);

const userAgent = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);

describe("steerMedia", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves media inside the tolerance at its rate", () => {
    expect(steerMedia(media("audio"), 0.03, 1, true)).toEqual({ rate: 1, seek: false });
  });

  it("steers video by its steps", () => {
    expect(steerMedia(media("video"), 0.35, 2, true)).toEqual({ rate: 2.5, seek: false });
    expect(steerMedia(media("video"), -0.05, 1, true).rate).toBeCloseTo(0.97, 9);
  });

  it("never steers audio: in WebKit it is seeked only once its lag holds past 0.65 s", () => {
    userAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    );
    const el = media("audio");
    expect(steerMedia(el, 0.35, 1, true)).toEqual({ rate: 1, seek: false });
    expect(steerMedia(el, 0.8, 1, false)).toEqual({ rate: 1, seek: false });
    expect(steerMedia(el, 0.8, 1, true)).toEqual({ rate: 1, seek: true });
    expect(isSteering(el)).toBe(false);
  });

  it("seeks audio past 0.1 s in Chrome, where nothing hides a start delay", () => {
    userAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    );
    const el = media("audio");
    expect(steerMedia(el, 0.08, 1, true)).toEqual({ rate: 1, seek: false });
    expect(steerMedia(el, 0.35, 1, true)).toEqual({ rate: 1, seek: true });
  });

  it("keeps steering until nearly back, and forgets on request", () => {
    const el = media("video");
    steerMedia(el, 0.06, 1, true);
    expect(steerMedia(el, 0.02, 1, true).rate).toBeCloseTo(1.03, 9);
    expect(steerMedia(el, 0.005, 1, true)).toEqual({ rate: 1, seek: false });
    steerMedia(el, 0.06, 1, true);
    forgetSteering(el);
    expect(steerMedia(el, 0.02, 1, true).rate).toBe(1);
  });
});
