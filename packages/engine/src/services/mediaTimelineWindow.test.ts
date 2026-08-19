import { describe, expect, it } from "vitest";
import { isKnownInactiveTimelineWindow } from "./mediaTimelineWindow.js";

const elementWith = (name: "data-duration" | "data-end", value: string) => ({
  getAttribute(attribute: string) {
    return attribute === name ? value : null;
  },
});

describe("isKnownInactiveTimelineWindow strict numeric attributes", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["0s", false],
    ["0abc", false],
    ["0px", false],
    ["-1s", false],
    ["0x10", false],
    ["Infinity", false],
    ["NaN", false],
    ["0", true],
    ["-1", true],
    ["5", false],
  ])("treats data-duration=%j consistently (inactive=%s)", (raw, inactive) => {
    expect(isKnownInactiveTimelineWindow(elementWith("data-duration", raw), 2)).toBe(inactive);
  });

  it.each([
    ["", false],
    ["2s", false],
    ["2abc", false],
    ["0x10", false],
    ["Infinity", false],
    ["2", true],
    ["-1", true],
    ["5", false],
  ])("treats data-end=%j consistently (inactive=%s)", (raw, inactive) => {
    expect(isKnownInactiveTimelineWindow(elementWith("data-end", raw), 2)).toBe(inactive);
  });
});
