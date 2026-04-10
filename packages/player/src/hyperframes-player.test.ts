import { describe, it, expect } from "vitest";
import { formatTime, formatSpeed, SPEED_PRESETS } from "./controls.js";

describe("SPEED_PRESETS", () => {
  it("contains logarithmic speed steps", () => {
    expect(SPEED_PRESETS).toEqual([0.25, 0.5, 1, 1.5, 2, 4]);
  });

  it("includes 1x as default speed", () => {
    expect(SPEED_PRESETS).toContain(1);
  });
});

describe("formatSpeed", () => {
  it("formats integer speeds", () => {
    expect(formatSpeed(1)).toBe("1x");
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(4)).toBe("4x");
  });

  it("formats fractional speeds", () => {
    expect(formatSpeed(0.25)).toBe("0.25x");
    expect(formatSpeed(0.5)).toBe("0.5x");
    expect(formatSpeed(1.5)).toBe("1.5x");
  });
});

describe("formatTime", () => {
  it("formats 0 seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats exact minutes", () => {
    expect(formatTime(120)).toBe("2:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(95)).toBe("1:35");
  });

  it("pads seconds with leading zero", () => {
    expect(formatTime(61)).toBe("1:01");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(3.7)).toBe("0:03");
  });

  it("handles negative input", () => {
    expect(formatTime(-5)).toBe("0:00");
  });
});
