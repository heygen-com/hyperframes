import { describe, expect, it } from "vitest";
import { forgetSteering, isSteering, steerMedia } from "./mediaSteer";

const media = (tag: "audio" | "video") => document.createElement(tag);

describe("steerMedia", () => {
  it("leaves media inside the tolerance at its rate", () => {
    expect(steerMedia(media("audio"), 0.03, 1, true)).toEqual({ rate: 1, seek: false });
  });

  it("steers video by its steps", () => {
    expect(steerMedia(media("video"), 0.35, 2, true)).toEqual({ rate: 2.5, seek: false });
    expect(steerMedia(media("video"), -0.05, 1, true).rate).toBeCloseTo(0.97, 9);
  });

  it("caps audio at 10% while its lag still grows, and seeks it once the lag holds past 100 ms", () => {
    const el = media("audio");
    expect(steerMedia(el, 0.35, 1, false).rate).toBeCloseTo(1.1, 9);
    expect(steerMedia(el, 0.35, 1, true)).toEqual({ rate: 1, seek: true });
    expect(isSteering(el)).toBe(false);
  });

  it("keeps steering until nearly back, and forgets on request", () => {
    const el = media("audio");
    steerMedia(el, 0.06, 1, true);
    expect(steerMedia(el, 0.02, 1, true).rate).toBeCloseTo(1.03, 9);
    expect(steerMedia(el, 0.005, 1, true)).toEqual({ rate: 1, seek: false });
    steerMedia(el, 0.06, 1, true);
    forgetSteering(el);
    expect(steerMedia(el, 0.02, 1, true).rate).toBe(1);
  });
});
