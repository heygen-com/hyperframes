import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_DECODE_TIMEOUT_MS, AudioDecodeTimeoutError, decodeShared } from "./audioDecodes.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("decodeShared", () => {
  it("stops a decode that runs past its time limit, and frees its slot", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const stalled = (_path: string, signal: AbortSignal) =>
      new Promise<number[]>((_resolve, reject) => {
        seen = signal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });

    const result = decodeShared("stalled-key", "/media/a.wav", stalled);
    const settled = expect(result).rejects.toBeInstanceOf(AudioDecodeTimeoutError);
    await vi.advanceTimersByTimeAsync(AUDIO_DECODE_TIMEOUT_MS);
    await settled;
    expect(seen?.aborted).toBe(true);

    vi.useRealTimers();
    await expect(decodeShared("next-key", "/media/b.wav", async () => [0.5])).resolves.toEqual([
      0.5,
    ]);
  });
});
