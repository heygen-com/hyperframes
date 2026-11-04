import { describe, expect, it } from "bun:test";
import { validateDistributedRenderConfig } from "./renderConfigValidation.js";

const base = { fps: 30, width: 320, height: 240 } as const;

describe("validateDistributedRenderConfig proresProfile", () => {
  it("accepts a profile on a mov render", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base, format: "mov", proresProfile: "hq" }),
    ).not.toThrow();
  });

  it("refuses an unknown profile with the list, and a profile on any other format", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base, format: "mov", proresProfile: "422hq" }),
    ).toThrow("must be one of 4444, hq, 422, lt, proxy");
    expect(() =>
      validateDistributedRenderConfig({ ...base, format: "mp4", proresProfile: "hq" }),
    ).toThrow("applies to mov renders, not mp4");
  });
});
