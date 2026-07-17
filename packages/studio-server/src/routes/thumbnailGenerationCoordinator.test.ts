import { describe, expect, it, vi } from "vitest";
import { ThumbnailGenerationCoordinator } from "./thumbnailGenerationCoordinator";

function deferred() {
  let resolve!: (value: Buffer | null) => void;
  const promise = new Promise<Buffer | null>((done) => (resolve = done));
  return { promise, resolve };
}

describe("ThumbnailGenerationCoordinator", () => {
  it("deduplicates same-key leases and serializes different keys", async () => {
    const coordinator = new ThumbnailGenerationCoordinator(1);
    const first = deferred();
    const starts: string[] = [];
    const signal = new AbortController().signal;
    const a = coordinator.acquire("a", signal, async () => {
      starts.push("a");
      return first.promise;
    });
    const duplicate = coordinator.acquire(
      "a",
      signal,
      vi.fn(async () => Buffer.from("wrong")),
    );
    const b = coordinator.acquire("b", signal, async () => {
      starts.push("b");
      return Buffer.from("b");
    });
    expect(starts).toEqual(["a"]);
    first.resolve(Buffer.from("a"));
    await expect(Promise.all([a, duplicate, b])).resolves.toEqual([
      Buffer.from("a"),
      Buffer.from("a"),
      Buffer.from("b"),
    ]);
    expect(starts).toEqual(["a", "b"]);
  });

  it("removes an unleased queued job and aborts the final active lease", async () => {
    const coordinator = new ThumbnailGenerationCoordinator(1);
    const activeController = new AbortController();
    const queuedController = new AbortController();
    const active = coordinator.acquire(
      "active",
      activeController.signal,
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
        ),
    );
    const queuedWork = vi.fn(async () => Buffer.from("queued"));
    const queued = coordinator.acquire("queued", queuedController.signal, queuedWork);
    queuedController.abort();
    activeController.abort();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(queuedWork).not.toHaveBeenCalled();
  });

  it("does not enqueue work for an already-aborted lease", async () => {
    const coordinator = new ThumbnailGenerationCoordinator(1);
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
