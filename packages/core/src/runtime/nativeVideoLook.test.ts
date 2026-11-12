import { afterEach, expect, it, vi } from "vitest";
import {
  NATIVE_VIDEO_LOOK_FILTER_ID,
  applyNativeVideoLook,
  nativeVideoLookNeeded,
  nativeVideoLookValue,
} from "./nativeVideoLook";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const asBrowser = (userAgent: string) => vi.stubGlobal("navigator", { userAgent });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// A 16-step gray ramp (BT.709 limited range, steps of 17) measured on screen on a Mac: what a canvas shows
// for each step, and what the video layer shows for the same step.
const MEASURED_ON_CANVAS = [
  0, 17, 33, 51, 67, 85, 102, 118, 136, 152, 170, 187, 203, 221, 237, 255,
];
const MEASURED_ON_VIDEO_LAYER = [
  0, 15, 37, 58, 76, 95, 113, 130, 147, 162, 179, 195, 209, 225, 239, 255,
];

it("turns what a canvas shows into what the video layer shows, within one step on every measured gray", () => {
  MEASURED_ON_CANVAS.forEach((shown, step) => {
    expect(
      Math.abs(nativeVideoLookValue(shown) - MEASURED_ON_VIDEO_LAYER[step]!),
    ).toBeLessThanOrEqual(1);
  });
});

it("keeps black and white where they are", () => {
  expect([nativeVideoLookValue(0), nativeVideoLookValue(255)]).toEqual([0, 255]);
});

it("applies to Chromium on a Mac and to nothing else", () => {
  asBrowser(MAC_CHROME);
  expect(nativeVideoLookNeeded()).toBe(true);
  asBrowser(MAC_SAFARI);
  expect(nativeVideoLookNeeded()).toBe(false);
  asBrowser(WINDOWS_CHROME);
  expect(nativeVideoLookNeeded()).toBe(false);
});

it("puts the look ahead of an authored filter and defines it once", () => {
  asBrowser(MAC_CHROME);
  const first = document.createElement("canvas");
  const second = document.createElement("canvas");
  applyNativeVideoLook(first, "none");
  applyNativeVideoLook(second, "blur(2px)");
  expect(first.style.filter).toMatch(new RegExp(`^url\\("?#${NATIVE_VIDEO_LOOK_FILTER_ID}"?\\)$`));
  expect(second.style.filter).toMatch(
    new RegExp(`^url\\("?#${NATIVE_VIDEO_LOOK_FILTER_ID}"?\\) blur\\(2px\\)$`),
  );
  expect(document.querySelectorAll(`#${NATIVE_VIDEO_LOOK_FILTER_ID}`)).toHaveLength(1);
  // Saved source drops every element carrying the preview-canvas mark, so the filter never reaches a project file.
  expect(document.querySelector("svg")?.hasAttribute("data-hf-preview-video-canvas")).toBe(true);
});

it("leaves the canvas alone where the video layer already agrees with it", () => {
  asBrowser(WINDOWS_CHROME);
  const canvas = document.createElement("canvas");
  applyNativeVideoLook(canvas, "blur(2px)");
  expect(canvas.style.filter).toBe("");
  expect(document.getElementById(NATIVE_VIDEO_LOOK_FILTER_ID)).toBeNull();
});
