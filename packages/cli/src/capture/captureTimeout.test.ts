import { describe, expect, it } from "vitest";
import {
  captureProtocolTimeoutMs,
  formatCaptureFailureReason,
  isProtocolEvaluateTimeoutError,
} from "./captureTimeout.js";

describe("captureProtocolTimeoutMs", () => {
  it("uses the larger of nav timeout and post-nav budget", () => {
    expect(captureProtocolTimeoutMs(120_000, 90_000)).toBe(120_000);
    expect(captureProtocolTimeoutMs(30_000, 120_000)).toBe(120_000);
  });

  it("floors at 60s", () => {
    expect(captureProtocolTimeoutMs(5_000, 5_000)).toBe(60_000);
  });
});

describe("isProtocolEvaluateTimeoutError", () => {
  it("matches Puppeteer evaluate protocol timeouts", () => {
    expect(
      isProtocolEvaluateTimeoutError(
        new Error(
          "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
        ),
      ),
    ).toBe(true);
  });

  it("ignores navigation timeouts", () => {
    expect(
      isProtocolEvaluateTimeoutError(new Error("Navigation timeout of 30000 ms exceeded")),
    ).toBe(false);
  });
});

describe("formatCaptureFailureReason", () => {
  it("describes evaluate/protocol timeouts as extraction failures", () => {
    const reason = formatCaptureFailureReason(
      "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
    );
    expect(reason).toMatch(/extraction timed out/i);
    expect(reason).not.toMatch(/navigation timed out/i);
    expect(reason).not.toMatch(/blocking headless/i);
  });

  it("keeps navigation timeout wording for nav failures", () => {
    expect(formatCaptureFailureReason("Navigation timeout of 30000 ms exceeded")).toMatch(
      /navigation timed out/i,
    );
  });

  it("passes through non-timeout failures", () => {
    expect(formatCaptureFailureReason("Website capture blocked: HTTP 403")).toBe(
      "Capture failed: Website capture blocked: HTTP 403",
    );
  });
});
