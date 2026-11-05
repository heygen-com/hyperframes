import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  drainBrowserPool,
} from "./browserManager.js";

vi.mock("./chromeStartup.js", async (importActual) => ({
  ...(await importActual<typeof import("./chromeStartup.js")>()),
  explainChromeLaunchFailure: async (error: unknown) => error,
}));

const chrome = () => ({
  connected: true,
  newPage: vi.fn().mockResolvedValue({ evaluate: vi.fn() }),
  version: vi.fn().mockResolvedValue("HeadlessChrome/152.0.7977.30"),
  close: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  process: () => ({ kill: vi.fn(), killed: false }),
});

const denied = new Error(
  "Failed to launch: bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)",
);

describe("engine Chrome launch inside an agent seatbelt", () => {
  beforeEach(() => {
    vi.stubEnv("PRODUCER_HEADLESS_SHELL_PATH", process.execPath);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _resetAutoBrowserGpuModeCacheForTests();
    _setPuppeteerForTests(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retries once in one process over a pipe when the mach service is refused", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const launch = vi.fn<(options: LaunchOptions) => Promise<ReturnType<typeof chrome>>>();
    launch.mockRejectedValueOnce(denied).mockResolvedValue(chrome());
    _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
    const lease = await acquireBrowser(["--no-sandbox"], { forceScreenshot: true });
    await lease.release();
    expect(launch).toHaveBeenCalledTimes(2);
    const [first, second] = launch.mock.calls.map(([options]) => options);
    expect(first?.args).not.toContain("--single-process");
    expect(second?.pipe).toBe(true);
    expect(second?.args).toContain("--single-process");
  });

  it("launches one process over a pipe at once when the host names a seatbelt", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    const launch = vi.fn(async (_options: LaunchOptions) => chrome());
    _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
    const lease = await acquireBrowser(["--no-sandbox"], { forceScreenshot: true });
    await lease.release();
    const calls = launch.mock.calls.map(([options]) => options);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pipe).toBe(true);
    expect(calls[0]?.args).toContain("--single-process");
  });

  it.each([
    ["a refused mach service", denied],
    ["a pipe launch that closed", Object.assign(new Error("closed"), { name: "TargetCloseError" })],
  ])("on Linux launches once and keeps %s as the failure", async (_, failure) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    const launch = vi.fn<(options: LaunchOptions) => Promise<ReturnType<typeof chrome>>>();
    launch.mockRejectedValue(failure);
    _setPuppeteerForTests({
      launch,
      defaultArgs: vi.fn().mockResolvedValue([]),
    } as unknown as PuppeteerNode);
    const error = await acquireBrowser(["--no-sandbox"], { forceScreenshot: true }).catch((e) => e);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0].args).not.toContain("--single-process");
    expect(error).toBe(failure);
  });
});
