import { describe, expect, it, vi } from "vitest";
import type { Browser } from "puppeteer-core";
import { BrowserLeasePool, type BrowserLaunchFingerprint } from "./browserLeasePool.js";

function browser(name: string): Browser {
  return {
    connected: true,
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    process: () => null,
    version: vi.fn().mockResolvedValue(name),
  } as unknown as Browser;
}

function fingerprint(args: string[] = ["--one"]): BrowserLaunchFingerprint {
  return {
    args,
    executablePath: "/chrome",
    browserTimeoutMs: 1_000,
    protocolTimeoutMs: 2_000,
    requestedCaptureMode: "screenshot",
  };
}

describe("BrowserLeasePool", () => {
  it("shares only an exact immutable launch fingerprint", async () => {
    const firstBrowser = browser("first");
    const secondBrowser = browser("second");
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: firstBrowser, captureMode: "screenshot" as const })
      .mockResolvedValueOnce({ browser: secondBrowser, captureMode: "screenshot" as const });
    const pool = new BrowserLeasePool({
      launch,
      close: async (value) => value.close(),
      forceClose: vi.fn(),
    });
    const mutableArgs = ["--one"];
    const first = await pool.acquire(fingerprint(mutableArgs), true);
    mutableArgs.push("--mutated-after-acquire");
    const shared = await pool.acquire(fingerprint(), true);
    const isolated = await pool.acquire(fingerprint(["--two"]), true);

    expect(shared.browser).toBe(first.browser);
    expect(isolated.browser).toBe(secondBrowser);
    expect(first.fingerprint.args).toEqual(["--one"]);
    expect(Object.isFrozen(first.fingerprint)).toBe(true);
    expect(Object.isFrozen(first.fingerprint.args)).toBe(true);

    await Promise.all([first.release(), shared.release(), isolated.release()]);
  });

  it("removes a final lease from availability before awaiting close", async () => {
    const firstBrowser = browser("first");
    const secondBrowser = browser("second");
    let finishFirstClose!: () => void;
    const firstClose = new Promise<void>((resolve) => {
      finishFirstClose = resolve;
    });
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ browser: firstBrowser, captureMode: "screenshot" as const })
      .mockResolvedValueOnce({ browser: secondBrowser, captureMode: "screenshot" as const });
    const close = vi.fn((value: Browser) =>
      value === firstBrowser ? firstClose : Promise.resolve(),
    );
    const pool = new BrowserLeasePool({ launch, close, forceClose: vi.fn() });
    const first = await pool.acquire(fingerprint(), true);

    const releasing = first.release();
    const replacement = await pool.acquire(fingerprint(), true);

    expect(replacement.browser).toBe(secondBrowser);
    expect(launch).toHaveBeenCalledTimes(2);
    finishFirstClose();
    await releasing;
    await replacement.release();
  });

  it("makes lease release idempotent", async () => {
    const value = browser("only");
    const close = vi.fn().mockResolvedValue(undefined);
    const pool = new BrowserLeasePool({
      launch: vi.fn().mockResolvedValue({ browser: value, captureMode: "screenshot" }),
      close,
      forceClose: vi.fn(),
    });
    const lease = await pool.acquire(fingerprint(), true);

    await Promise.all([lease.release(), lease.release(), lease.release()]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous release through the shared browser handle", async () => {
    const value = browser("shared");
    const close = vi.fn().mockResolvedValue(undefined);
    const forceClose = vi.fn();
    const pool = new BrowserLeasePool({
      launch: vi.fn().mockResolvedValue({ browser: value, captureMode: "screenshot" }),
      close,
      forceClose,
    });
    const renderLease = await pool.acquire(fingerprint(), true);
    const thumbnailLease = await pool.acquire(fingerprint(), true);

    await expect(pool.releaseByBrowser(value)).rejects.toThrow(
      "Cannot release a pooled browser by handle while 2 leases are active",
    );
    pool.forceReleaseByBrowser(value);
    expect(close).not.toHaveBeenCalled();
    expect(forceClose).not.toHaveBeenCalled();

    await thumbnailLease.release();
    expect(close).not.toHaveBeenCalled();
    await renderLease.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed launch so the next acquire can recover", async () => {
    const recovered = browser("recovered");
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValueOnce({ browser: recovered, captureMode: "screenshot" as const });
    const pool = new BrowserLeasePool({
      launch,
      close: async (value) => value.close(),
      forceClose: vi.fn(),
    });

    await expect(pool.acquire(fingerprint(), true)).rejects.toThrow("launch failed");
    const lease = await pool.acquire(fingerprint(), true);

    expect(lease.browser).toBe(recovered);
    expect(launch).toHaveBeenCalledTimes(2);
    await lease.release();
  });

  it("drains an in-flight launch without returning the closing browser", async () => {
    const value = browser("pending");
    let finishLaunch!: () => void;
    const pendingLaunch = new Promise<{ browser: Browser; captureMode: "screenshot" }>(
      (resolve) => {
        finishLaunch = () => resolve({ browser: value, captureMode: "screenshot" });
      },
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const pool = new BrowserLeasePool({
      launch: vi.fn().mockReturnValue(pendingLaunch),
      close,
      forceClose: vi.fn(),
    });

    const acquiring = pool.acquire(fingerprint(), true);
    const draining = pool.drain();
    finishLaunch();

    await expect(acquiring).rejects.toThrow("drained during acquisition");
    await draining;
    expect(close).toHaveBeenCalledWith(value);
  });

  it("refuses acquire after close, even once the drain it started has resolved", async () => {
    const value = browser("only");
    const launch = vi.fn().mockResolvedValue({ browser: value, captureMode: "screenshot" });
    const pool = new BrowserLeasePool({
      launch,
      close: async (v) => v.close(),
      forceClose: vi.fn(),
    });
    const first = await pool.acquire(fingerprint(), true);
    const releasing = first.release();

    // drain()'s own drainPromise resets to null once it settles -- close()
    // must still refuse a request that arrives after that, not just a
    // request that raced the drain while it was in flight.
    await pool.close();
    await releasing;
    launch.mockClear();

    await expect(pool.acquire(fingerprint(), true)).rejects.toThrow(/pool is closed/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it("force-closes an entry whose graceful close hangs past drain's bound", async () => {
    vi.useFakeTimers();
    try {
      const value = browser("stuck");
      const forceClose = vi.fn();
      const pool = new BrowserLeasePool({
        launch: vi.fn().mockResolvedValue({ browser: value, captureMode: "screenshot" }),
        close: () => new Promise<void>(() => {}), // never resolves
        forceClose,
      });
      const lease = await pool.acquire(fingerprint(), true);
      const releasing = lease.release();

      const draining = pool.drain();
      await vi.advanceTimersByTimeAsync(1_100);
      await draining;
      await releasing;

      expect(forceClose).toHaveBeenCalledWith(value);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-flight launch immediately when its sole caller aborts, and evicts the entry", async () => {
    const first = browser("aborted");
    const recovered = browser("recovered");
    let launchSignal: AbortSignal | undefined;
    let resolveFirst!: (result: { browser: Browser; captureMode: "screenshot" }) => void;
    const launch = vi
      .fn()
      .mockImplementationOnce((_fp: BrowserLaunchFingerprint, signal?: AbortSignal) => {
        launchSignal = signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockResolvedValueOnce({ browser: recovered, captureMode: "screenshot" as const });
    const forceClose = vi.fn();
    const pool = new BrowserLeasePool({
      launch,
      close: async (v) => v.close(),
      forceClose,
    });

    const controller = new AbortController();
    const acquiring = pool.acquire(fingerprint(), true, controller.signal);
    controller.abort(new Error("caller aborted"));

    await expect(acquiring).rejects.toThrow("caller aborted");
    expect(launchSignal?.aborted).toBe(true);

    // Even if the cancelled launch still settles late, its browser is closed and never reused.
    resolveFirst({ browser: first, captureMode: "screenshot" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(forceClose).toHaveBeenCalledWith(first);

    const next = await pool.acquire(fingerprint(), true);
    expect(next.browser).toBe(recovered);
    await next.release();
  });

  it("keeps a shared in-flight launch alive when only one of two callers aborts", async () => {
    const shared = browser("shared");
    let launchSignal: AbortSignal | undefined;
    let resolveLaunch!: (result: { browser: Browser; captureMode: "screenshot" }) => void;
    const launch = vi.fn((_fp: BrowserLaunchFingerprint, signal?: AbortSignal) => {
      launchSignal = signal;
      return new Promise<{ browser: Browser; captureMode: "screenshot" }>((resolve) => {
        resolveLaunch = resolve;
      });
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const pool = new BrowserLeasePool({ launch, close, forceClose: vi.fn() });

    const firstController = new AbortController();
    const first = pool.acquire(fingerprint(), true, firstController.signal);
    const second = pool.acquire(fingerprint(), true);

    firstController.abort(new Error("first cancelled"));
    await expect(first).rejects.toThrow("first cancelled");
    expect(launchSignal?.aborted).toBe(false);

    resolveLaunch({ browser: shared, captureMode: "screenshot" });
    const lease = await second;
    expect(lease.browser).toBe(shared);
    expect(close).not.toHaveBeenCalled();

    await lease.release();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
