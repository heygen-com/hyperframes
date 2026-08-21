import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnumFlag, parseIntFlag, parseNumericFlag } from "./parsing.js";
import { CliUsageError } from "../utils/commandResult.js";

describe("cloud/parsing", () => {
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
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
      expect(() => parseIntFlag("10abc", { flag: "--x" })).toThrow(CliUsageError);
    });

    it("rejects decimals", () => {
      expect(() => parseIntFlag("10.5", { flag: "--x" })).toThrow(CliUsageError);
    });

    it("enforces min", () => {
      expect(() => parseIntFlag("0", { flag: "--x", min: 1 })).toThrow(CliUsageError);
    });

    it("enforces max", () => {
      expect(() => parseIntFlag("101", { flag: "--x", max: 100 })).toThrow(CliUsageError);
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
      expect(() => parseNumericFlag("10seconds", { flag: "--x" })).toThrow(CliUsageError);
    });

    it("rejects NaN", () => {
      expect(() => parseNumericFlag("not-a-number", { flag: "--x" })).toThrow(CliUsageError);
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
      ).toThrow(CliUsageError);
    });

    it("returns undefined when raw is undefined", () => {
      expect(
        parseEnumFlag(undefined, ["draft", "standard", "high"], { flag: "--quality" }),
      ).toBeUndefined();
    });
  });
});
