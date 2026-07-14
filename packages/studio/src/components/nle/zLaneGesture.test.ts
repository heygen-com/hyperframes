import { describe, expect, it, vi } from "vitest";
import { runZLaneGesture } from "./zLaneGesture";

const durable = { allMatched: true, changed: true };

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
      commitZ: async () => ({ allMatched: false, changed: true }),
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
