import { describe, expect, it, test } from "vitest";
import {
  dtwPresetForModel,
  initialModelForLanguage,
  isWhisperTimeoutError,
  resolveAudioPreparationTimeoutMs,
  resolveWhisperTimeoutMs,
  whisperModelSlowdownFactor,
  wrapWhisperTimeoutError,
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

describe("whisperModelSlowdownFactor", () => {
  it.each([
    ["tiny", 0.5],
    ["tiny.en", 0.5],
    ["base", 0.7],
    ["base.en", 0.7],
    ["small", 1],
    ["small.en", 1],
    ["medium", 2],
    ["medium.en", 2],
    ["large-v1", 4],
    ["large-v2", 4],
    ["large-v3", 4],
    ["large-v3-turbo", 2],
  ])("returns factor %s for known model %s", (model, expected) => {
    expect(whisperModelSlowdownFactor(model)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(whisperModelSlowdownFactor("MEDIUM.EN")).toBe(2);
    expect(whisperModelSlowdownFactor("Large-V3")).toBe(4);
  });

  it("falls back to the small.en baseline (1) for unknown model names", () => {
    // Unknown model names must never shorten the safety window, so the default
    // is the baseline factor rather than a smaller (tiny/base) value.
    expect(whisperModelSlowdownFactor("my-custom-finetune")).toBe(1);
  });
});

describe("resolveWhisperTimeoutMs with model factor", () => {
  it("keeps small.en (default) at the historical baseline for 63s clips", () => {
    // Regression guard: `small.en` (the CLI default model) must not lose
    // headroom when the caller passes a model. 63s * 10s/s * 1 = 630_000ms.
    expect(resolveWhisperTimeoutMs(63, { model: "small.en" })).toBe(630_000);
  });

  it("doubles the auto-scaled window for medium.en (field-signal ts=1784165471)", () => {
    // 63s clip on medium.en: emulated arm64/x64 saw ~13x realtime — 63*13 =
    // 819s needed. The 10x baseline (630_000ms = 10.5min) was insufficient;
    // the 2x medium factor lifts it to 1_260_000ms (21min), covering the
    // reported case with margin.
    expect(resolveWhisperTimeoutMs(63, { model: "medium.en" })).toBe(1_260_000);
  });

  it("quadruples the auto-scaled window for the large family", () => {
    expect(resolveWhisperTimeoutMs(60, { model: "large-v3" })).toBe(2_400_000);
  });

  it("still enforces the five-minute floor on tiny/base short clips", () => {
    // 10s * 10 * 0.5 = 50_000ms — below the floor, so the floor wins.
    expect(resolveWhisperTimeoutMs(10, { model: "tiny.en" })).toBe(300_000);
  });

  it("still enforces the twelve-hour cap on large-model marathon clips", () => {
    // 4320s * 10 * 4 = 172_800_000ms — the cap wins.
    expect(resolveWhisperTimeoutMs(4320, { model: "large-v3" })).toBe(43_200_000);
  });

  it("scales the null-duration fallback by the model factor", () => {
    // When ffprobe can't read the WAV, we lose duration signal but still know
    // the model. Scaling the floor keeps heavy models proportionally covered.
    expect(resolveWhisperTimeoutMs(null, { model: "medium.en" })).toBe(600_000);
    expect(resolveWhisperTimeoutMs(null, { model: "large-v3" })).toBe(1_200_000);
    expect(resolveWhisperTimeoutMs(null, { model: "small.en" })).toBe(300_000);
  });
});

describe("resolveWhisperTimeoutMs with overrideMs", () => {
  it("respects the explicit override even below the auto-scaled floor", () => {
    // A user who deliberately passed --timeout 30000 on a short clip meant 30s,
    // not five minutes. The auto-scaled floor must NOT stomp on the explicit
    // value — that would silently defeat the flag.
    expect(resolveWhisperTimeoutMs(60, { overrideMs: 30_000 })).toBe(30_000);
  });

  it("caps the override at the twelve-hour ceiling", () => {
    // A runaway value still can't hang the process forever.
    expect(resolveWhisperTimeoutMs(60, { overrideMs: 999_999_999 })).toBe(43_200_000);
  });

  it("ignores the model factor when overrideMs is set", () => {
    // Override wins outright — the model factor only affects the auto-scaled
    // path. Otherwise `--timeout 60000` on `medium.en` would silently become
    // 120_000ms and break the discoverability contract.
    expect(resolveWhisperTimeoutMs(60, { overrideMs: 60_000, model: "medium.en" })).toBe(60_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to auto-scaling when overrideMs is invalid (%s)",
    (invalid) => {
      // Invalid override → auto-scaled default kicks in (10s * 10 = 100_000ms →
      // floor 300_000ms). Prevents callers from accidentally disabling the
      // timeout via a bad env var.
      expect(resolveWhisperTimeoutMs(10, { overrideMs: invalid })).toBe(300_000);
    },
  );
});

describe("isWhisperTimeoutError", () => {
  it("returns true for a Node SIGTERM child-timeout error", () => {
    const err = Object.assign(new Error("Command failed"), { signal: "SIGTERM" });
    expect(isWhisperTimeoutError(err)).toBe(true);
  });

  it("returns true for an ETIMEDOUT-coded error", () => {
    const err = Object.assign(new Error("Command failed"), { code: "ETIMEDOUT" });
    expect(isWhisperTimeoutError(err)).toBe(true);
  });

  it("returns false for a non-timeout child error", () => {
    const err = Object.assign(new Error("Exit code 1"), { status: 1, signal: null });
    expect(isWhisperTimeoutError(err)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isWhisperTimeoutError("boom")).toBe(false);
  });
});

describe("wrapWhisperTimeoutError", () => {
  it("passes non-timeout errors through unchanged", () => {
    const err = new Error("segfault");
    const result = wrapWhisperTimeoutError(err, {
      effectiveTimeoutMs: 600_000,
      model: "small.en",
      wasOverride: false,
    });
    expect(result).toBe(err);
  });

  it("wraps SIGTERM timeouts with a discoverable hint naming --timeout and the env var", () => {
    const original = Object.assign(new Error("Command failed"), { signal: "SIGTERM" });
    const wrapped = wrapWhisperTimeoutError(original, {
      effectiveTimeoutMs: 1_260_000,
      model: "medium.en",
      wasOverride: false,
    });
    // Discoverability contract: message must name the flag, env var, effective
    // timeout, and cite the model so slow-CPU reporters see the knob.
    expect(wrapped).not.toBe(original);
    expect(wrapped.message).toContain("--timeout");
    expect(wrapped.message).toContain("HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS");
    expect(wrapped.message).toContain("1260s");
    expect(wrapped.message).toContain("medium.en");
    expect((wrapped as { cause?: unknown }).cause).toBe(original);
  });

  it("labels the source as explicit when wasOverride is true", () => {
    const original = Object.assign(new Error("Command failed"), { code: "ETIMEDOUT" });
    const wrapped = wrapWhisperTimeoutError(original, {
      effectiveTimeoutMs: 90_000,
      model: "medium.en",
      wasOverride: true,
    });
    expect(wrapped.message).toContain("explicit --timeout 90000ms");
  });

  it("coerces non-Error timeout-shaped values to Error without augmenting", () => {
    // A non-Error thrown value can't carry `.signal`, so it flows through
    // untouched but is still normalized to an Error instance for downstream
    // handlers that use instanceof checks.
    const wrapped = wrapWhisperTimeoutError("something bad", {
      effectiveTimeoutMs: 600_000,
      model: "small.en",
      wasOverride: false,
    });
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("something bad");
    expect(wrapped.message).not.toContain("--timeout");
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

describe("initialModelForLanguage", () => {
  test("keeps the default English-only model when no language is specified", () => {
    expect(initialModelForLanguage("small.en", undefined)).toBe("small.en");
  });

  test("uses the multilingual model before downloading for explicit German", () => {
    expect(initialModelForLanguage("small.en", "de")).toBe("small");
  });

  test("keeps English-only models for English locale variants", () => {
    expect(initialModelForLanguage("small.en", "en-US")).toBe("small.en");
  });

  test("keeps an already multilingual model unchanged", () => {
    expect(initialModelForLanguage("large-v3", "de")).toBe("large-v3");
  });
});
