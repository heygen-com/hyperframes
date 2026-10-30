import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installProgressLine } from "./installProtocol.js";

const worker = vi.hoisted(() => ({
  options: undefined as { signal: AbortSignal; onStdout: (chunk: string) => void } | undefined,
  finish: undefined as ((paths: string) => void) | undefined,
}));

vi.mock("../utils/cancellableProcess.js", () => ({
  runRenderSetupWorker: (_mode: string, _input: unknown, options: typeof worker.options) => {
    worker.options = options;
    return new Promise<string>((resolve, reject) => {
      worker.finish = resolve;
      options!.signal.addEventListener("abort", () => reject(options!.signal.reason));
    });
  },
}));

const { BrowserDownloadStalledError, installInChild } = await import("./installInChild.js");

const STALL_MS = 200;
const input = {
  browser: "chrome-headless-shell",
  buildId: "1",
  cacheDir: "/x",
  unpack: false,
} as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("installInChild stall watchdog", () => {
  it("does not call a download that keeps reporting progress a stall", async () => {
    const result = installInChild(input as never, {
      stallMs: STALL_MS,
      host: "h",
      onLog: () => {},
    });
    for (let downloaded = 1; downloaded <= 100; downloaded++) {
      await vi.advanceTimersByTimeAsync(STALL_MS - 1);
      worker.options!.onStdout(installProgressLine(downloaded, 1000));
    }
    expect(worker.options!.signal.aborted).toBe(false);
    worker.finish!("done");
    await expect(result).resolves.toBe("done");
  });

  it("aborts with the host and window once no progress arrives for the stall window", async () => {
    const result = installInChild(input as never, {
      stallMs: STALL_MS,
      host: "h",
      onLog: () => {},
    });
    const rejected = expect(result).rejects.toThrow(BrowserDownloadStalledError);
    worker.options!.onStdout(installProgressLine(1, 100));
    await vi.advanceTimersByTimeAsync(STALL_MS);
    await rejected;
    await expect(result).rejects.toThrow("The Chrome download from h stalled: no data for 0.2s.");
  });
});
