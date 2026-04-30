import { describe, it, expect } from "vitest";
import { formatFrameTime, frameToSeconds, secondsToFrame, stepFrameTime, formatTime } from "./time";

describe("formatTime", () => {
  it("formats zero seconds", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds less than a minute", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(30)).toBe("0:30");
    expect(formatTime(59)).toBe("0:59");
  });

  it("formats exact minutes", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(120)).toBe("2:00");
    expect(formatTime(600)).toBe("10:00");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(125)).toBe("2:05");
  });

  it("formats large values (over an hour)", () => {
    expect(formatTime(3600)).toBe("60:00");
    expect(formatTime(3661)).toBe("61:01");
    expect(formatTime(7200)).toBe("120:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(0.9)).toBe("0:00");
    expect(formatTime(1.5)).toBe("0:01");
    expect(formatTime(59.99)).toBe("0:59");
    expect(formatTime(60.5)).toBe("1:00");
  });

  it("pads single-digit seconds with leading zero", () => {
    expect(formatTime(1)).toBe("0:01");
    expect(formatTime(61)).toBe("1:01");
    expect(formatTime(609)).toBe("10:09");
  });

  it("guards against negative values", () => {
    expect(formatTime(-1)).toBe("0:00");
  });

  it("guards against NaN", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("guards against Infinity", () => {
    expect(formatTime(Infinity)).toBe("0:00");
  });
});

describe("frame helpers", () => {
  it("converts seconds to frames at the Studio preview rate", () => {
    expect(secondsToFrame(0)).toBe(0);
    expect(secondsToFrame(1)).toBe(30);
    expect(secondsToFrame(1.5)).toBe(45);
  });

  it("converts frames to seconds at the Studio preview rate", () => {
    expect(frameToSeconds(0)).toBe(0);
    expect(frameToSeconds(30)).toBe(1);
    expect(frameToSeconds(45)).toBe(1.5);
  });

  it("formats current and total frame display", () => {
    expect(formatFrameTime(1, 5)).toBe("30f / 150f");
  });

  it("steps from a truncated runtime time by integer frame index", () => {
    expect(stepFrameTime(0.0333333, 1)).toBe(2 / 30);
    expect(stepFrameTime(0.0666666, 1)).toBe(3 / 30);
    expect(stepFrameTime(0.0666666, -1)).toBe(1 / 30);
  });

  it("clamps frame stepping at zero", () => {
    expect(stepFrameTime(0, -1)).toBe(0);
  });
});
