import { describe, expect, it, vi } from "vitest";
import { parseTimeoutMs } from "./timeoutArg.js";

describe("parseTimeoutMs", () => {
  it("reads a bare number as milliseconds and units as written", () => {
    const warn = vi.fn();
    expect(parseTimeoutMs("45000", 3000, 0, warn)).toBe(45_000);
    expect(parseTimeoutMs("45000ms", 3000, 0, warn)).toBe(45_000);
    expect(parseTimeoutMs("45s", 3000, 0, warn)).toBe(45_000);
    expect(parseTimeoutMs("2m", 3000, 0, warn)).toBe(120_000);
    expect(parseTimeoutMs("1.5s", 3000, 0, warn)).toBe(1_500);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back when absent, zero or not a duration", () => {
    const warn = vi.fn();
    expect(parseTimeoutMs(undefined, 3000, 0, warn)).toBe(3000);
    expect(parseTimeoutMs("0", 3000, 0, warn)).toBe(3000);
    expect(parseTimeoutMs("soon", 3000, 0, warn)).toBe(3000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"soon"');
  });

  it("warns that a bare value under 1000 is milliseconds, and keeps it", () => {
    const warn = vi.fn();
    expect(parseTimeoutMs("45", 3000, 0, warn)).toBe(45);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("45 ms");
    expect(warn.mock.calls[0]![0]).toContain("45s");
  });

  it("names the value actually used when the floor raises it", () => {
    const warn = vi.fn();
    expect(parseTimeoutMs("45", 3000, 500, warn)).toBe(500);
    expect(warn.mock.calls[0]![0]).toContain("so 500 ms is used");
    expect(parseTimeoutMs("200ms", 3000, 500, warn)).toBe(500);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when a unit is given, even for a small value", () => {
    const warn = vi.fn();
    expect(parseTimeoutMs("500ms", 3000, 0, warn)).toBe(500);
    expect(warn).not.toHaveBeenCalled();
  });
});
