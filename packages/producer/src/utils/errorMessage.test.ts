import { describe, it, expect } from "vitest";
import { normalizeErrorMessage } from "./errorMessage.js";

describe("normalizeErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(normalizeErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("passes through strings", () => {
    expect(normalizeErrorMessage("oops")).toBe("oops");
  });

  it("extracts .message from plain objects", () => {
    expect(normalizeErrorMessage({ message: "hidden error" })).toBe("hidden error");
  });

  it("JSON-stringifies objects without .message", () => {
    expect(normalizeErrorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it("handles null", () => {
    expect(normalizeErrorMessage(null)).toBe("unknown error");
  });

  it("handles undefined", () => {
    expect(normalizeErrorMessage(undefined)).toBe("unknown error");
  });

  it("handles numbers", () => {
    expect(normalizeErrorMessage(42)).toBe("42");
  });

  it("handles objects with non-string .message", () => {
    expect(normalizeErrorMessage({ message: 123 })).toBe('{"message":123}');
  });

  it("handles circular references gracefully", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    // Falls through JSON.stringify failure to Object.keys()
    expect(normalizeErrorMessage(obj)).toBe("{self}");
  });
});
