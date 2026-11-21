import { TimeoutError, type Browser } from "puppeteer-core";
import { describe, expect, it, vi } from "vitest";
import { closeTestChrome, launchTestChrome, warmTestChrome } from "./chromeTestUtils";

vi.mock("../vite.browser", () => ({
  findSystemChrome: () => "/test/chrome",
  browserVersion: () => "Chrome 152.0.7977.30",
}));

const fakeBrowser = (close: () => Promise<void>) => {
  const kill = vi.fn();
  const disconnect = vi.fn(async () => undefined);
  const browser = { close, disconnect, process: () => ({ kill }) } as unknown as Browser;
  return { browser, kill, disconnect };
};

describe("closeTestChrome", () => {
  it("kills a Chrome whose close never finishes", async () => {
    const { browser, kill, disconnect } = fakeBrowser(() => new Promise(() => undefined));
    await closeTestChrome(browser, 0);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("leaves a Chrome that closed alone", async () => {
    const { browser, kill } = fakeBrowser(async () => undefined);
    await closeTestChrome(browser, 60_000);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("warmTestChrome", () => {
  it("starts Chrome once with the launcher's flags, closes it and says how long it took", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const close = vi.fn(async () => undefined);
      const launch = vi.fn().mockResolvedValue(fakeBrowser(close).browser);
      await warmTestChrome(launch);
      expect(launch).toHaveBeenCalledOnce();
      expect(launch.mock.calls[0]?.[0]).toMatchObject({
        executablePath: "/test/chrome",
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        timeout: 60_000,
      });
      expect(close).toHaveBeenCalledOnce();
      expect(String(info.mock.calls[0]?.[0])).toMatch(/warm start took \d+ ms$/);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports a warm start that fails and lets the suite go on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const launch = vi.fn().mockRejectedValue(new Error("no usable sandbox"));
      await expect(warmTestChrome(launch)).resolves.toBeUndefined();
      expect(String(error.mock.calls[0]?.[0])).toMatch(
        /warm start failed after \d+ ms: no usable sandbox$/,
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("launchTestChrome", () => {
  it("names the selected browser and the failed attempt before retrying", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { browser } = fakeBrowser(async () => undefined);
      const failure = new TimeoutError("WS endpoint was not announced");
      const launch = vi
        .fn()
        .mockImplementationOnce(async () => {
          vi.advanceTimersByTime(20_000);
          throw failure;
        })
        .mockResolvedValueOnce(browser);
      await expect(launchTestChrome(launch)).resolves.toBe(browser);
      expect(info.mock.calls).toEqual([
        ["[studio-test-chrome] launch 1/2: /test/chrome (Chrome 152.0.7977.30)"],
        ["[studio-test-chrome] launch 2/2: /test/chrome (Chrome 152.0.7977.30)"],
        ["[studio-test-chrome] launch 2/2 ready after 0 ms"],
      ]);
      expect(error.mock.calls).toEqual([
        ["[studio-test-chrome] launch 1/2 failed after 20000 ms: WS endpoint was not announced"],
      ]);
    } finally {
      vi.useRealTimers();
      info.mockRestore();
      error.mockRestore();
    }
  });

  it("names a launch failure that is not an Error by what it holds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      // Puppeteer rejects a dropped DevTools socket with an event that holds the Error.
      const dropped = { error: new Error("read ECONNRESET") };
      await expect(launchTestChrome(vi.fn().mockRejectedValue(dropped))).rejects.toBe(dropped);
      expect(String(error.mock.calls[0]?.[0])).toContain("read ECONNRESET");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("stops after the second stuck launch and preserves its error", async () => {
    const failure = new TimeoutError("still stuck");
    const launch = vi.fn().mockRejectedValue(failure);
    await expect(launchTestChrome(launch)).rejects.toBe(failure);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("bounds each launch and tries once more after a stuck one", async () => {
    const { browser } = fakeBrowser(async () => undefined);
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError("stuck"))
      .mockResolvedValueOnce(browser);
    await expect(launchTestChrome(launch)).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch.mock.calls[0]![0]).toMatchObject({ timeout: 20_000, dumpio: true });
  });

  it("tries once more after a stuck launch that Windows reports as already running", async () => {
    vi.useFakeTimers();
    try {
      const { browser } = fakeBrowser(async () => undefined);
      const launch = vi
        .fn()
        .mockImplementationOnce(async () => {
          vi.advanceTimersByTime(20_000);
          throw new Error("The browser is already running for C:\\tmp\\x");
        })
        .mockResolvedValueOnce(browser);
      await expect(launchTestChrome(launch)).resolves.toBe(browser);
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills and retries a launch that hangs after Chrome announced its DevTools address", async () => {
    vi.useFakeTimers();
    try {
      const { browser } = fakeBrowser(async () => undefined);
      const launch = vi
        .fn()
        .mockImplementationOnce(
          ({ signal }: { signal?: AbortSignal }) =>
            new Promise((_, reject) =>
              signal?.addEventListener("abort", () => reject(new Error("Target closed"))),
            ),
        )
        .mockResolvedValueOnce(browser);
      const launched = launchTestChrome(launch);
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(launched).resolves.toBe(browser);
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a launch that failed for another reason", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("no such file"));
    await expect(launchTestChrome(launch)).rejects.toThrow("no such file");
    expect(launch).toHaveBeenCalledOnce();
  });
});
