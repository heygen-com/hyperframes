import { describe, expect, it } from "vitest";
import { augmentProtocolTimeoutError, isProtocolTimeoutError } from "./protocolTimeoutErrorHint.js";

describe("augmentProtocolTimeoutError", () => {
  it("passes non-timeout errors through unchanged (same instance)", () => {
    const original = new Error("V8 heap exhausted");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect(result).toBe(original);
    expect(result.message).toBe("V8 heap exhausted");
  });

  it("augments Runtime.callFunctionOn timed out with the effective timeout", () => {
    const original = new Error(
      "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting.",
    );
    const result = augmentProtocolTimeoutError(original, 600_000);
    expect(result).not.toBe(original);
    expect(result.message).toContain(original.message);
    expect(result.message).toContain("HyperFrames effective protocolTimeout: 600000 ms");
  });

  it("includes both env and CLI hints", () => {
    const original = new Error("Runtime.callFunctionOn timed out");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect(result.message).toContain("PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS");
    expect(result.message).toContain("--protocol-timeout");
  });

  it("preserves err.cause on the augmented error", () => {
    const original = new Error("Runtime.callFunctionOn timed out");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect((result as Error & { cause?: unknown }).cause).toBe(original);
  });

  it("augments Target closed errors", () => {
    const original = new Error("Protocol error (Runtime.callFunctionOn): Target closed.");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect(result).not.toBe(original);
    expect(result.message).toContain("HyperFrames effective protocolTimeout");
  });

  it("matches the protocolTimeout keyword case-insensitively", () => {
    const original = new Error("some upstream saying PROTOCOLTIMEOUT was hit");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect(result).not.toBe(original);
  });

  it("coerces non-Error thrown values into Error without augmenting", () => {
    const result = augmentProtocolTimeoutError("plain string failure", 300_000);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("plain string failure");
    // Not augmented: coerced string doesn't match the protocol-timeout regex.
    expect(result.message).not.toContain("HyperFrames effective protocolTimeout");
  });

  it("mentions the field-signal shape reporters hit", () => {
    const original = new Error("Runtime.callFunctionOn timed out");
    const result = augmentProtocolTimeoutError(original, 300_000);
    expect(result.message).toContain("ts=1784047847");
    expect(result.message).toContain("FFmpeg-only encoding");
  });
});

describe("isProtocolTimeoutError", () => {
  it("returns true for matching messages", () => {
    expect(isProtocolTimeoutError(new Error("Runtime.callFunctionOn timed out"))).toBe(true);
    expect(isProtocolTimeoutError(new Error("Target closed"))).toBe(true);
    expect(isProtocolTimeoutError("protocolTimeout exceeded")).toBe(true);
  });

  it("returns false for non-matching messages", () => {
    expect(isProtocolTimeoutError(new Error("V8 heap exhausted"))).toBe(false);
    expect(isProtocolTimeoutError(new Error("Navigation timeout of 60000 ms exceeded"))).toBe(
      false,
    );
    expect(isProtocolTimeoutError(null)).toBe(false);
    expect(isProtocolTimeoutError(undefined)).toBe(false);
    expect(isProtocolTimeoutError(42)).toBe(false);
  });
});
