import { describe, expect, it } from "vitest";
import { parsePositiveIntegerArg } from "./integerArg.js";

describe("parsePositiveIntegerArg", () => {
  it("returns undefined for an unset flag so the caller keeps its default", () => {
    expect(parsePositiveIntegerArg(undefined, "--timeout")).toBeUndefined();
  });

  it("accepts a positive whole number", () => {
    expect(parsePositiveIntegerArg("30", "--timeout")).toBe(30);
    expect(parsePositiveIntegerArg("1800", "--wait-seconds", { max: 1800 })).toBe(1800);
  });

  it.each(["abc", "-5", "0", "2.5", ""])("rejects %j as a usage error", (value) => {
    expect(() => parsePositiveIntegerArg(value, "--needed")).toThrow(
      expect.objectContaining({
        message: "--needed must be a positive integer",
        result: expect.objectContaining({ exitCode: 2, kind: "usage_error" }),
      }),
    );
  });

  it("rejects a value above max and names the range", () => {
    expect(() => parsePositiveIntegerArg("1801", "--wait-seconds", { max: 1800 })).toThrow(
      "--wait-seconds must be an integer from 1 to 1800",
    );
  });

  it("names the unit when one is given", () => {
    expect(() => parsePositiveIntegerArg("abc", "--timeout", { unit: "seconds" })).toThrow(
      "--timeout must be a positive integer number of seconds",
    );
  });
});
