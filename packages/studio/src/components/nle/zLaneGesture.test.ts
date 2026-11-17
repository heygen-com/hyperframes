import { describe, expect, it, vi } from "vitest";
import {
  beginStudioPendingEdit,
  paintBackNewestStudioPendingEdit,
  setStudioPendingEditsSettled,
  trackStudioPendingEdit,
} from "../../utils/studioPendingEdits";
import { runLaneZGesture, runZLaneGesture } from "./zLaneGesture";

const durable = { durable: true, allMatched: true, changed: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runZLaneGesture", () => {
  it("runs the mirror after a durable z commit and resolves its result", async () => {
    const order: string[] = [];
    const result = await runZLaneGesture({
      commitZ: async () => {
        order.push("z");
        return durable;
      },
      mirror: async () => {
        order.push("mirror");
        return true;
      },
    });
    expect(result).toBe(true);
    expect(order).toEqual(["z", "mirror"]);
  });

  it("skips the mirror when the z commit reports unmatched targets", async () => {
    const mirror = vi.fn(async () => true);
    const result = await runZLaneGesture({
      commitZ: async () => ({ durable: false, allMatched: false, changed: true }),
      mirror,
    });
    expect(result).toBe(false);
    expect(mirror).not.toHaveBeenCalled();
  });

  it("still mirrors on a void resolution (empty-entries commit path)", async () => {
    const mirror = vi.fn(async () => true);
    await runZLaneGesture({ commitZ: async () => undefined, mirror });
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("serializes gestures: B's z phase waits for A's mirror phase", async () => {
    const order: string[] = [];
    const aMirrorGate = deferred<void>();

    const a = runZLaneGesture({
      commitZ: async () => {
        order.push("A:z");
        return durable;
      },
      mirror: async () => {
        await aMirrorGate.promise;
        order.push("A:mirror");
        return true;
      },
    });
    const b = runZLaneGesture({
      commitZ: async () => {
        order.push("B:z");
        return durable;
      },
      mirror: async () => {
        order.push("B:mirror");
        return true;
      },
    });

    // Give B every chance to start early — it must not.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["A:z"]);

    aMirrorGate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["A:z", "A:mirror", "B:z", "B:mirror"]);
  });

  it("holds a lane→z gesture until an overlapping z→lane gesture fully settles", async () => {
    const order: string[] = [];
    const mirrorGate = deferred<void>();
    const zFirst = runZLaneGesture({
      commitZ: async () => {
        order.push("z-first:z");
        return durable;
      },
      mirror: async () => {
        order.push("z-first:lane-start");
        await mirrorGate.promise;
        order.push("z-first:lane-end");
        return true;
      },
    });
    const laneFirst = runLaneZGesture({
      commitLane: async () => {
        order.push("lane-first:lane");
        return true;
      },
      commitZ: async () => {
        order.push("lane-first:z");
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["z-first:z", "z-first:lane-start"]);
    mirrorGate.resolve();
    await Promise.all([zFirst, laneFirst]);
    expect(order).toEqual([
      "z-first:z",
      "z-first:lane-start",
      "z-first:lane-end",
      "lane-first:lane",
      "lane-first:z",
    ]);
  });

  it("holds a z→lane gesture until an overlapping lane→z gesture fully settles", async () => {
    const order: string[] = [];
    const zGate = deferred<void>();
    const laneFirst = runLaneZGesture({
      commitLane: async () => {
        order.push("lane-first:lane");
        return true;
      },
      commitZ: async () => {
        order.push("lane-first:z-start");
        await zGate.promise;
        order.push("lane-first:z-end");
      },
    });
    const zFirst = runZLaneGesture({
      commitZ: async () => {
        order.push("z-first:z");
        return durable;
      },
      mirror: async () => {
        order.push("z-first:lane");
        return true;
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["lane-first:lane", "lane-first:z-start"]);
    zGate.resolve();
    await Promise.all([laneFirst, zFirst]);
    expect(order).toEqual([
      "lane-first:lane",
      "lane-first:z-start",
      "lane-first:z-end",
      "z-first:z",
      "z-first:lane",
    ]);
  });

  it("a failed gesture rejects its caller but never wedges the queue", async () => {
    const boom = new Error("z failed");
    const failed = runZLaneGesture({
      commitZ: async () => {
        throw boom;
      },
      mirror: async () => true,
    });
    await expect(failed).rejects.toBe(boom);

    const next = await runZLaneGesture({
      commitZ: async () => durable,
      mirror: async () => true,
    });
    expect(next).toBe(true);
  });
});

// fails without the fix: the z write settled before the lane mirror began, which closed the gesture's undo step.
describe("one undo step per gesture", () => {
  it.each([
    [
      "z then lanes",
      (first: () => Promise<void>, second: () => Promise<boolean>) =>
        runZLaneGesture({ commitZ: async () => void (await first()), mirror: second }),
    ],
    [
      "lanes then z",
      (first: () => Promise<void>, second: () => Promise<boolean>) =>
        runLaneZGesture({
          commitLane: async () => (await first(), true),
          commitZ: async () => void (await second()),
        }),
    ],
  ])(
    "a layer reorder (%s) is one undo step: Studio's edits stay pending between its two writes",
    async (_, gesture) => {
      const settled = vi.fn();
      setStudioPendingEditsSettled(settled);
      const secondWrite = deferred<boolean>();
      try {
        const done = gesture(
          () => trackStudioPendingEdit(Promise.resolve()) as Promise<void>,
          () => trackStudioPendingEdit(secondWrite.promise) as Promise<boolean>,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).not.toHaveBeenCalled();
        secondWrite.resolve(true);
        await done;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toHaveBeenCalledTimes(1);
      } finally {
        secondWrite.resolve(true);
        setStudioPendingEditsSettled(null);
      }
    },
  );

  it("Cmd+Z during a lane drag's save still paints that drag back at once", async () => {
    const revert = vi.fn(() => () => {});
    const save = deferred<void>();
    const done = runLaneZGesture({
      commitLane: async () => {
        beginStudioPendingEdit(revert).settle(save.promise);
        await save.promise;
        return true;
      },
      commitZ: async () => {},
    });
    try {
      expect(paintBackNewestStudioPendingEdit()).not.toBeNull();
      expect(revert).toHaveBeenCalledTimes(1);
    } finally {
      save.resolve();
      await done;
    }
  });
});
