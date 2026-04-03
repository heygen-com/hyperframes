import { describe, it, expect } from "vitest";
import { formatTime } from "./controls.js";

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
