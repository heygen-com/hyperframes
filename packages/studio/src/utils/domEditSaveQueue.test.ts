import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomEditSaveQueue } from "./domEditSaveQueue";
import { StudioSaveHttpError } from "./studioSaveDiagnostics";

describe("dom edit save queue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the breaker after consecutive failures and rejects new work until reset", async () => {
    const onOpen = vi.fn();
    const onReset = vi.fn();
    const queue = createDomEditSaveQueue({
      failureThreshold: 2,
      onOpen,
      onReset,
    });

    await expect(
      queue.enqueue(async () => {
        throw new StudioSaveHttpError("Server down", 503);
      }),
    ).rejects.toThrow("Server down");
    await expect(
      queue.enqueue(async () => {
        throw new StudioSaveHttpError("Still down", 503);
      }),
    ).rejects.toThrow("Still down");

    expect(onOpen).toHaveBeenCalledWith({
      consecutiveFailures: 2,
      errorMessage: "Still down",
      statusCode: 503,
    });

    let thirdRan = false;
    await expect(
      queue.enqueue(async () => {
        thirdRan = true;
      }),
    ).rejects.toThrow("Auto-save is paused");
    expect(thirdRan).toBe(false);

    queue.reset();
    expect(onReset).toHaveBeenCalledOnce();

    await queue.enqueue(async () => {
      thirdRan = true;
    });
    expect(thirdRan).toBe(true);
    queue.destroy();
  });

  it("keeps an open breaker paused even when already queued work succeeds", async () => {
    const onOpen = vi.fn();
    const onReset = vi.fn();
    const queue = createDomEditSaveQueue({
      failureThreshold: 1,
      onOpen,
      onReset,
    });

    let rejectFirst: ((error: Error) => void) | null = null;
    let resolveFirstStarted: (() => void) | null = null;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    const first = queue.enqueue(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
          resolveFirstStarted?.();
        }),
    );
    const second = queue.enqueue(async () => {});

    await firstStarted;
    expect(rejectFirst).toBeTypeOf("function");
    rejectFirst?.(new StudioSaveHttpError("Server down", 503));
    await expect(first).rejects.toThrow("Server down");
    await expect(second).resolves.toBeUndefined();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();

    await expect(queue.enqueue(async () => {})).rejects.toThrow("Auto-save is paused");

    queue.reset();
    expect(onReset).toHaveBeenCalledOnce();
    queue.destroy();
  });

  it("resets consecutive failures after a successful save", async () => {
    const onOpen = vi.fn();
    const queue = createDomEditSaveQueue({
      failureThreshold: 2,
      onOpen,
    });

    await expect(
      queue.enqueue(async () => {
        throw new Error("first failure");
      }),
    ).rejects.toThrow("first failure");

    await queue.enqueue(async () => {});

    await expect(
      queue.enqueue(async () => {
        throw new Error("second failure after success");
      }),
    ).rejects.toThrow("second failure after success");

    expect(onOpen).not.toHaveBeenCalled();
    queue.destroy();
  });
});
