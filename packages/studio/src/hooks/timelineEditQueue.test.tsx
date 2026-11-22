import { describe, expect, it } from "vitest";
import {
  enqueueTimelineEdit,
  refuseWithEarlier,
  type TimelineEditQueue,
} from "./timelineEditQueue";

function deferred() {
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((_, fail) => (reject = fail));
  return { promise, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("enqueueTimelineEdit", () => {
  // fails without the fix: A's failure cleared the tracking of B's save still in flight.
  it("refuses a ripple queued during a save that then fails, after an earlier save already failed", async () => {
    const queue: TimelineEditQueue = { current: Promise.resolve() };
    const a = deferred();
    const b = deferred();
    const writes: string[] = [];
    const first = enqueueTimelineEdit(queue, () => a.promise);
    const second = enqueueTimelineEdit(queue, () => b.promise);
    a.reject(new Error("A refused"));
    await expect(first).rejects.toThrow("A refused");
    await settle();

    const ripple = enqueueTimelineEdit(queue, async () => void writes.push("ripple"), {
      ifEarlierRefused: refuseWithEarlier,
    });
    b.reject(new Error("B refused"));

    await expect(second).rejects.toThrow("B refused");
    await expect(ripple).rejects.toThrow("refused");
    expect(writes).toEqual([]);
  });
});
