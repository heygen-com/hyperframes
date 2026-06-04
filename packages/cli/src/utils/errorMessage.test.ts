import { describe, expect, it } from "vitest";
import { normalizeErrorMessage } from "./errorMessage.js";

describe("normalizeErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(normalizeErrorMessage(new Error("render failed"))).toBe("render failed");
  });

  it("returns the message of an Error subclass", () => {
    expect(normalizeErrorMessage(new TypeError("bad input"))).toBe("bad input");
  });

  it("passes a plain string through", () => {
    expect(normalizeErrorMessage("already a message")).toBe("already a message");
  });

  it("prefers a string message property on plain objects", () => {
    expect(normalizeErrorMessage({ message: "from object", code: 500 })).toBe("from object");
  });

  it("stringifies plain objects without a message property", () => {
    expect(normalizeErrorMessage({ status: 503, retryable: true })).toBe(
      '{"status":503,"retryable":true}',
    );
  });

  it("stringifies objects whose message property is not a string", () => {
    expect(normalizeErrorMessage({ message: 42 })).toBe('{"message":42}');
  });

  it("falls back to a key list when JSON.stringify throws on a cycle", () => {
    const cyclic: Record<string, unknown> = { code: "E_LOOP" };
    cyclic["self"] = cyclic;
    expect(normalizeErrorMessage(cyclic)).toBe("{code, self}");
  });

  it("falls back to String() when an object resists both JSON and key listing", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no keys for you");
        },
      },
    );
    expect(normalizeErrorMessage(hostile)).toBe("[object Object]");
  });

  it("returns 'unknown error' for null and undefined", () => {
    expect(normalizeErrorMessage(null)).toBe("unknown error");
    expect(normalizeErrorMessage(undefined)).toBe("unknown error");
  });

  it("stringifies non-object primitives", () => {
    expect(normalizeErrorMessage(42)).toBe("42");
    expect(normalizeErrorMessage(false)).toBe("false");
  });
});
