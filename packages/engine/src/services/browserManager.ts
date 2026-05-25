/**
 * Browser Manager
 *
 * Manages Puppeteer browser lifecycle: Chrome executable resolution,
 * launch args, pooled browser acquisition/release.
 */

import type { Browser, PuppeteerNode } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir, totalmem } from "os";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";

let _puppeteer: PuppeteerNode | undefined;

async function getPuppeteer(): Promise<PuppeteerNode> {
  if (_puppeteer) return _puppeteer;
  try {
    const mod = await import("puppeteer" as string);
    _puppeteer = mod.default;
  } catch {
    const mod = await import("puppeteer-core");
    _puppeteer = mod.default;
  }
  if (!_puppeteer) throw new Error("Neither puppeteer nor puppeteer-core found");
  return _puppeteer;
}

// "beginframe" = atomic compositor control via HeadlessExperimental.beginFrame (Linux only)
// "screenshot" = renderSeek + Page.captureScreenshot (all platforms)
export type CaptureMode = "beginframe" | "screenshot";

export interface AcquiredBrowser {
  browser: Browser;
  captureMode: CaptureMode;
}

/**
 * Resolve chrome-headless-shell binary for deterministic BeginFrame rendering.
 * Checks config.chromePath, then PRODUCER_HEADLESS_SHELL_PATH env var,
 * then scans Puppeteer's managed cache at ~/.cache/puppeteer/chrome-headless-shell/.
 */
