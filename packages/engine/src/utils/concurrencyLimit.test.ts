import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "./concurrencyLimit.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createConcurrencyLimit", () => {
  it("never runs more than the limit at once, and starts waiters in order", async () => {
    const limit = createConcurrencyLimit(2);
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    let running = 0;
    let peak = 0;
    const all = gates.map((gate, i) =>
      limit(async () => {
        started.push(i);
        peak = Math.max(peak, ++running);
        await gate.promise;
        running--;
      }),
    );
    await flush();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.resolve();
    gates[2]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    gates[3]!.resolve();
    gates[4]!.resolve();
    await Promise.all(all);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task fails", async () => {
    const limit = createConcurrencyLimit(1);
    const failing = limit(() => Promise.reject(new Error("ffmpeg failed")));
    const next = limit(async () => "ran");
    await expect(failing).rejects.toThrow("ffmpeg failed");
    await expect(next).resolves.toBe("ran");
  });
});
