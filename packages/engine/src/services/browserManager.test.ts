// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, PuppeteerNode } from "puppeteer-core";

import type { CaptureMode } from "./browserLeasePool.js";

import {
  _resetAutoBrowserGpuModeCacheForTests,
  _resetBrowserPoolForTests,
  _closeBrowserAfterFailedProbeForTests,
  _createBrowserLaunchFingerprintForTests,
  _probeBeginFrameSupportForTests,
  _setPuppeteerForTests,
  acquireBrowser,
  buildChromeArgs,
  drainBrowserPool,
  forceReleaseBrowser,
  releaseBrowser,
  resolveHeadlessShellPath,
  resolveBrowserGpuMode,
} from "./browserManager.js";

describe("BeginFrame capability probe", () => {
  it("waits for a document and validates a PNG-returning frame", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ hasDamage: true, screenshotData: png.toString("base64") });
    const detach = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(null);
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = {
      newPage: vi.fn().mockResolvedValue({
        goto,
        createCDPSession: vi.fn().mockResolvedValue({ send, detach }),
        close,
      }),
    } as unknown as Browser;

    const result = await _probeBeginFrameSupportForTests(browser);

    expect(result.supported).toBe(true);
    expect(goto).toHaveBeenCalledWith(expect.stringContaining("hf-beginframe-probe"), {
      waitUntil: "domcontentloaded",
      timeout: 2000,
    });
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "HeadlessExperimental.enable",
      "HeadlessExperimental.beginFrame",
      "HeadlessExperimental.beginFrame",
    ]);
    expect(detach).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports an empty screenshot as unsupported", async () => {
    const send = vi.fn().mockResolvedValue({ hasDamage: false });
    const browser = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(null),
        createCDPSession: vi.fn().mockResolvedValue({
          send,
          detach: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as Browser;

    const result = await _probeBeginFrameSupportForTests(browser);

    expect(result.supported).toBe(false);
    expect(result.detail).toContain("returned 0 bytes after 10 attempts");
  });

  it("bounds a screenshot-bearing CDP call that never resolves", async () => {
    const never = new Promise<never>(() => {});
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockReturnValueOnce(never);
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn().mockResolvedValue(null),
        createCDPSession: vi.fn().mockResolvedValue({
          send,
          detach: vi.fn().mockResolvedValue(undefined),
        }),
        close,
      }),
    } as unknown as Browser;

    const result = await _probeBeginFrameSupportForTests(browser, 25);

    expect(result.supported).toBe(false);
    expect(result.detail).toContain("timeout during screenshot beginFrame attempt 1");
    expect(close).toHaveBeenCalledOnce();
  });

  it("force-kills and disconnects when graceful browser cleanup never resolves", async () => {
    const kill = vi.fn();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const browser = {
      close: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      process: vi.fn().mockReturnValue({ kill }),
      disconnect,
    } as unknown as Browser;

    await _closeBrowserAfterFailedProbeForTests(browser, 25);

    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("buildChromeArgs browser GPU mode", () => {
  const base = { width: 1920, height: 1080 };

  it("uses SwiftShader software GL by default for reproducible local renders", () => {
    const args = buildChromeArgs(base);
    expect(args).toContain("--enable-features=CanvasDrawElement");
    expect(args).not.toContain("--enable-unsafe-webgpu");
    expect(args).toContain("--use-gl=angle");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).toContain("--enable-unsafe-swiftshader");
    expect(args).not.toContain("--enable-gpu-rasterization");
  });

  // HF#3049: the stale-raster accumulation lives in SwiftShader's compositor,
  // which every capture mode reads from — so the gate is the GPU mode alone.
  // Swept over the whole CaptureMode union so a future mode can't quietly opt
  // out of the workaround the way `screenshot` did.
  const captureModes: CaptureMode[] = ["beginframe", "screenshot", "drawelement"];

  it.each(captureModes)("disables GPU compositing for software %s capture", (captureMode) => {
    expect(
      buildChromeArgs({ ...base, captureMode, platform: "linux" }, { browserGpuMode: "software" }),
    ).toContain("--disable-gpu-compositing");
  });

  it.each(captureModes)("leaves hardware %s capture on the GPU compositor", (captureMode) => {
    expect(
      buildChromeArgs({ ...base, captureMode, platform: "linux" }, { browserGpuMode: "hardware" }),
    ).not.toContain("--disable-gpu-compositing");
  });

  it("uses Metal-backed ANGLE for hardware browser GPU mode on macOS", () => {
    const args = buildChromeArgs({ ...base, platform: "darwin" }, { browserGpuMode: "hardware" });
    expect(args).toContain("--enable-unsafe-webgpu");
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

  it("uses ANGLE-EGL for hardware browser GPU mode on Linux", () => {
    const args = buildChromeArgs({ ...base, platform: "linux" }, { browserGpuMode: "hardware" });
    expect(args).toContain("--use-gl=angle");
    expect(args).toContain("--use-angle=gl-egl");
    expect(args).toContain("--enable-gpu-rasterization");
    expect(args).toContain("--ignore-gpu-blocklist");
    expect(args).toContain("--disable-software-rasterizer");
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

describe("browser launch capture-mode contract", () => {
  it("derives BeginFrame from the actual launch flags, not forceScreenshot alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-browser-fingerprint-"));
    const chromePath = join(dir, "chrome-headless-shell");
    writeFileSync(chromePath, "");
    try {
      const withoutControl = _createBrowserLaunchFingerprintForTests([], {
        chromePath,
        forceScreenshot: false,
      });
      const withControl = _createBrowserLaunchFingerprintForTests(
        ["--enable-begin-frame-control"],
        { chromePath, forceScreenshot: false },
      );

      expect(withoutControl.requestedCaptureMode).toBe("screenshot");
      expect(withControl.requestedCaptureMode).toBe(
        process.platform === "linux" ? "beginframe" : "screenshot",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveBrowserGpuMode", () => {
  const setMockWebGlProbe = (info: { hasWebGL: boolean; vendor: string; renderer: string }) => {
    const close = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(info);
    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({ evaluate }),
      close,
    });
    _setPuppeteerForTests({ launch } as unknown as PuppeteerNode);
    return { close, launch };
  };

  beforeEach(() => {
    _resetAutoBrowserGpuModeCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _setPuppeteerForTests(undefined);
    _resetAutoBrowserGpuModeCacheForTests();
  });

  it("passes 'software' through unchanged without probing", async () => {
    const mode = await resolveBrowserGpuMode("software");
    expect(mode).toBe("software");
  });

  it("passes 'hardware' through unchanged", async () => {
    setMockWebGlProbe({ hasWebGL: true, vendor: "NVIDIA", renderer: "NVIDIA GeForce RTX 3070" });
    const mode = await resolveBrowserGpuMode("hardware");
    expect(mode).toBe("hardware");
  });

  it("warns when explicit 'hardware' probes to software, but still honours it", async () => {
    // heygen-com/hyperframes#2967: `--browser-gpu` inside a container with no
    // GPU passthrough rendered 19186 frames on CPU with no diagnostic.
    setMockWebGlProbe({
      hasWebGL: true,
      vendor: "Google Inc. (Google)",
      renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mode = await resolveBrowserGpuMode("hardware", { platform: "linux" });
    expect(mode).toBe("hardware");
    const warning = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(warning).toContain("browserGpuMode=hardware was requested");
    expect(warning).toContain("--gpus all");
    // Once per process, not once per worker — the render path resolves the
    // mode for the probe browser plus every parallel worker.
    await resolveBrowserGpuMode("hardware", { platform: "linux" });
    await resolveBrowserGpuMode("hardware", { platform: "linux" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when explicit 'hardware' probes to hardware", async () => {
    setMockWebGlProbe({ hasWebGL: true, vendor: "NVIDIA", renderer: "NVIDIA GeForce RTX 3070" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveBrowserGpuMode("hardware")).toBe("hardware");
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives non-linux hosts the generic remediation, not the Docker one", async () => {
    setMockWebGlProbe({
      hasWebGL: true,
      vendor: "Google Inc. (Google)",
      renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveBrowserGpuMode("hardware", { platform: "darwin" })).toBe("hardware");
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("host exposes a GPU");
    expect(warning).not.toContain("--gpus all");
  });

  it("does not blame the GPU when the probe itself failed to launch", async () => {
    // A probe that could not run is NO evidence about the GPU. Sending this
    // operator to `--gpus all` would hide a broken Chrome install behind a
    // phantom passthrough problem.
    _setPuppeteerForTests({
      launch: vi.fn().mockRejectedValue(new Error("spawn ENOENT /bad/chrome")),
    } as unknown as PuppeteerNode);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resolveBrowserGpuMode("hardware", { platform: "linux" })).toBe("hardware");
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("GPU probe could not run");
    expect(warning).toContain("hyperframes doctor");
    expect(warning).not.toContain("--gpus all");
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
    setMockWebGlProbe({ hasWebGL: true, vendor: "NVIDIA", renderer: "NVIDIA GeForce RTX 3070" });
    const third = await resolveBrowserGpuMode("auto");
    expect(third).toBe("hardware");
  });

  it("deduplicates concurrent probes so only one Chrome launches", async () => {
    // Parallel coordinator fires N workers via Promise.all — without Promise-
    // level caching, a `--workers 4` render against a no-GPU host would launch
    // 4 simultaneous probe Chromes. Assert the launch count directly rather
    // than Promise identity: `"auto"` and `"hardware"` now each adapt the
    // shared cached Promise via `.then`, so identity is no longer the
    // invariant — "the probe browser starts exactly once" is.
    const { launch } = setMockWebGlProbe({
      hasWebGL: true,
      vendor: "Google Inc. (Google)",
      renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    });
    const results = await Promise.all([
      resolveBrowserGpuMode("auto", { browserTimeout: 2000 }),
      resolveBrowserGpuMode("auto", { browserTimeout: 2000 }),
      resolveBrowserGpuMode("auto", { browserTimeout: 2000 }),
    ]);
    expect(results).toEqual(["software", "software", "software"]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("shares the one probe across mixed 'auto' and 'hardware' callers", async () => {
    const { launch } = setMockWebGlProbe({
      hasWebGL: true,
      vendor: "NVIDIA",
      renderer: "NVIDIA GeForce RTX 3070",
    });
    const results = await Promise.all([
      resolveBrowserGpuMode("auto"),
      resolveBrowserGpuMode("hardware"),
      resolveBrowserGpuMode("auto"),
    ]);
    expect(results).toEqual(["hardware", "hardware", "hardware"]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "llvmpipe",
      "Google Inc. (Mesa/X.org)",
      "ANGLE (Mesa/X.org, llvmpipe (LLVM 12.0.0 256 bits), OpenGL ES 3.2)",
    ],
    [
      "Microsoft Basic Render Driver",
      "Google Inc. (Microsoft)",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
    ],
    ["Mesa offscreen", "Google Inc. (Mesa)", "ANGLE (Mesa, Mesa offscreen, OpenGL ES 3.2)"],
    [
      "lavapipe",
      "Google Inc. (Mesa)",
      "ANGLE (Mesa, llvmpipe/lavapipe Vulkan software rasterizer)",
    ],
  ])("treats %s WebGL as software in auto mode", async (_label, vendor, renderer) => {
    const { close, launch } = setMockWebGlProbe({
      hasWebGL: true,
      vendor,
      renderer,
    });

    const mode = await resolveBrowserGpuMode("auto", {
      chromePath: "/mock/chrome-headless-shell",
      browserTimeout: 2000,
    });

    expect(mode).toBe("software");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("treats empty WebGL renderer metadata as software in auto mode", async () => {
    const { close, launch } = setMockWebGlProbe({
      hasWebGL: true,
      vendor: "",
      renderer: "",
    });

    const mode = await resolveBrowserGpuMode("auto", {
      chromePath: "/mock/chrome-headless-shell",
      browserTimeout: 2000,
    });

    expect(mode).toBe("software");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps real hardware WebGL as hardware in auto mode", async () => {
    const { close, launch } = setMockWebGlProbe({
      hasWebGL: true,
      vendor: "Google Inc. (NVIDIA Corporation)",
      renderer: "ANGLE (NVIDIA, NVIDIA A10G, OpenGL 4.6)",
    });

    const mode = await resolveBrowserGpuMode("auto", {
      chromePath: "/mock/chrome-headless-shell",
      browserTimeout: 2000,
    });

    expect(mode).toBe("hardware");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("resolveHeadlessShellPath", () => {
  const originalHeadlessShellPath = process.env.PRODUCER_HEADLESS_SHELL_PATH;
  const originalHyperframesBrowserPath = process.env.HYPERFRAMES_BROWSER_PATH;

  afterEach(() => {
    if (originalHeadlessShellPath === undefined) delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
    else process.env.PRODUCER_HEADLESS_SHELL_PATH = originalHeadlessShellPath;
    if (originalHyperframesBrowserPath === undefined) delete process.env.HYPERFRAMES_BROWSER_PATH;
    else process.env.HYPERFRAMES_BROWSER_PATH = originalHyperframesBrowserPath;
  });

  it("throws a clear error when PRODUCER_HEADLESS_SHELL_PATH points at a missing binary", () => {
    process.env.PRODUCER_HEADLESS_SHELL_PATH = "/missing/chrome-headless-shell.exe";

    expect(() => resolveHeadlessShellPath({})).toThrow(
      /Chrome binary not found at PRODUCER_HEADLESS_SHELL_PATH/,
    );
  });

  it("uses HYPERFRAMES_BROWSER_PATH when the CLI resolved a browser explicitly", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-engine-browser-env-"));
    try {
      const binary = join(dir, "chrome-headless-shell");
      writeFileSync(binary, "");
      delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
      process.env.HYPERFRAMES_BROWSER_PATH = binary;

      expect(resolveHeadlessShellPath({})).toBe(binary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      hostPlatform: "darwin",
      hostArch: "arm64",
      expectedDirectory: "chrome-headless-shell-mac-arm64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "darwin",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-mac-x64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "linux",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-linux64",
      expectedExecutable: "chrome-headless-shell",
    },
    {
      hostPlatform: "win32",
      hostArch: "ia32",
      expectedDirectory: "chrome-headless-shell-win32",
      expectedExecutable: "chrome-headless-shell.exe",
    },
    {
      hostPlatform: "win32",
      hostArch: "x64",
      expectedDirectory: "chrome-headless-shell-win64",
      expectedExecutable: "chrome-headless-shell.exe",
    },
  ])(
    "selects only the host-compatible cached shell on $hostPlatform/$hostArch when every platform is present",
    ({ hostPlatform, hostArch, expectedDirectory, expectedExecutable }) => {
      const home = mkdtempSync(join(tmpdir(), "hyperframes-engine-browser-platform-"));
      try {
        const cacheVersion = join(
          home,
          ".cache",
          "puppeteer",
          "chrome-headless-shell",
          "host-152.0.7928.2",
        );
        const candidates = [
          ["chrome-headless-shell-linux64", "chrome-headless-shell"],
          ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
          ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
          ["chrome-headless-shell-win32", "chrome-headless-shell.exe"],
          ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
        ] as const;
        for (const [directory, executable] of candidates) {
          const binary = join(cacheVersion, directory, executable);
          mkdirSync(join(binary, ".."), { recursive: true });
          writeFileSync(binary, "");
        }
        const expectedBinary = join(cacheVersion, expectedDirectory, expectedExecutable);

        const env = { ...process.env, HOME: home, USERPROFILE: home };
        delete env.PRODUCER_HEADLESS_SHELL_PATH;
        delete env.HYPERFRAMES_BROWSER_PATH;
        const moduleUrl = new URL("./browserManager.ts", import.meta.url).href;
        const stdout = execFileSync(
          "bun",
          [
            "--eval",
            `Object.defineProperty(process, "platform", { value: ${JSON.stringify(hostPlatform)} }); Object.defineProperty(process, "arch", { value: ${JSON.stringify(hostArch)} }); import(${JSON.stringify(moduleUrl)}).then(({ resolveHeadlessShellPath }) => process.stdout.write(resolveHeadlessShellPath({}) ?? ""))`,
          ],
          { encoding: "utf8", env },
        );

        expect(stdout).toBe(expectedBinary);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { hostPlatform: "linux", hostArch: "arm64" },
    { hostPlatform: "win32", hostArch: "arm64" },
  ])(
    "does not select a foreign cached shell on unsupported $hostPlatform/$hostArch",
    ({ hostPlatform, hostArch }) => {
      const home = mkdtempSync(join(tmpdir(), "hyperframes-engine-browser-unsupported-"));
      try {
        const cacheVersion = join(
          home,
          ".cache",
          "puppeteer",
          "chrome-headless-shell",
          "host-152.0.7928.2",
        );
        for (const [directory, executable] of [
          ["chrome-headless-shell-linux64", "chrome-headless-shell"],
          ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
        ] as const) {
          const binary = join(cacheVersion, directory, executable);
          mkdirSync(join(binary, ".."), { recursive: true });
          writeFileSync(binary, "");
        }

        const env = { ...process.env, HOME: home, USERPROFILE: home };
        delete env.PRODUCER_HEADLESS_SHELL_PATH;
        delete env.HYPERFRAMES_BROWSER_PATH;
        const moduleUrl = new URL("./browserManager.ts", import.meta.url).href;
        const stdout = execFileSync(
          "bun",
          [
            "--eval",
            `Object.defineProperty(process, "platform", { value: ${JSON.stringify(hostPlatform)} }); Object.defineProperty(process, "arch", { value: ${JSON.stringify(hostArch)} }); import(${JSON.stringify(moduleUrl)}).then(({ resolveHeadlessShellPath }) => process.stdout.write(resolveHeadlessShellPath({}) ?? ""))`,
          ],
          { encoding: "utf8", env },
        );

        expect(stdout).toBe("");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("reuses chrome-headless-shell from the HyperFrames-managed cache", () => {
    const home = mkdtempSync(join(tmpdir(), "hyperframes-engine-browser-cache-"));
    try {
      const binary = join(
        home,
        ".cache",
        "hyperframes",
        "chrome",
        "chrome-headless-shell",
        "linux-152.0.7928.2",
        "chrome-headless-shell-linux64",
        "chrome-headless-shell",
      );
      mkdirSync(join(binary, ".."), { recursive: true });
      writeFileSync(binary, "");
      const olderBinary = binary.replace("linux-152.0.7928.2", "linux-99.0.1.1");
      mkdirSync(join(olderBinary, ".."), { recursive: true });
      writeFileSync(olderBinary, "");

      // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.PRODUCER_HEADLESS_SHELL_PATH;
      delete env.HYPERFRAMES_BROWSER_PATH;
      const moduleUrl = new URL("./browserManager.ts", import.meta.url).href;
      const stdout = execFileSync(
        "bun",
        [
          "--eval",
          `Object.defineProperty(process, "platform", { value: "linux" }); Object.defineProperty(process, "arch", { value: "x64" }); import(${JSON.stringify(moduleUrl)}).then(({ resolveHeadlessShellPath }) => process.stdout.write(resolveHeadlessShellPath({}) ?? ""))`,
        ],
        { encoding: "utf8", env },
      );

      expect(stdout).toBe(binary);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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

    await first.release();
    await second.release();
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

    await a.release();
    await b.release();
    await c.release();
  });

  it("pool recovers from a disconnected browser", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    await first.release();

    // Simulate Chrome crash
    (first.browser as unknown as { connected: boolean }).connected = false;

    const freshBrowser = makeMockBrowser();
    launchFn.mockResolvedValue(freshBrowser);

    const second = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(second.browser).toBe(freshBrowser);
    expect(second.browser).not.toBe(first.browser);
    expect(launchFn).toHaveBeenCalledTimes(2);

    await second.release();
  });

  it("release at refCount 0 closes the browser", async () => {
    const result = await acquireBrowser(["--no-sandbox"], poolCfg);
    const closeFn = result.browser.close as ReturnType<typeof vi.fn>;

    await result.release();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("releaseBrowser preserves the sole-owner legacy path", async () => {
    const result = await acquireBrowser(["--no-sandbox"], poolCfg);
    const closeFn = result.browser.close as ReturnType<typeof vi.fn>;

    await releaseBrowser(result.browser);

    expect(closeFn).toHaveBeenCalledTimes(1);
    await result.release();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("releaseBrowser rejects an ambiguous pooled browser handle", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);
    const closeFn = first.browser.close as ReturnType<typeof vi.fn>;

    await expect(releaseBrowser(first.browser)).rejects.toThrow(
      "Cannot release a pooled browser by handle while 2 leases are active",
    );
    expect(closeFn).not.toHaveBeenCalled();

    await first.release();
    await second.release();
  });

  it("pool returns a separate browser when forceScreenshot mismatches pooled mode", async () => {
    const first = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(first.captureMode).toBe("screenshot");

    // Second acquire with same forceScreenshot — same mode, should reuse
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);
    expect(second.browser).toBe(first.browser);
    expect(launchFn).toHaveBeenCalledTimes(1);

    await first.release();
    await second.release();
  });

  it("forceReleaseBrowser does not kill Chrome when other sessions hold refs", async () => {
    const result = await acquireBrowser(["--no-sandbox"], poolCfg);
    // Acquire a second ref
    const second = await acquireBrowser(["--no-sandbox"], poolCfg);

    const disconnectFn = result.browser.disconnect as ReturnType<typeof vi.fn>;
    forceReleaseBrowser(result.browser);

    // Should NOT have disconnected — other session still holds a ref
    expect(disconnectFn).not.toHaveBeenCalled();

    // Each owner releases its own identity; neither can consume the other.
    result.forceRelease();
    await second.release();
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
