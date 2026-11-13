import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  drainBrowserPool,
} from "./browserManager.js";
import { _resetChromeSandboxFallbackForTests } from "./chromeSandbox.js";

const explained = vi.hoisted(() => [] as (readonly string[] | undefined)[]);

vi.mock("./chromeStartup.js", async (importActual) => ({
  ...(await importActual<typeof import("./chromeStartup.js")>()),
  explainChromeLaunchFailure: async (error: unknown, _path: unknown, args?: readonly string[]) => {
    explained.push(args);
    return error;
  },
}));

const closedTarget = () =>
  Object.assign(new Error("Protocol error: Target closed"), { name: "TargetCloseError" });

describe("the startup diagnosis after a sandboxed launch and its retry both fail", () => {
  beforeEach(() => {
    explained.length = 0;
    _resetChromeSandboxFallbackForTests();
    vi.stubEnv("PRODUCER_HEADLESS_SHELL_PATH", process.execPath);
    vi.stubEnv("HYPERFRAMES_CHROME_SANDBOX", "");
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _setPuppeteerForTests(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("describes the retry's args, which produced the surfaced error", async () => {
    const retryError = closedTarget();
    const launch = vi.fn<(options: LaunchOptions) => Promise<never>>();
    launch.mockRejectedValueOnce(closedTarget()).mockRejectedValueOnce(retryError);
    const defaultArgs = vi.fn(async (options: { args?: string[] }) => options.args ?? []);
    _setPuppeteerForTests({ launch, defaultArgs } as unknown as PuppeteerNode);

    const error = await acquireBrowser(["--headless"], { forceScreenshot: true }).catch((e) => e);

    expect(error).toBe(retryError);
    expect(launch.mock.calls.map(([options]) => options.args?.includes("--no-sandbox"))).toEqual([
      false,
      true,
    ]);
    expect(explained).toHaveLength(1);
    expect(explained[0]).toEqual(expect.arrayContaining(["--headless", "--no-sandbox"]));
  });
});
