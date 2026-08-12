import { describe, expect, it } from "vitest";

import { loadBpmDetective } from "./beatDetection";

describe("loadBpmDetective", () => {
  it("resolves to null when the import is unavailable", async () => {
    const detect = await loadBpmDetective(() => Promise.reject(new Error("missing")));
    expect(detect).toBeNull();
  });

  it("retries a previously failed import instead of caching null forever", async () => {
    let shouldFail = true;
    const importFn = async () => {
      if (shouldFail) {
        throw new Error("transient");
      }
      return { default: () => 120 };
    };

    const first = await loadBpmDetective(importFn);
    expect(first).toBeNull();

    shouldFail = false;
    const second = await loadBpmDetective(importFn);
    expect(second).not.toBeNull();
    expect(second?.({} as AudioBuffer)).toBe(120);
  });

  it("uses the default export if present, otherwise the module object", async () => {
    const importFn = async () => ({ default: () => 90 });
    const detect = await loadBpmDetective(importFn);
    expect(detect?.({} as AudioBuffer)).toBe(90);
  });

  it("falls back to the module object when there is no default export", async () => {
    const fn = (buffer: AudioBuffer) => buffer.duration;
    const importFn = async () => fn as unknown;
    const detect = await loadBpmDetective(importFn);
    expect(detect).toBe(fn);
  });
});
