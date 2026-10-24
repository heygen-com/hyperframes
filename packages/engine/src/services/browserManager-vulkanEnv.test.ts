import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import {
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  buildChromeArgs,
  drainBrowserPool,
} from "./browserManager.js";

const PINS = {
  VK_DRIVER_FILES: "/usr/share/vulkan/icd.d/radeon_icd.json",
  VK_LOADER_DRIVERS_SELECT: "*radeon*",
  VK_LOADER_DRIVERS_DISABLE: "*nvidia*",
};

function fakeChrome() {
  const launch = vi.fn(async (_options: LaunchOptions) => ({
    connected: true,
    version: vi.fn().mockResolvedValue("HeadlessChrome/155.0.8059.84"),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    process: () => ({ kill: vi.fn(), killed: false }),
  }));
  _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
  return launch;
}

async function launchEnvFor(browserGpuMode: "software" | "hardware") {
  const launch = fakeChrome();
  const args = buildChromeArgs({ width: 64, height: 64, platform: "linux" }, { browserGpuMode });
  const lease = await acquireBrowser(args, { forceScreenshot: true, enableBrowserPool: false });
  await lease.release();
  return launch.mock.calls[0]?.[0].env;
}

// A session that pins Vulkan to a GPU (VK_DRIVER_FILES) made --no-browser-gpu renders run ANGLE
// on that GPU, and assertSwiftShader refused them.
describe("SwiftShader launch environment", () => {
  const saved = Object.fromEntries(Object.keys(PINS).map((name) => [name, process.env[name]]));

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _setPuppeteerForTests(undefined);
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.restoreAllMocks();
  });

  it("drops the Vulkan driver pins for a software render and keeps the rest", async () => {
    Object.assign(process.env, PINS);
    const env = await launchEnvFor("software");
    expect(env).toMatchObject({ PATH: process.env.PATH });
    for (const name of Object.keys(PINS)) expect(env).not.toHaveProperty(name);
  });

  it("keeps the pins for a hardware render", async () => {
    Object.assign(process.env, PINS);
    expect(await launchEnvFor("hardware")).toBeUndefined();
  });

  it("inherits the environment when nothing pins a Vulkan driver", async () => {
    for (const name of Object.keys(PINS)) delete process.env[name];
    expect(await launchEnvFor("software")).toBeUndefined();
  });
});
