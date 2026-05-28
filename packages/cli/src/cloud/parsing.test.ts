import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnumFlag, parseIntFlag, parseNumericFlag } from "./parsing.js";

describe("cloud/parsing", () => {
  // process.exit has signature `(code?) => never` which doesn't unify
  // with vi.spyOn's mock-function inference; cast through `unknown` so
  // the test compiles. The spy itself still records calls correctly.
  let exitSpy: { mockRestore: () => void } & { mock: { calls: unknown[][] } };
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as unknown as (code?: string | number | null) => never) as unknown as typeof exitSpy;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("parseIntFlag", () => {
    it("returns undefined when raw is undefined", () => {
      expect(parseIntFlag(undefined, { flag: "--x" })).toBeUndefined();
    });

    it("parses a clean integer", () => {
      expect(parseIntFlag("42", { flag: "--x" })).toBe(42);
    });

    it("rejects trailing garbage that Number.parseInt would silently accept", () => {
      expect(() => parseIntFlag("10abc", { flag: "--x" })).toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("rejects decimals", () => {
      expect(() => parseIntFlag("10.5", { flag: "--x" })).toThrow("process.exit called");
    });

    it("enforces min", () => {
      expect(() => parseIntFlag("0", { flag: "--x", min: 1 })).toThrow("process.exit called");
    });

    it("enforces max", () => {
      expect(() => parseIntFlag("101", { flag: "--x", max: 100 })).toThrow("process.exit called");
    });

    it("accepts negative integers when no min is set", () => {
      expect(parseIntFlag("-5", { flag: "--x" })).toBe(-5);
    });
  });

  describe("parseNumericFlag", () => {
    it("parses decimals", () => {
      expect(parseNumericFlag("1.5", { flag: "--x" })).toBe(1.5);
    });

    it("parses integers", () => {
      expect(parseNumericFlag("10", { flag: "--x" })).toBe(10);
    });

    it("rejects trailing garbage that Number.parseFloat would silently accept", () => {
      expect(() => parseNumericFlag("10seconds", { flag: "--x" })).toThrow("process.exit called");
    });

    it("rejects NaN", () => {
      expect(() => parseNumericFlag("not-a-number", { flag: "--x" })).toThrow(
        "process.exit called",
      );
    });
  });

  describe("parseEnumFlag", () => {
    it("accepts a known value", () => {
      expect(parseEnumFlag("draft", ["draft", "standard", "high"], { flag: "--quality" })).toBe(
        "draft",
      );
    });

    it("rejects an unknown value", () => {
      expect(() =>
        parseEnumFlag("ultra", ["draft", "standard", "high"], { flag: "--quality" }),
      ).toThrow("process.exit called");
    });

    it("returns undefined when raw is undefined", () => {
      expect(
        parseEnumFlag(undefined, ["draft", "standard", "high"], { flag: "--quality" }),
      ).toBeUndefined();
    });
  });
});
