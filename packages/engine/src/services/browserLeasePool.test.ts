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
});
