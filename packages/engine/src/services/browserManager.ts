/**
 * Browser Manager
 *
 * Manages Puppeteer browser lifecycle: Chrome executable resolution,
 * launch args, pooled browser acquisition/release.
 */

import type { Browser, PuppeteerNode } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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
    pooledBrowserRefCount += 1;
    return { browser: pooledBrowser, captureMode: pooledCaptureMode };
  }

  // Config chromePath overrides env var / auto-detection.
  const headlessShell = resolveHeadlessShellPath(config);

  // BeginFrame requires chrome-headless-shell AND Linux (crashes on macOS/Windows).
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

  // Probe HeadlessExperimental.beginFrame — recent chrome-headless-shell
  // builds (observed on 147) dropped the method while keeping the flags
  // valid, so `--enable-begin-frame-control` leaves the compositor waiting
  // for beginFrames the engine can no longer send. Auto-fall back to
  // screenshot mode with the appropriate flags.
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

  if (enablePool) {
    pooledBrowser = browser;
    pooledBrowserRefCount = 1;
    pooledCaptureMode = captureMode;
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
    }
    return;
  }
  await browser.close().catch(() => {});
}

export interface BuildChromeArgsOptions {
  width: number;
  height: number;
  captureMode?: CaptureMode;
}

export function buildChromeArgs(
  options: BuildChromeArgsOptions,
  config?: Partial<Pick<EngineConfig, "disableGpu" | "chromePath">>,
): string[] {
  // Chrome flags tuned for headless rendering performance. The set below is a
  // fairly standard "headless-for-capture" configuration — similar profiles
  // appear in Puppeteer's defaults, Playwright, Remotion, and Chrome's own
  // headless-shell guidance.
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
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
    // Memory
    "--force-gpu-mem-available-mb=4096",
    "--disk-cache-size=268435456",
    // Disable features that add overhead
    "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate,BackForwardCache,IntensiveWakeUpThrottling",
  ];

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

  const gpuDisabled = config?.disableGpu ?? DEFAULT_CONFIG.disableGpu;
  if (gpuDisabled) {
    chromeArgs.push("--disable-gpu");
  }
  return chromeArgs;
}
