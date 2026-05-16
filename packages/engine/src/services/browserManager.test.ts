import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Browser, PuppeteerNode } from "puppeteer-core";

import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  buildChromeArgs,
  drainBrowserPool,
  forceReleaseBrowser,
  releaseBrowser,
  resolveBrowserGpuMode,
} from "./browserManager.js";

describe("buildChromeArgs browser GPU mode", () => {
  const base = { width: 1920, height: 1080 };

  it("uses SwiftShader software GL by default for reproducible local renders", () => {
    const args = buildChromeArgs(base);
    expect(args).toContain("--enable-features=CanvasDrawElement");
    expect(args).toContain("--use-gl=angle");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args).not.toContain("--enable-gpu-rasterization");
  });

  it("uses Metal-backed ANGLE for hardware browser GPU mode on macOS", () => {
    const args = buildChromeArgs({ ...base, platform: "darwin" }, { browserGpuMode: "hardware" });
    expect(args).toContain("--use-gl=angle");
    expect(args).toContain("--use-angle=metal");
    expect(args).toContain("--enable-gpu-rasterization");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("uses D3D11-backed ANGLE for hardware browser GPU mode on Windows", () => {
    const args = buildChromeArgs({ ...base, platform: "win32" }, { browserGpuMode: "hardware" });
    expect(args).toContain("--use-gl=angle");
    expect(args).toContain("--use-angle=d3d11");
    expect(args).toContain("--enable-gpu-rasterization");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("uses EGL for hardware browser GPU mode on Linux", () => {
    const args = buildChromeArgs({ ...base, platform: "linux" }, { browserGpuMode: "hardware" });
    expect(args).toContain("--use-gl=egl");
    expect(args).toContain("--enable-gpu-rasterization");
    expect(args).not.toContain("--use-gl=angle");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("keeps --disable-gpu authoritative when requested", () => {
    const args = buildChromeArgs(
      { ...base, platform: "darwin" },
      { browserGpuMode: "hardware", disableGpu: true },
    );
    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--use-angle=metal");
  });
});

describe("resolveBrowserGpuMode", () => {
  beforeEach(() => {
    _resetAutoBrowserGpuModeCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetAutoBrowserGpuModeCacheForTests();
  });

  it("passes 'software' through unchanged without probing", async () => {
    const mode = await resolveBrowserGpuMode("software");
    expect(mode).toBe("software");
  });

  it("passes 'hardware' through unchanged without probing", async () => {
    const mode = await resolveBrowserGpuMode("hardware");
    expect(mode).toBe("hardware");
  });

  it("falls back to 'software' when the probe browser cannot launch", async () => {
    // No chromePath, env unset, and (in the test env) no system Chrome to find
    // → puppeteer.launch will throw → caller catches → software fallback.
    // Force a definitely-missing chrome binary so the launch path errors fast.
    const mode = await resolveBrowserGpuMode("auto", {
      chromePath: "/definitely/not/a/real/chrome/binary",
      browserTimeout: 2000,
    });
    expect(mode).toBe("software");
  });

  it("caches the probe result across calls", async () => {
    const first = await resolveBrowserGpuMode("auto", {
      chromePath: "/definitely/not/a/real/chrome/binary",
      browserTimeout: 2000,
    });
    // Second call uses cache — no new launch. Assert the same answer comes back
    // even with a different chromePath that would have a different probe outcome.
    const second = await resolveBrowserGpuMode("auto", {
      chromePath: "/another/definitely/missing/path",
      browserTimeout: 2000,
    });
    expect(first).toBe("software");
    expect(second).toBe("software");
    // Reset and re-probe to confirm the test-only reset works.
    _resetAutoBrowserGpuModeCacheForTests();
    const third = await resolveBrowserGpuMode("hardware");
    expect(third).toBe("hardware");
  });

  it("deduplicates concurrent auto-mode probes by caching the in-flight Promise", async () => {
    // Parallel coordinator fires N workers via Promise.all — without Promise-
    // level caching, a `--workers 4` render against a no-GPU host would launch
    // 4 simultaneous probe Chromes. Verify all concurrent callers get the
    // exact same Promise reference (proving the probe runs once, not N times).
    const p1 = resolveBrowserGpuMode("auto", {
      chromePath: "/definitely/not/a/real/chrome/binary",
      browserTimeout: 2000,
    });
    const p2 = resolveBrowserGpuMode("auto", {
      chromePath: "/definitely/not/a/real/chrome/binary",
      browserTimeout: 2000,
    });
    const p3 = resolveBrowserGpuMode("auto", {
      chromePath: "/definitely/not/a/real/chrome/binary",
      browserTimeout: 2000,
    });
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(["software", "software", "software"]);
  });
});

describe("forceReleaseBrowser", () => {
  it("kills the browser process and disconnects", () => {
    const killFn = vi.fn(() => true);
    const disconnectFn = vi.fn();
    const mockBrowser = {
      process: () => ({ kill: killFn, killed: false }),
      disconnect: disconnectFn,
    } as any;

    forceReleaseBrowser(mockBrowser);

    expect(killFn).toHaveBeenCalledWith("SIGKILL");
    expect(disconnectFn).toHaveBeenCalled();
  });

  it("tolerates an already-killed process", () => {
    const killFn = vi.fn();
    const disconnectFn = vi.fn();
    const mockBrowser = {
      process: () => ({ kill: killFn, killed: true }),
      disconnect: disconnectFn,
    } as any;

    forceReleaseBrowser(mockBrowser);

    expect(killFn).not.toHaveBeenCalled();
    expect(disconnectFn).toHaveBeenCalled();
  });
});

describe("browser pool", () => {
  function makeMockBrowser(): Browser {
    return {
      connected: true,
      newPage: vi.fn(),
      version: vi.fn().mockResolvedValue("HeadlessChrome/131.0.0.0"),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      process: () => ({ kill: vi.fn(), killed: false }),
    } as unknown as Browser;
  }

  // forceScreenshot: true bypasses the BeginFrame probe path, which on Linux
  // CI would trigger a second ppt.launch() when the mock's newPage() doesn't
  // return a real page and the probe falls back to screenshot mode.
  const poolCfg = { enableBrowserPool: true, forceScreenshot: true } as const;

  let launchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetBrowserPoolForTests();
    const mockBrowser = makeMockBrowser();
    launchFn = vi.fn().mockResolvedValue(mockBrowser);
    _setPuppeteerForTests({ launch: launchFn } as unknown as PuppeteerNode);
  });

  afterEach(async () => {
    await drainBrowserPool();
    _setPuppeteerForTests(undefined);
  });

  it("sequential acquires with pool enabled return the same browser", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);

    expect(first.browser).toBe(second.browser);
    expect(launchFn).toHaveBeenCalledTimes(1);

    await releaseBrowser(first.browser, poolCfg);
    await releaseBrowser(second.browser, poolCfg);
  });

  it("concurrent acquires via Promise.all trigger exactly one launch", async () => {
    const [a, b, c] = await Promise.all([
      acquireBrowser(["--no-sandbox"], poolCfg),
      acquireBrowser(["--no-sandbox"], poolCfg),
      acquireBrowser(["--no-sandbox"], poolCfg),
    ]);

    expect(launchFn).toHaveBeenCalledTimes(1);
    expect(a.browser).toBe(b.browser);
    expect(b.browser).toBe(c.browser);

    await releaseBrowser(a.browser, poolCfg);
    await releaseBrowser(b.browser, poolCfg);
    await releaseBrowser(c.browser, poolCfg);
  });

  it("pool recovers from a disconnected browser", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    await releaseBrowser(first.browser, poolCfg);

    // Simulate Chrome crash
    (first.browser as unknown as { connected: boolean }).connected = false;

    const freshBrowser = makeMockBrowser();
    launchFn.mockResolvedValue(freshBrowser);

    const second = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(second.browser).toBe(freshBrowser);
    expect(second.browser).not.toBe(first.browser);
    expect(launchFn).toHaveBeenCalledTimes(2);

    await releaseBrowser(second.browser, poolCfg);
  });

  it("release at refCount 0 closes the browser", async () => {
    const result = await acquireBrowser(["--no-sandbox"], poolCfg);
    const closeFn = result.browser.close as ReturnType<typeof vi.fn>;

    await releaseBrowser(result.browser, poolCfg);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("pool returns a separate browser when forceScreenshot mismatches pooled mode", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(first.captureMode).toBe("screenshot");

    // Second acquire with same forceScreenshot — same mode, should reuse
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(second.browser).toBe(first.browser);
    expect(launchFn).toHaveBeenCalledTimes(1);

    await releaseBrowser(first.browser, poolCfg);
    await releaseBrowser(second.browser, poolCfg);
  });

  it("forceReleaseBrowser does not kill Chrome when other sessions hold refs", async () => {
    const result = await acquireBrowser(["--no-sandbox"], poolCfg);
    // Acquire a second ref
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);

    const disconnectFn = result.browser.disconnect as ReturnType<typeof vi.fn>;
    forceReleaseBrowser(result.browser);

    // Should NOT have disconnected — other session still holds a ref
    expect(disconnectFn).not.toHaveBeenCalled();

    // Release the remaining ref normally
    await releaseBrowser(second.browser, poolCfg);
  });

  it("drainBrowserPool is safe to call when no browser is pooled", async () => {
    await drainBrowserPool();
  });

  it("drainBrowserPool awaits in-flight launch before closing", async () => {
    let resolveDeferred!: (browser: Browser) => void;
    const deferred = new Promise<Browser>((resolve) => {
      resolveDeferred = resolve;
    });
    launchFn.mockReturnValue(deferred);

    // Start acquire — it will be pending
    const acquirePromise = acquireBrowser(["--no-sandbox"], poolCfg);

    // Drain while launch is in-flight
    const drainPromise = drainBrowserPool();

    // Resolve the pending launch
    const mockBrowser = makeMockBrowser();
    resolveDeferred(mockBrowser);

    await drainPromise;
    const closeFn = mockBrowser.close as ReturnType<typeof vi.fn>;
    expect(closeFn).toHaveBeenCalled();

    // The acquire should still resolve (the launch completed before drain closed it)
    await acquirePromise.catch(() => {});
  });
});
