import { describe, expect, it, vi } from "vitest";
import { ThumbnailGenerationCoordinator } from "./thumbnailGenerationCoordinator";

function deferred() {
  let resolve!: (value: Buffer | null) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Buffer | null>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("ThumbnailGenerationCoordinator", () => {
  it("deduplicates same-key leases and bounds different-key concurrency", async () => {
    const coordinator = new ThumbnailGenerationCoordinator(2);
    const first = deferred();
    const second = deferred();
    const starts: string[] = [];
    const signal = new AbortController().signal;
    const a = coordinator.acquire("a", signal, async () => {
      starts.push("a");
      return first.promise;
    });
    const duplicateWork = vi.fn(async () => Buffer.from("wrong"));
    const duplicate = coordinator.acquire("a", signal, duplicateWork);
    const b = coordinator.acquire("b", signal, async () => {
      starts.push("b");
      return second.promise;
    });
    const c = coordinator.acquire("c", signal, async () => {
      starts.push("c");
      return Buffer.from("c");
    });

    expect(starts).toEqual(["a", "b"]);
    first.resolve(Buffer.from("a"));
    second.resolve(Buffer.from("b"));
    await expect(Promise.all([a, duplicate, b, c])).resolves.toEqual([
      Buffer.from("a"),
      Buffer.from("a"),
      Buffer.from("b"),
      Buffer.from("c"),
    ]);
    expect(duplicateWork).not.toHaveBeenCalled();
    expect(starts).toEqual(["a", "b", "c"]);
  });

  it("keeps shared work alive until its final lease leaves", async () => {
    const coordinator = new ThumbnailGenerationCoordinator();
    const firstController = new AbortController();
    const secondController = new AbortController();
    let workSignal: AbortSignal | undefined;
    const work = deferred();
    const first = coordinator.acquire("shared", firstController.signal, async (signal) => {
      workSignal = signal;
      return work.promise;
    });
    const second = coordinator.acquire("shared", secondController.signal, vi.fn());

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(workSignal?.aborted).toBe(false);
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workSignal?.aborted).toBe(true);
    work.reject(new DOMException("Aborted", "AbortError"));
    await vi.waitFor(() => expect(coordinator.protectedKeys().size).toBe(0));
  });

  it("removes an unleased queued job without starting it", async () => {
    const coordinator = new ThumbnailGenerationCoordinator(1);
    const activeWork = deferred();
    const active = coordinator.acquire(
      "active",
      new AbortController().signal,
      async () => activeWork.promise,
    );
    const queuedController = new AbortController();
    const queuedWork = vi.fn(async () => Buffer.from("queued"));
    const queued = coordinator.acquire("queued", queuedController.signal, queuedWork);

    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    activeWork.resolve(Buffer.from("active"));
    await expect(active).resolves.toEqual(Buffer.from("active"));
    expect(queuedWork).not.toHaveBeenCalled();
  });

  it("does not attach a new lease to work already aborted by its final lease", async () => {
    const coordinator = new ThumbnailGenerationCoordinator();
    const firstController = new AbortController();
    const firstWork = deferred();
    const first = coordinator.acquire(
      "same",
      firstController.signal,
      async () => firstWork.promise,
    );
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    const replacementWork = vi.fn(async () => Buffer.from("replacement"));
    const replacement = coordinator.acquire("same", new AbortController().signal, replacementWork);
    expect(replacementWork).not.toHaveBeenCalled();
    firstWork.reject(new DOMException("Aborted", "AbortError"));

    await expect(replacement).resolves.toEqual(Buffer.from("replacement"));
    expect(replacementWork).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue work for an already-aborted lease", async () => {
    const coordinator = new ThumbnailGenerationCoordinator();
    const controller = new AbortController();
    const work = vi.fn(async () => Buffer.from("unexpected"));
    controller.abort();

    await expect(coordinator.acquire("aborted", controller.signal, work)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(work).not.toHaveBeenCalled();
    expect(coordinator.protectedKeys().size).toBe(0);
  });
});
