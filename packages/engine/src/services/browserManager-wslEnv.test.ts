import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  captureWithoutWaylandDisplay,
  drainBrowserPool,
  resolveBrowserGpuMode,
} from "./browserManager.js";

const wsl = {
  platform: "linux" as const,
  release: "6.6.87.2-microsoft-standard-WSL2",
  readProcVersion: () => "Linux version 6.6.87.2-microsoft-standard-WSL2",
  renderNodeAccess: () => ({ state: "read-write" as const }),
};
const D3D12 = {
  hasWebGL: true,
  vendor: "Google Inc. (Microsoft Corporation)",
  renderer: "ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 4070 SUPER))",
};
const NO_WEBGL = { hasWebGL: false, vendor: "", renderer: "" };

/** Chrome that reaches the GPU only when `reachesGpu(env)` holds for its launch env. */
function fakeChrome(reachesGpu: (env: NodeJS.ProcessEnv | undefined) => boolean) {
  const launch = vi.fn(async (options: LaunchOptions) => ({
    connected: true,
    newPage: vi.fn().mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(reachesGpu(options.env) ? D3D12 : NO_WEBGL),
    }),
    version: vi.fn().mockResolvedValue("HeadlessChrome/152.0.7977.30"),
    close: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    process: () => ({ kill: vi.fn(), killed: false }),
  }));
  _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
  return launch;
}
const offWayland = (env: NodeJS.ProcessEnv | undefined) =>
  env !== undefined && env.WAYLAND_DISPLAY === undefined;

// heygen-com/hyperframes#5548: Chrome 150+ under WSLg finds no GPU while WAYLAND_DISPLAY is set.
describe("WSL GPU without WAYLAND_DISPLAY", () => {
  const savedWayland = process.env.WAYLAND_DISPLAY;

  beforeEach(() => {
    process.env.WAYLAND_DISPLAY = "wayland-0";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    await drainBrowserPool();
    _resetBrowserPoolForTests();
    _resetAutoBrowserGpuModeCacheForTests();
    _setPuppeteerForTests(undefined);
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = savedWayland;
    vi.restoreAllMocks();
  });

  it("renders on the GPU without WAYLAND_DISPLAY when only that reaches it", async () => {
    const launch = fakeChrome(offWayland);
    expect(await resolveBrowserGpuMode("auto", { platform: "linux", wslHost: wsl })).toBe(
      "hardware",
    );
    const withoutWaylandDisplay = await captureWithoutWaylandDisplay("hardware");
    expect(withoutWaylandDisplay).toBe(true);
    const lease = await acquireBrowser(["--no-sandbox"], {
      forceScreenshot: true,
      withoutWaylandDisplay,
    });
    await lease.release();

    const envs = launch.mock.calls.map(([options]) => options.env);
    expect(envs[0]).toMatchObject({ WAYLAND_DISPLAY: "wayland-0" });
    expect(envs[1]).toMatchObject({ PATH: process.env.PATH });
    expect(envs[1]).not.toHaveProperty("WAYLAND_DISPLAY");
    expect(envs[2]).not.toHaveProperty("WAYLAND_DISPLAY");
  });

  it("keeps the inherited environment when neither probe reaches the GPU", async () => {
    const launch = fakeChrome(() => false);
    expect(await resolveBrowserGpuMode("auto", { platform: "linux", wslHost: wsl })).toBe(
      "software",
    );
    expect(await captureWithoutWaylandDisplay("hardware")).toBe(false);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("keeps the inherited environment when the first probe reaches the GPU", async () => {
    const launch = fakeChrome(() => true);
    expect(await resolveBrowserGpuMode("auto", { platform: "linux", wslHost: wsl })).toBe(
      "hardware",
    );
    expect(await captureWithoutWaylandDisplay("hardware")).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("never drops WAYLAND_DISPLAY for a software render", async () => {
    fakeChrome(offWayland);
    await resolveBrowserGpuMode("auto", { platform: "linux", wslHost: wsl });
    expect(await captureWithoutWaylandDisplay("software")).toBe(false);
  });

  it("tries only once outside WSL", async () => {
    const launch = fakeChrome(offWayland);
    const linux = { ...wsl, release: "6.8.0-45-generic", readProcVersion: () => "Linux 6.8.0" };
    expect(await resolveBrowserGpuMode("auto", { platform: "linux", wslHost: linux })).toBe(
      "software",
    );
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
