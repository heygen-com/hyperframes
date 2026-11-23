import { describe, expect, it } from "bun:test";
import { procThreadStates, waitUntilIdle } from "./encoderPacing.js";

function scripted(sequence: Array<readonly string[] | null>) {
  let at = 0;
  return () => sequence[Math.min(at++, sequence.length - 1)] ?? null;
}

const fast = { pollMs: 0, calmPolls: 3, timeoutMs: 1_000, sleep: async () => {} };

describe("waitUntilIdle", () => {
  it("waits for several idle polls in a row", async () => {
    const states = [["R", "S"], ["S", "S"], ["S", "R"], ["S"], ["S", "S"], ["S", "S"], ["R"]];
    let polls = 0;
    const read = scripted(states);
    await waitUntilIdle(() => {
      polls++;
      return read();
    }, fast);
    // Busy, idle, busy (resets), then three idle polls.
    expect(polls).toBe(6);
  });

  it("counts uninterruptible waits as busy", async () => {
    let polls = 0;
    const read = scripted([["D"], ["S"], ["S"], ["S"]]);
    await waitUntilIdle(() => {
      polls++;
      return read();
    }, fast);
    expect(polls).toBe(4);
  });

  it("returns once the process is gone", async () => {
    await waitUntilIdle(scripted([["R"], null]), fast);
  });

  it("gives up after the timeout", async () => {
    let clock = 0;
    await expect(
      waitUntilIdle(() => ["R"], { ...fast, timeoutMs: 10, now: () => (clock += 4) }),
    ).rejects.toThrow("did not go idle within 10 ms");
  });

  it("stops on abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    await expect(
      waitUntilIdle(() => ["S"], { ...fast, signal: controller.signal }),
    ).rejects.toThrow("stopped");
  });
});

describe.skipIf(process.platform !== "linux")("procThreadStates", () => {
  it("reads a state letter for every thread of a live process", () => {
    const states = procThreadStates(process.pid);
    expect(states?.length).toBeGreaterThan(0);
    for (const state of states ?? []) expect(state).toMatch(/^[A-Za-z]$/);
  });

  it("is null for a process that does not exist", () => {
    expect(procThreadStates(2 ** 22 + 7)).toBeNull();
  });
});
