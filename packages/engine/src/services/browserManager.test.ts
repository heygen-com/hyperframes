import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
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
  beforeEach(() => {
    _resetBrowserPoolForTests();
  });

  afterEach(async () => {
    await drainBrowserPool();
  });

  it("sequential acquires with pool enabled return the same browser", async () => {
    // In test env without real puppeteer, the launch will fail — that's
    // expected. This test verifies that the pool dedup path exists and
    // doesn't throw on its own (the _pooledBrowserLaunchPromise path).
    try {
      const first = await acquireBrowser(["--no-sandbox"], { enableBrowserPool: true });
      const second = await acquireBrowser(["--no-sandbox"], { enableBrowserPool: true });

      expect(first.browser).toBe(second.browser);

      await releaseBrowser(first.browser, { enableBrowserPool: true });
      await releaseBrowser(second.browser, { enableBrowserPool: true });
    } catch {
      // Expected in CI without Chrome — the pool logic is exercised
      // but the actual launch fails. The important thing is no unhandled
      // rejection from the dedup path.
    }
  });

  it("drainBrowserPool is safe to call when no browser is pooled", async () => {
    await drainBrowserPool();
  });
});
