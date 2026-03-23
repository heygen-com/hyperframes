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
    if (headlessShell && !isLinux) {
      executablePath = headlessShell;
    } else {
      executablePath = undefined; // Puppeteer uses its bundled Chromium
    }
  }

  const ppt = await getPuppeteer();
  const browser = await ppt.launch({
    headless: true,
    args: chromeArgs,
    defaultViewport: null,
    executablePath,
    timeout: config?.browserTimeout ?? DEFAULT_CONFIG.browserTimeout,
    protocolTimeout: config?.protocolTimeout ?? DEFAULT_CONFIG.protocolTimeout,
  });
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
  // Chrome flags tuned for headless rendering performance.
  // Based on Remotion's open-browser.ts flags with additions for our use case.
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
    // Remotion perf flags — prevent Chrome from throttling background tabs/timers
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
