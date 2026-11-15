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

describe("validateDistributedRenderConfig minParallelChunks", () => {
  const mp4 = { ...base, format: "mp4" } as const;
  it("accepts a floor up to the chunk ceiling and refuses one outside it", () => {
    expect(() => validateDistributedRenderConfig({ ...mp4, minParallelChunks: 4 })).not.toThrow();
    expect(() => validateDistributedRenderConfig({ ...mp4, minParallelChunks: 0 })).toThrow(
      "config.minParallelChunks",
    );
    expect(() => validateDistributedRenderConfig({ ...mp4, minParallelChunks: 257 })).toThrow(
      "must be <= 256",
    );
  });
});

describe("validateDistributedRenderConfig pageMotionBlur", () => {
  it("accepts off, the one value that stands the page's blur down, and no value", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base, format: "mp4", pageMotionBlur: "off" }),
    ).not.toThrow();
    expect(() => validateDistributedRenderConfig({ ...base, format: "mp4" })).not.toThrow();
  });

  it("refuses any other value", () => {
    for (const value of ["on", "distributed-render", "hdr-render", ""]) {
      expect(() =>
        validateDistributedRenderConfig({
          ...base,
          format: "mp4",
          pageMotionBlur: value as unknown as "off",
        }),
      ).toThrow('must be "off" when provided');
    }
  });
});
