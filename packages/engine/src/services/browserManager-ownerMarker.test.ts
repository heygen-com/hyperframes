import { HYPERFRAMES_BROWSER_MARKER_ARG } from "@hyperframes/core/browser-marker";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  drainBrowserPool,
  resolveBrowserGpuMode,
} from "./browserManager.js";

function fakeChrome(newPage = vi.fn().mockResolvedValue({ evaluate: vi.fn() })) {
  const launch = vi.fn(async (_options: LaunchOptions) => ({
    connected: true,
    newPage,
    version: vi.fn().mockResolvedValue("HeadlessChrome/152.0.7977.30"),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    process: () => ({ kill: vi.fn(), killed: false }),
  }));
  _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
  return launch;
}

const launchedArgs = (launch: ReturnType<typeof fakeChrome>) =>
  launch.mock.calls.map(([options]) => options.args ?? []);

describe("every engine Chrome carries the HyperFrames marker", () => {
  beforeEach(() => {
    vi.stubEnv("PRODUCER_HEADLESS_SHELL_PATH", process.execPath);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _resetAutoBrowserGpuModeCacheForTests();
    _setPuppeteerForTests(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("marks the GPU probe browser", async () => {
    const launch = fakeChrome();
    await resolveBrowserGpuMode("auto", { platform: "linux" });
    expect(launchedArgs(launch)[0]).toContain(HYPERFRAMES_BROWSER_MARKER_ARG);
  });

  it("marks the capture browser without changing the caller's args", async () => {
    const launch = fakeChrome();
    const args = ["--no-sandbox"];
    const lease = await acquireBrowser(args, { forceScreenshot: true });
    await lease.release();
    expect(launchedArgs(launch)).toEqual([["--no-sandbox", HYPERFRAMES_BROWSER_MARKER_ARG]]);
    expect(args).toEqual(["--no-sandbox"]);
  });

  it.runIf(process.platform === "linux")(
    "marks the screenshot relaunch after a failed beginFrame probe",
    async () => {
      const launch = fakeChrome(vi.fn().mockRejectedValue(new Error("no beginFrame")));
      const lease = await acquireBrowser(["--enable-begin-frame-control"], {
        forceScreenshot: false,
      });
      await lease.release();
      const args = launchedArgs(launch);
      expect(args).toHaveLength(2);
      for (const launched of args) expect(launched).toContain(HYPERFRAMES_BROWSER_MARKER_ARG);
    },
  );
});
