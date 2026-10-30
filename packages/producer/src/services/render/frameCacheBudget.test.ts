import { describe, expect, it } from "bun:test";
import { frameCacheOptions } from "./frameCacheBudget.js";

const cfg = { frameDataUriCacheLimit: 256, frameDataUriCacheBytesLimitMb: 1500 };

describe("frameCacheOptions", () => {
  it("gives each worker an equal part of the byte budget and keeps the entry limit", () => {
    expect(frameCacheOptions(cfg, 6)).toEqual({ ...cfg, frameDataUriCacheBytesLimitMb: 250 });
  });

  it("keeps the whole budget for one worker or before the worker count is known", () => {
    expect(frameCacheOptions(cfg, 1)).toEqual(cfg);
    expect(frameCacheOptions(cfg, undefined)).toEqual(cfg);
  });
});
