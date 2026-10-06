import { describe, expect, it, vi } from "vitest";

import { analyzeMusicFromBuffer, loadBpmDetective } from "./beatDetection";

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

describe("analyzeMusicFromBuffer", () => {
  it("waits on the caller's pause before each long stage", async () => {
    const sampleRate = 8000;
    const channel = new Float32Array(sampleRate * 2);
    for (let beat = 0; beat < 4; beat++) channel.fill(0.9, beat * 4000, beat * 4000 + 80);
    const audio = {
      getChannelData: () => channel,
      sampleRate,
      duration: 2,
    } as unknown as AudioBuffer;
    const held: (() => void)[] = [];
    const pause = () => new Promise<void>((resolve) => held.push(resolve));
    let done = false;
    const analysis = analyzeMusicFromBuffer(audio, { pause }).then((result) => {
      done = true;
      return result;
    });
    for (let stage = 1; stage <= 3; stage++) {
      await vi.waitFor(() => expect(held).toHaveLength(stage));
      expect(done).toBe(false);
      held[stage - 1]!();
    }
    await expect(analysis).resolves.toMatchObject({ sampleRate });
  });
});