export function resolveHeadlessShellPath(
  config?: Partial<Pick<EngineConfig, "chromePath">>,
): string | undefined {
  if (config?.chromePath) {
    return config.chromePath;
  }
  if (process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    return process.env.PRODUCER_HEADLESS_SHELL_PATH;
  }
  const baseDir = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (!existsSync(baseDir)) return undefined;
  try {
    const versions = readdirSync(baseDir).sort().reverse(); // newest first
    for (const version of versions) {
      const candidates = [
        join(baseDir, version, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(baseDir, version, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        join(baseDir, version, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(baseDir, version, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      ];
      for (const binary of candidates) {
        if (existsSync(binary)) return binary;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

let pooledBrowser: Browser | null = null;
let pooledBrowserRefCount = 0;
let pooledCaptureMode: CaptureMode = "screenshot";
let _pooledBrowserLaunchPromise: Promise<AcquiredBrowser> | null = null;

// Preserve the producer-era export so re-export shims keep the same public API.
export const ENABLE_BROWSER_POOL = DEFAULT_CONFIG.enableBrowserPool;

// Flags only meaningful when Chrome's compositor is driven by
// HeadlessExperimental.beginFrame. If we fall back to screenshot mode they
// must be stripped — `--enable-begin-frame-control` in particular makes the
// compositor wait for frames we'll never send, producing blank screenshots.
const BEGINFRAME_ONLY_FLAGS = new Set([
  "--deterministic-mode",
  "--enable-begin-frame-control",
  "--disable-new-content-rendering-timeout",
  "--run-all-compositor-stages-before-draw",
  "--disable-threaded-animation",
  "--disable-threaded-scrolling",
  "--disable-checker-imaging",
  "--disable-image-animation-resync",
  "--enable-surface-synchronization",
]);

function stripBeginFrameFlags(args: string[]): string[] {
  return args.filter((a) => !BEGINFRAME_ONLY_FLAGS.has(a));
}

/**
 * Probe whether the browser still speaks HeadlessExperimental.beginFrame.
 *
 * Recent chrome-headless-shell builds (observed on 147) expose the domain
 * well enough that HeadlessExperimental.enable succeeds but drop the
 * beginFrame method itself — the capture loop then dies on first frame with
 * `'HeadlessExperimental.beginFrame' wasn't found`. So we probe BOTH: enable
 * + one cheap beginFrame raced against a 2s timeout. In beginframe-control
 * mode the command completes as soon as the compositor acks, so a real
 * supported browser returns well under the timeout.
 *
 * Any failure (method missing, timeout, protocol error) is treated as
 * unsupported. Real errors after launch would surface in the warmup loop and
 * fall out through the caller's try/catch.
 */
async function probeBeginFrameSupport(browser: Browser): Promise<boolean> {
  let page;
  try {
    page = await browser.newPage();
    const client = await page.createCDPSession();
    await client.send("HeadlessExperimental.enable");
    const beginFrame = client.send("HeadlessExperimental.beginFrame", {
      frameTimeTicks: 0,
      interval: 33,
      noDisplayUpdates: true,
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("beginFrame probe timeout")), 2000),
    );
    await Promise.race([beginFrame, timeout]);
    await client.detach().catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    await page?.close().catch(() => {});
  }
}

/**
 * Cached *in-flight or resolved* probe Promise for `resolveBrowserGpuMode("auto", ...)`.
 *
 * Caching the Promise (rather than the resolved value) deduplicates concurrent
 * callers — the parallel coordinator runs N workers via `Promise.all`, so a
 * `--workers 4` render against a no-GPU host would otherwise fire 4
 * simultaneous probe Chromes. The first call assigns the Promise and every
 * other concurrent caller awaits the same one, paying the ~240 ms probe cost
 * exactly once per process lifetime.
 *
 * Exported for tests; production callers go through `resolveBrowserGpuMode`.
 */
let _autoBrowserGpuModeCache: Promise<"software" | "hardware"> | undefined;

/** Test-only: reset the cached probe result. */
export function _resetAutoBrowserGpuModeCacheForTests(): void {
  _autoBrowserGpuModeCache = undefined;
}

/**
 * Resolve `browserGpuMode` to a concrete `"software" | "hardware"` answer.
 *
 * For `"software"` / `"hardware"` this is a pure pass-through. For `"auto"`
 * it launches a tiny Chrome with the platform's hardware GPU args, runs a
 * one-shot WebGL availability probe, and falls back to `"software"` if
 * hardware-mode WebGL is unavailable. The Promise is cached for the process
 * lifetime, so concurrent callers (parallel workers) share the same probe.
 *
 * Any failure (Chrome launch error, navigation timeout, missing canvas API,
 * etc.) is treated as a `"software"` fallback. The render path with
 * SwiftShader always works, so a misclassification toward software is the
 * safe failure mode; misclassifying toward hardware would error on the real
 * render.
 */
export function resolveBrowserGpuMode(
  mode: EngineConfig["browserGpuMode"],
  options: {
    chromePath?: string;
    browserTimeout?: number;
    platform?: NodeJS.Platform;
  } = {},
): Promise<"software" | "hardware"> {
  if (mode !== "auto") return Promise.resolve(mode);
  if (_autoBrowserGpuModeCache) return _autoBrowserGpuModeCache;

  _autoBrowserGpuModeCache = (async () => {
    const platform = options.platform ?? process.platform;
    const browserTimeout = options.browserTimeout ?? DEFAULT_CONFIG.browserTimeout;
    const executablePath = options.chromePath ?? resolveHeadlessShellPath({});

    const probeArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      ...getBrowserGpuArgs("hardware", platform),
    ];

    const ppt = await getPuppeteer().catch(() => null);
    if (!ppt) {
      logResolvedBrowserGpuMode("software", "puppeteer unavailable");
      return "software" as const;
    }

    let probeBrowser: Browser | undefined;
    try {
      probeBrowser = await ppt.launch({
        headless: true,
        args: probeArgs,
        defaultViewport: { width: 64, height: 64 },
        executablePath,
        timeout: browserTimeout,
      });
      const page = await probeBrowser.newPage();
      const hasWebGL = await page.evaluate(() => {
        try {
          const c = document.createElement("canvas");
          const gl =
            c.getContext("webgl") ||
            (c.getContext("experimental-webgl") as RenderingContext | null);
          return gl !== null;
        } catch {
          return false;
        }
      });
      const resolved = hasWebGL ? ("hardware" as const) : ("software" as const);
      logResolvedBrowserGpuMode(resolved, hasWebGL ? "WebGL probe succeeded" : "WebGL unavailable");
      return resolved;
    } catch (err) {
      logResolvedBrowserGpuMode(
        "software",
        `probe failed (${err instanceof Error ? err.message : String(err)})`,
      );
      return "software" as const;
    } finally {
      await probeBrowser?.close().catch(() => {});
    }
  })();

  return _autoBrowserGpuModeCache;
}

/**
 * Single observability surface for the auto-detect outcome. Logged exactly
 * once per process (the probe runs once); without this line, a regression
 * to "always software even with a GPU present" would be invisible in
 * production. Goes to stderr to stay out of stdout pipelines.
 */
function logResolvedBrowserGpuMode(resolved: "hardware" | "software", reason: string): void {
  console.error(`[hyperframes] browserGpuMode auto → ${resolved} (${reason})`);
}

/**
 * Resolve the capture mode the caller expects, WITHOUT launching a browser.
 * Used to validate pool compatibility before returning a cached instance.
 */
function resolveRequestedCaptureMode(
  config?: Partial<Pick<EngineConfig, "chromePath" | "forceScreenshot">>,
): CaptureMode {
  const headlessShell = resolveHeadlessShellPath(config);
  // BeginFrame requires chrome-headless-shell AND Linux — crashes on
  // macOS/Windows (crbug.com/40656275).
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  if (headlessShell && isLinux && !forceScreenshot) return "beginframe";
  return "screenshot";
}

export async function acquireBrowser(
  chromeArgs: string[],
  config?: Partial<
    Pick<
      EngineConfig,
      "browserTimeout" | "protocolTimeout" | "enableBrowserPool" | "chromePath" | "forceScreenshot"
    >
  >,
): Promise<AcquiredBrowser> {
  const enablePool = config?.enableBrowserPool ?? DEFAULT_CONFIG.enableBrowserPool;

  if (enablePool && pooledBrowser) {
    if (!pooledBrowser.connected) {
      pooledBrowser = null;
      pooledBrowserRefCount = 0;
      _pooledBrowserLaunchPromise = null;
    } else {
      // Validate mode compatibility: a caller that needs screenshot mode
      // (forceScreenshot, alpha output, BeginFrame timeout retry) must not
      // receive a beginframe browser — the BeginFrame-only flags make the
      // compositor wait for frames the screenshot path never sends.
      const requestedMode = resolveRequestedCaptureMode(config);
      if (pooledCaptureMode === requestedMode) {
        pooledBrowserRefCount += 1;
        return { browser: pooledBrowser, captureMode: pooledCaptureMode };
      }
      // Mode mismatch — skip pool, launch a dedicated browser for this caller.
      // Don't evict the pooled browser: other sessions may still hold refs.
    }
  }

  // Dedup concurrent launches: when the pool is enabled and multiple callers
  // (e.g. parallel workers via Promise.all) race into acquireBrowser before
  // the first launch completes, they would all see pooledBrowser === null and
  // each spawn a separate Chrome. Cache the in-flight launch Promise so the
  // second+ callers await the same one instead of launching again.
  if (enablePool && _pooledBrowserLaunchPromise) {
    const result = await _pooledBrowserLaunchPromise;
    const requestedMode = resolveRequestedCaptureMode(config);
    if (result.captureMode === requestedMode) {
      pooledBrowserRefCount += 1;
      return result;
    }
    // Mode mismatch with pending launch — launch a dedicated browser.
  }

  const launchPromise = launchBrowser(chromeArgs, config);

  if (enablePool && !pooledBrowser && !_pooledBrowserLaunchPromise) {
    _pooledBrowserLaunchPromise = launchPromise;
    try {
      const result = await launchPromise;
      pooledBrowser = result.browser;
      pooledBrowserRefCount = 1;
      pooledCaptureMode = result.captureMode;
      return result;
    } finally {
      _pooledBrowserLaunchPromise = null;
    }
  }

  return launchPromise;
}

async function launchBrowser(
  chromeArgs: string[],
  config?: Partial<
    Pick<EngineConfig, "browserTimeout" | "protocolTimeout" | "chromePath" | "forceScreenshot">
  >,
): Promise<AcquiredBrowser> {
  // Config chromePath overrides env var / auto-detection.
  const headlessShell = resolveHeadlessShellPath(config);

  // BeginFrame requires chrome-headless-shell AND Linux (crashes on
  // macOS/Windows — crbug.com/40656275).
  const isLinux = process.platform === "linux";
  const forceScreenshot = config?.forceScreenshot ?? DEFAULT_CONFIG.forceScreenshot;
  let captureMode: CaptureMode;
  let executablePath: string | undefined;

  if (headlessShell && isLinux && !forceScreenshot) {
    captureMode = "beginframe";
    executablePath = headlessShell;
  } else {
    // Screenshot mode with renderSeek: works on all platforms.
    captureMode = "screenshot";
    executablePath = headlessShell ?? undefined;
  }

  const ppt = await getPuppeteer();
  const browserTimeout = config?.browserTimeout ?? DEFAULT_CONFIG.browserTimeout;
  const protocolTimeout = config?.protocolTimeout ?? DEFAULT_CONFIG.protocolTimeout;
  let browser = await ppt.launch({
    headless: true,
    args: chromeArgs,
    defaultViewport: null,
    executablePath,
    timeout: browserTimeout,
    protocolTimeout,
  });

  if (captureMode === "beginframe") {
    const supported = await probeBeginFrameSupport(browser).catch(() => true);
    if (!supported) {
      await browser.close().catch(() => {});
      console.warn(
        "[BrowserManager] HeadlessExperimental.beginFrame unavailable in this Chromium build; falling back to screenshot mode.",
      );
      captureMode = "screenshot";
      browser = await ppt.launch({
        headless: true,
        args: stripBeginFrameFlags(chromeArgs),
        defaultViewport: null,
        executablePath,
        timeout: browserTimeout,
        protocolTimeout,
      });
    }
  }

  return { browser, captureMode };
}

export async function releaseBrowser(
  browser: Browser,
  config?: Partial<Pick<EngineConfig, "enableBrowserPool">>,
): Promise<void> {
  const enablePool = config?.enableBrowserPool ?? DEFAULT_CONFIG.enableBrowserPool;
  if (!enablePool) {
    await browser.close().catch(() => {});
    return;
  }
  if (pooledBrowser && pooledBrowser === browser) {
    pooledBrowserRefCount = Math.max(0, pooledBrowserRefCount - 1);
    if (pooledBrowserRefCount === 0) {
      await browser.close().catch(() => {});
      pooledBrowser = null;
      _pooledBrowserLaunchPromise = null;
    }
    return;
  }
  await browser.close().catch(() => {});
}

export function forceReleaseBrowser(browser: Browser): void {
  if (pooledBrowser && pooledBrowser === browser) {
    // If other sessions still hold refs, just drop ours — don't kill the
    // shared Chrome out from under them. The browser will be cleaned up when
    // the last session releases or drainBrowserPool is called.
    if (pooledBrowserRefCount > 1) {
      pooledBrowserRefCount -= 1;
      return;
    }
    pooledBrowserRefCount = 0;
    pooledBrowser = null;
    _pooledBrowserLaunchPromise = null;
  }
  const proc = (
    browser as unknown as {
      process?: () => { kill: (signal?: NodeJS.Signals) => boolean; killed?: boolean } | null;
    }
  ).process?.();
  if (proc && !proc.killed) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // Best-effort cleanup.
    }
  }
  try {
    browser.disconnect();
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Forcefully close the pooled browser if one exists, regardless of refCount.
 * Used for explicit cleanup at process exit or between independent render jobs
 * that should not share browser state.
 */
export async function drainBrowserPool(): Promise<void> {
  // Await any in-flight launch first — otherwise the launch resolves after we
  // drain and produces a browser that nobody references (orphan).
  const pending = _pooledBrowserLaunchPromise;
  _pooledBrowserLaunchPromise = null;
  if (pending) {
    await pending.then((r) => r.browser.close()).catch(() => {});
  }
  if (pooledBrowser) {
    const browser = pooledBrowser;
    pooledBrowser = null;
    pooledBrowserRefCount = 0;
    await browser.close().catch(() => {});
  }
}

/** Test-only: reset all pool state. */
export function _resetBrowserPoolForTests(): void {
  pooledBrowser = null;
  pooledBrowserRefCount = 0;
  pooledCaptureMode = "screenshot";
  _pooledBrowserLaunchPromise = null;
}

/** Test-only: inject a mock PuppeteerNode so tests bypass the dynamic import. */
export function _setPuppeteerForTests(mock: PuppeteerNode | undefined): void {
  _puppeteer = mock;
}

function getTotalMemMb(): number {
  return Math.floor(totalmem() / (1024 * 1024));
}

function getGpuMemBudgetMb(): number {
  const total = getTotalMemMb();
  if (total < 4096) return 512;
  if (total < 8192) return 1024;
  return 4096;
}

function getLowMemoryFlags(): string[] {
  const total = getTotalMemMb();
  if (total >= 8192) return [];
  const heapMb = total < 4096 ? 256 : 512;
  return [`--js-flags=--max-old-space-size=${heapMb}`];
}

export interface BuildChromeArgsOptions {
  width: number;
  height: number;
  captureMode?: CaptureMode;
  platform?: NodeJS.Platform;
}

const CANVAS_DRAW_ELEMENT_FEATURE_FLAG = "--enable-features=CanvasDrawElement";
const WEBGPU_FLAG = "--enable-unsafe-webgpu";

export function buildChromeArgs(
  options: BuildChromeArgsOptions,
  config?: Partial<Pick<EngineConfig, "browserGpuMode" | "disableGpu" | "chromePath">>,
): string[] {
  const platform = options.platform ?? process.platform;
  const gpuDisabled = config?.disableGpu ?? DEFAULT_CONFIG.disableGpu;
  const browserGpuMode = gpuDisabled
    ? "software"
    : (config?.browserGpuMode ?? DEFAULT_CONFIG.browserGpuMode);
  // Chrome flags tuned for headless rendering performance. The set below is a
  // fairly standard "headless-for-capture" configuration — similar profiles
  // appear in Puppeteer's defaults, Playwright, Remotion, and Chrome's own
  // headless-shell guidance.
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    CANVAS_DRAW_ELEMENT_FEATURE_FLAG,
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    ...getBrowserGpuArgs(browserGpuMode, platform),
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    `--window-size=${options.width},${options.height}`,
    // Prevent Chrome from throttling background tabs/timers — critical when the
    // page is offscreen during headless capture
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-media-suspend",
    // Reduce overhead from unused Chrome features
    "--disable-breakpad",
    "--disable-component-extensions-with-background-pages",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-sync",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-print-preview",
    "--no-pings",
    "--no-zygote",
    // Memory — scale GPU budget to available system RAM
    `--force-gpu-mem-available-mb=${getGpuMemBudgetMb()}`,
    "--disk-cache-size=268435456",
    ...getLowMemoryFlags(),
    // Disable features that add overhead
    "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate,BackForwardCache,IntensiveWakeUpThrottling",
  ];

  if (browserGpuMode !== "software") {
    chromeArgs.push(WEBGPU_FLAG);
  }

  // BeginFrame flags — only when using chrome-headless-shell on Linux
  if (options.captureMode !== "screenshot") {
    chromeArgs.push(
      "--deterministic-mode",
      "--enable-begin-frame-control",
      "--disable-new-content-rendering-timeout",
      "--run-all-compositor-stages-before-draw",
      "--disable-threaded-animation",
      "--disable-threaded-scrolling",
      "--disable-checker-imaging",
      "--disable-image-animation-resync",
      "--enable-surface-synchronization",
    );
  }

  if (gpuDisabled) {
    chromeArgs.push("--disable-gpu");
  }
  return chromeArgs;
}

function getBrowserGpuArgs(
  mode: EngineConfig["browserGpuMode"],
  platform: NodeJS.Platform,
): string[] {
  if (mode === "software") {
    // Chrome 120+ deprecated implicit SwiftShader fallback; the explicit
    // path (--use-angle=swiftshader) keeps working but Chrome emits a
    // deprecation warning unless --enable-unsafe-swiftshader is also set.
    // Despite the name, this is exactly the behaviour Chrome had before;
    // the flag exists to make CPU rasterisation an explicit opt-in rather
    // than an implicit fallback for end users on the open web.
    return ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  }

  if (mode === "auto") {
    // Should not reach here — `resolveBrowserGpuMode` collapses "auto" to
    // "software" or "hardware" before args are built. Be defensive: software
    // is the always-safe fallback.
    return ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  }

  switch (platform) {
    case "darwin":
      return ["--use-gl=angle", "--use-angle=metal", "--enable-gpu-rasterization"];
    case "win32":
      return ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu-rasterization"];
    case "linux":
      return ["--use-gl=egl", "--enable-gpu-rasterization"];
    default:
      return ["--enable-gpu-rasterization"];
  }
}
