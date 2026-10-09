import { describe, expect, it } from "vitest";
import { createSegmentQueue } from "./segmentQueue.js";
import { planSegments } from "./segmentPlan.js";

describe("createSegmentQueue", () => {
  it("hands out every slice exactly once, in index order", () => {
    const slices = planSegments(7, 3);
    const queue = createSegmentQueue(slices);
    const taken = [queue.next(), queue.next(), queue.next()];
    expect(taken.map((s) => s?.index)).toEqual([0, 1, 2]);
    expect(queue.next()).toBeUndefined();
  });

  it("reports what is left and never goes negative past exhaustion", () => {
    const queue = createSegmentQueue(planSegments(4, 2));
    expect(queue.remaining()).toBe(2);
    queue.next();
    expect(queue.remaining()).toBe(1);
    queue.next();
    queue.next();
    queue.next();
    expect(queue.remaining()).toBe(0);
  });

  it("gives no slice to two callers", () => {
    // Interleaved pulls stand in for concurrent workers: the JS event loop
    // cannot preempt next(), so claiming is atomic by construction.
    const queue = createSegmentQueue(planSegments(6, 2));
    const a: number[] = [];
    const b: number[] = [];
    for (;;) {
      const first = queue.next();
      if (first) a.push(first.index);
      const second = queue.next();
      if (second) b.push(second.index);
      if (!first && !second) break;
    }
    expect([...a, ...b].sort((x, y) => x - y)).toEqual([0, 1, 2]);
    expect(new Set([...a, ...b]).size).toBe(3);
  });

  it("is empty for an empty slice list", () => {
    const queue = createSegmentQueue([]);
    expect(queue.next()).toBeUndefined();
    expect(queue.remaining()).toBe(0);
  });
});
