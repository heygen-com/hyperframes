import { describe, expect, it } from "vitest";
import { createStallClock } from "./stallClock.js";

describe("createStallClock", () => {
  it("does not count a suspended stretch as silence", () => {
    let now = 0;
    const clock = createStallClock(() => now);
    now = 5_000;
    expect(clock.idle(5_000)).toBe(5_000);
    now += 10 * 3_600_000;
    expect(clock.idle(5_000)).toBe(5_000);
    now += 5_000;
    expect(clock.idle(5_000)).toBe(10_000);
  });

  it("counts on-time looks without progress, and starts again at progress", () => {
    let now = 0;
    const clock = createStallClock(() => now);
    let idle = 0;
    for (let i = 0; i < 13; i++) {
      now += 5_000;
      idle = clock.idle(5_000);
    }
    expect(idle).toBe(65_000);
    clock.reset();
    now += 5_000;
    expect(clock.idle(5_000)).toBe(5_000);
  });
});
