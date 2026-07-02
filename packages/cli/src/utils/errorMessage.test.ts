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

  it("never yields '[object Object]' for a no-message object (the reported validate/inspect bug)", () => {
    const out = normalizeErrorMessage({ code: 42 });
    expect(out).not.toBe("[object Object]");
    expect(out).toContain("42");
  });

  it("surfaces a Puppeteer-style protocol error object via its message", () => {
    expect(normalizeErrorMessage({ name: "ProtocolError", message: "Target closed" })).toBe(
      "Target closed",
    );
  });

  it("surfaces a structured CDP error object (no message) instead of '[object Object]'", () => {
    // The shape snapshot/render can receive when a CDP/protocol rejection is a
    // plain object rather than an Error: no string `message`, only code + data.
    const out = normalizeErrorMessage({ code: -32000, data: { reason: "navigation timeout" } });
    expect(out).not.toBe("[object Object]");
    expect(out).toContain("navigation timeout");
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
