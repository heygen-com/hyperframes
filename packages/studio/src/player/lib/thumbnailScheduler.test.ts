import { describe, expect, it, vi } from "vitest";
import { resolveTimelineViewportBudgets } from "./timelineViewportBudgets";
import {
  createThumbnailKey,
  ThumbnailScheduler,
  type ThumbnailLoadedResult,
  type ThumbnailPriority,
  type ThumbnailRequest,
} from "./thumbnailScheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function result(name: string, weight = 1, dispose = vi.fn()): ThumbnailLoadedResult {
  return { value: { kind: "image", url: name, aspect: 1 }, weight, dispose };
}

function request(
  key: string,
  load: ThumbnailRequest["load"],
  priority: ThumbnailPriority = "visible",
  overrides: Partial<ThumbnailRequest> = {},
): ThumbnailRequest {
  return {
    key,
    projectId: "project-a",
    sessionEpoch: 1,
    kind: "image",
    priority,
    load,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ThumbnailScheduler", () => {
  it("deduplicates identical requests and releases subscribers independently", async () => {
    const scheduler = new ThumbnailScheduler();
    const pending = deferred<ThumbnailLoadedResult>();
    const load = vi.fn(() => pending.promise);
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const leaseA = scheduler.acquire(request("same", load), listenerA);
    const leaseB = scheduler.acquire(request("same", load), listenerB);
    expect(load).toHaveBeenCalledTimes(1);

    leaseA.release();
    listenerA.mockClear();
    pending.resolve(result("poster"));
    await flush();
    expect(scheduler.getSnapshot(request("same", load))).toMatchObject({
      status: "ready",
      value: { url: "poster" },
    });
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();

    leaseB.release();
    expect(scheduler.getDiagnostics().leases).toBe(0);
  });

  it("keeps snapshots referentially stable and supports independent leases sharing a callback", async () => {
    const scheduler = new ThumbnailScheduler();
    const listener = vi.fn();
    const shared = request("stable", async () => result("stable"));
    const first = scheduler.acquire(shared, listener);
    const second = scheduler.acquire(shared, listener);
    await flush();
    expect(scheduler.getSnapshot(shared)).toBe(scheduler.getSnapshot(shared));
    listener.mockClear();
    first.release();
    scheduler.invalidateProject("project-a");
    expect(listener).toHaveBeenCalledTimes(1);
    second.release();
  });

  it("orders interaction before visible before overscan when a slot opens", async () => {
    const scheduler = new ThumbnailScheduler(
      resolveTimelineViewportBudgets({ concurrentMetadataJobs: 1 }),
    );
    const first = deferred<ThumbnailLoadedResult>();
    const starts: string[] = [];
    const load = (name: string, pending?: ReturnType<typeof deferred<ThumbnailLoadedResult>>) =>
      vi.fn(() => {
        starts.push(name);
        return pending?.promise ?? Promise.resolve(result(name));
      });

    scheduler.acquire(request("first", load("first", first)), vi.fn());
    scheduler.acquire(request("overscan", load("overscan"), "overscan"), vi.fn());
    scheduler.acquire(request("visible", load("visible"), "visible"), vi.fn());
    scheduler.acquire(request("interaction", load("interaction"), "interaction"), vi.fn());
    expect(starts).toEqual(["first"]);

    first.resolve(result("first"));
    await vi.waitFor(() => {
      expect(starts).toEqual(["first", "interaction", "visible", "overscan"]);
    });
  });

  it("suspends new rich work while scrolling but lets posters proceed", async () => {
    const scheduler = new ThumbnailScheduler();
    const richLoad = vi.fn(async () => result("rich"));
    const posterLoad = vi.fn(async () => result("poster"));
    scheduler.setScrolling(true);

    scheduler.acquire(request("rich", richLoad, "interaction", { rich: true }), vi.fn());
    scheduler.acquire(request("poster", posterLoad), vi.fn());
    await flush();
    expect(richLoad).not.toHaveBeenCalled();
    expect(posterLoad).toHaveBeenCalledTimes(1);

    scheduler.setScrolling(false);
    await flush();
    expect(richLoad).toHaveBeenCalledTimes(1);
  });

  it("aborts queued and active jobs after the final release", async () => {
    const scheduler = new ThumbnailScheduler(
      resolveTimelineViewportBudgets({ concurrentVideoDecodes: 1 }),
    );
    const active = deferred<ThumbnailLoadedResult>();
    let activeSignal: AbortSignal | undefined;
    const activeLease = scheduler.acquire(
      request(
        "active",
        (signal) => {
          activeSignal = signal;
          return active.promise;
        },
        "visible",
        { kind: "video" },
      ),
      vi.fn(),
    );
    const queuedLoad = vi.fn(async () => result("queued"));
    const queuedLease = scheduler.acquire(
      request("queued", queuedLoad, "visible", { kind: "video" }),
      vi.fn(),
    );

    queuedLease.release();
    activeLease.release();
    expect(activeSignal?.aborted).toBe(true);
    expect(queuedLoad).not.toHaveBeenCalled();
    active.reject(new DOMException("aborted", "AbortError"));
    await flush();
    expect(scheduler.getDiagnostics()).toMatchObject({ queued: 0, active: 0, leases: 0 });
  });

  it("disposes a late result exactly once after project invalidation", async () => {
    const scheduler = new ThumbnailScheduler();
    const pending = deferred<ThumbnailLoadedResult>();
    const dispose = vi.fn();
    scheduler.acquire(
      request("late", () => pending.promise),
      vi.fn(),
    );

    scheduler.invalidateProject("project-a");
    pending.resolve(result("late", 1, dispose));
    await flush();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot(request("late", () => pending.promise))).toEqual({
      status: "idle",
    });
  });

  it("isolates late results by session epoch", async () => {
    const scheduler = new ThumbnailScheduler();
    const old = deferred<ThumbnailLoadedResult>();
    const oldRequest = request("poster", () => old.promise, "visible", { sessionEpoch: 1 });
    const nextRequest = request("poster", async () => result("next"), "visible", {
      sessionEpoch: 2,
    });
    scheduler.acquire(oldRequest, vi.fn());
    scheduler.acquire(nextRequest, vi.fn());
    await flush();
    old.resolve(result("old"));
    await flush();
    expect(scheduler.getSnapshot(nextRequest)).toMatchObject({
      status: "ready",
      value: { url: "next" },
    });
  });

  it("turns synchronous loader errors into bounded failure snapshots", async () => {
    const scheduler = new ThumbnailScheduler();
    const bad = request("throws", () => {
      throw new Error("sync failure");
    });
    const lease = scheduler.acquire(bad, vi.fn());
    await flush();
    expect(scheduler.getSnapshot(bad)).toMatchObject({ status: "error" });
    expect(scheduler.getDiagnostics().active).toBe(0);
    lease.release();
  });

  it("disposes uncached results after the final lease and tolerates broken disposers", async () => {
    const scheduler = new ThumbnailScheduler(
      resolveTimelineViewportBudgets({ thumbnailCacheBytes: 1 }),
    );
    const dispose = vi.fn(() => {
      throw new Error("cleanup failure");
    });
    const oversized = request("oversized", async () => result("large", 2, dispose));
    const lease = scheduler.acquire(oversized, vi.fn());
    await flush();
    expect(scheduler.getSnapshot(oversized).status).toBe("ready");
    expect(() => lease.release()).not.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot(oversized).status).toBe("idle");
  });

  it("evicts least-recently-used unleased values by bytes, count, and project count", async () => {
    const scheduler = new ThumbnailScheduler(
      resolveTimelineViewportBudgets({
        thumbnailCacheBytes: 6,
        thumbnailCacheEntries: 2,
        thumbnailCacheEntriesPerProject: 2,
      }),
    );
    const disposals = [vi.fn(), vi.fn(), vi.fn()];
    for (let index = 0; index < 3; index++) {
      const lease = scheduler.acquire(
        request(`key-${index}`, async () => result(`url-${index}`, 3, disposals[index])),
        vi.fn(),
      );
      await flush();
      lease.release();
    }

    expect(scheduler.getDiagnostics()).toMatchObject({ cacheEntries: 2, cacheBytes: 6 });
    expect(disposals[0]).toHaveBeenCalledTimes(1);
    expect(disposals[1]).not.toHaveBeenCalled();
    expect(disposals[2]).not.toHaveBeenCalled();
  });

  it("keeps failed requests quiet until the TTL expires", async () => {
    vi.useFakeTimers();
    const scheduler = new ThumbnailScheduler(
      resolveTimelineViewportBudgets({ metadataFailureTtlMs: 100 }),
    );
    const load = vi.fn(async () => {
      throw new Error("unsupported");
    });

    const first = scheduler.acquire(request("failed", load), vi.fn());
    await flush();
    first.release();
    const second = scheduler.acquire(request("failed", load), vi.fn());
    expect(load).toHaveBeenCalledTimes(1);
    second.release();

    vi.advanceTimersByTime(101);
    scheduler.acquire(request("failed", load), vi.fn());
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("createThumbnailKey", () => {
  it("normalizes field order and preserves sentinel zero values", () => {
    expect(createThumbnailKey({ source: "clip a", time: 0, missing: undefined })).toBe(
      createThumbnailKey({ time: 0, source: "clip a" }),
    );
  });
});
