import { describe, expect, it, test } from "vitest";
import {
  dtwPresetForModel,
  resolveAudioPreparationTimeoutMs,
  resolveWhisperTimeoutMs,
} from "./transcribe.js";

describe("dtwPresetForModel", () => {
  // The large family is the regression: model files are hyphenated but
  // whisper.cpp's --dtw preset is dotted, so `--dtw large-v3` used to abort
  // with "unknown DTW preset 'large-v3'".
  test.each([
    ["large-v3", "large.v3"],
    ["large-v2", "large.v2"],
    ["large-v1", "large.v1"],
    ["large-v3-turbo", "large.v3.turbo"],
  ])("maps hyphenated large model %s to dotted preset %s", (model, preset) => {
    expect(dtwPresetForModel(model)).toBe(preset);
  });

  // tiny/base/small/medium (+.en) already match their preset — must be unchanged.
  test.each(["tiny", "base.en", "small.en", "medium.en", "small"])(
    "leaves preset-identical model %s unchanged",
    (model) => {
      expect(dtwPresetForModel(model)).toBe(model);
    },
  );
});

describe("resolveWhisperTimeoutMs", () => {
  it("keeps the existing five-minute floor for short recordings", () => {
    expect(resolveWhisperTimeoutMs(10)).toBe(300_000);
  });

  it("scales the timeout for long recordings", () => {
    expect(resolveWhisperTimeoutMs(41 * 60)).toBe(24_600_000);
  });

  it("caps the safety window at twelve hours", () => {
    expect(resolveWhisperTimeoutMs(24 * 60 * 60)).toBe(43_200_000);
  });

  it("falls back to five minutes when duration is unavailable", () => {
    expect(resolveWhisperTimeoutMs(null)).toBe(300_000);
    expect(resolveWhisperTimeoutMs(Number.NaN)).toBe(300_000);
  });

  it.each([
    [30, 300_000],
    [30.1, 301_000],
    [4319, 43_190_000],
    [4320, 43_200_000],
  ])("clamps duration %ss to %sms", (duration, expected) => {
    expect(resolveWhisperTimeoutMs(duration)).toBe(expected);
  });
});

describe("resolveAudioPreparationTimeoutMs", () => {
  it.each([
    [10, 120_000],
    [6 * 60 * 60, 10_800_000],
    [24 * 60 * 60, 21_600_000],
  ])("scales duration %ss to %sms", (duration, expected) => {
    expect(resolveAudioPreparationTimeoutMs(duration)).toBe(expected);
  });

  it("falls back to two minutes when duration is unavailable", () => {
    expect(resolveAudioPreparationTimeoutMs(null)).toBe(120_000);
    expect(resolveAudioPreparationTimeoutMs(Number.NaN)).toBe(120_000);
  });
});
