/**
 * Browser Manager
 *
 * Manages Puppeteer browser lifecycle: Chrome executable resolution,
 * launch args, pooled browser acquisition/release.
 */

import type { Browser, PuppeteerNode } from "puppeteer-core";
import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { DEFAULT_CONFIG, type EngineConfig } from "../config.js";
import { getSystemTotalMb, LOW_MEMORY_TOTAL_MB_THRESHOLD } from "./systemMemory.js";
import {
  BrowserLeasePool,
  type BrowserLaunchFingerprint,
  type BrowserLease,
  type CaptureMode,
} from "./browserLeasePool.js";

export { BrowserLeasePool } from "./browserLeasePool.js";
export type {
  BrowserLaunchFingerprint,
  BrowserLease,
  BrowserPoolState,
  CaptureMode,
} from "./browserLeasePool.js";

let _puppeteer: PuppeteerNode | undefined;

interface WebGlProbeInfo {
  hasWebGL: boolean;
  vendor: string;
  renderer: string;
}

function isSoftwareWebGlRenderer(rendererInfo: string): boolean {
  const renderer = rendererInfo.trim().toLowerCase();
  return (
    renderer.includes("swiftshader") ||
    renderer.includes("llvmpipe") ||
    renderer.includes("lavapipe") ||
    renderer.includes("softpipe") ||
    renderer.includes("mesa offscreen") ||
    renderer.includes("microsoft basic render driver") ||
    renderer.includes("software rasterizer")
  );
}

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

async function probeHardwareWebGlInfo(
  ppt: PuppeteerNode,
  options: {
    args: string[];
    browserTimeout: number;
    executablePath: string | undefined;
  },
): Promise<WebGlProbeInfo> {
  let probeBrowser: Browser | undefined;
  try {
    probeBrowser = await ppt.launch({
      headless: true,
      args: options.args,
      defaultViewport: { width: 64, height: 64 },
      executablePath: options.executablePath,
      timeout: options.browserTimeout,
    });
    const page = await probeBrowser.newPage();
    return await page.evaluate(() => {
      const unavailable = { hasWebGL: false, vendor: "", renderer: "" };
      const c = document.createElement("canvas");
      let gl = c.getContext("webgl") as WebGLRenderingContext | null;
      if (gl === null) {
        gl = c.getContext("experimental-webgl") as WebGLRenderingContext | null;
      }
      if (gl === null) return unavailable;
      const ext = gl.getExtension("WEBGL_debug_renderer_info") as {
        UNMASKED_VENDOR_WEBGL: number;
        UNMASKED_RENDERER_WEBGL: number;
      } | null;
      let vendorParam: number = gl.VENDOR;
      let rendererParam: number = gl.RENDERER;
      if (ext !== null) {
        vendorParam = ext.UNMASKED_VENDOR_WEBGL;
        rendererParam = ext.UNMASKED_RENDERER_WEBGL;
      }
      const vendor = gl.getParameter(vendorParam);
      const renderer = gl.getParameter(rendererParam);
      return {
        hasWebGL: true,
        vendor: vendor == null ? "" : String(vendor),
        renderer: renderer == null ? "" : String(renderer),
      };
    });
  } finally {
    await probeBrowser?.close().catch(() => {});
  }
}

export type AcquiredBrowser = BrowserLease;

function compareBrowserVersionsDescending(left: string, right: string): number {
  const parse = (value: string): number[] => {
    const version = value.slice(value.indexOf("-") + 1);
    const segments: number[] = [];
    for (const segment of version.split(".")) {
      const parsed = Number.parseInt(segment, 10);
      if (!Number.isFinite(parsed)) break;
      segments.push(parsed);
    }
    return segments;
  };
  const leftSegments = parse(left);
  const rightSegments = parse(right);
  const length = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightSegments[index] ?? 0) - (leftSegments[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function findCachedHeadlessShell(baseDir: string): string | undefined {
  if (!existsSync(baseDir)) return undefined;
  try {
    const versions = readdirSync(baseDir).sort(compareBrowserVersionsDescending);
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
    // Ignore unreadable cache directories and continue browser discovery.
  }
  return undefined;
}

/**
 * Resolve chrome-headless-shell binary for deterministic BeginFrame rendering.
 * Checks config.chromePath, then PRODUCER_HEADLESS_SHELL_PATH env var,
 * then the CLI browser override, HyperFrames' managed cache, and Puppeteer's cache.
 */
export function resolveHeadlessShellPath(
  config?: Partial<Pick<EngineConfig, "chromePath">>,
): string | undefined {
  if (config?.chromePath) {
    return config.chromePath;
  }
  if (process.env.PRODUCER_HEADLESS_SHELL_PATH) {
    const envPath = process.env.PRODUCER_HEADLESS_SHELL_PATH;
    if (!existsSync(envPath)) {
      throw new Error(
        `[BrowserManager] Chrome binary not found at PRODUCER_HEADLESS_SHELL_PATH="${envPath}". ` +
          "Run `hyperframes browser ensure` to re-download.",
      );
    }
    return envPath;
  }
  if (process.env.HYPERFRAMES_BROWSER_PATH) {
    const envPath = process.env.HYPERFRAMES_BROWSER_PATH;
    if (!existsSync(envPath)) {
      throw new Error(
        `[BrowserManager] Chrome binary not found at HYPERFRAMES_BROWSER_PATH="${envPath}". ` +
          "Run `hyperframes browser ensure` to re-download.",
      );
    }
    return envPath;
  }
  const home = homedir();
  return (
    findCachedHeadlessShell(
      join(home, ".cache", "hyperframes", "chrome", "chrome-headless-shell"),
    ) ?? findCachedHeadlessShell(join(home, ".cache", "puppeteer", "chrome-headless-shell"))
  );
}

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

async function getPuppeteerOrNull(): Promise<PuppeteerNode | null> {
  try {
    return await getPuppeteer();
  } catch {
    return null;
  }
}

function getHardwareGpuProbeArgs(platform: NodeJS.Platform): string[] {
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    ...getBrowserGpuArgs("hardware", platform),
  ];
}

function resolveWebGlProbeMode(info: WebGlProbeInfo): "software" | "hardware" {
  if (!info.hasWebGL) return "software";
  if (!info.vendor.trim() && !info.renderer.trim()) return "software";
  return isSoftwareWebGlRenderer(info.renderer) ? "software" : "hardware";
}

function describeWebGlProbe(info: WebGlProbeInfo): string {
  if (!info.hasWebGL) return "WebGL unavailable";
  return `WebGL renderer vendor=${JSON.stringify(info.vendor)} renderer=${JSON.stringify(info.renderer)}`;
}

function formatProbeFailure(err: unknown): string {
  return `probe failed (${err instanceof Error ? err.message : String(err)})`;
}

async function probeAutoBrowserGpuMode(options: {
  chromePath?: string;
  browserTimeout?: number;
  platform?: NodeJS.Platform;
}): Promise<"software" | "hardware"> {
  const platform = options.platform ?? process.platform;
  const browserTimeout = options.browserTimeout ?? DEFAULT_CONFIG.browserTimeout;
  const executablePath = options.chromePath ?? resolveHeadlessShellPath({});
  const ppt = await getPuppeteerOrNull();

  if (ppt === null) {
    logResolvedBrowserGpuMode("software", "puppeteer unavailable");
    return "software";
  }

  try {
    const info = await probeHardwareWebGlInfo(ppt, {
      args: getHardwareGpuProbeArgs(platform),
      browserTimeout,
      executablePath,
    });
    const resolved = resolveWebGlProbeMode(info);
    logResolvedBrowserGpuMode(resolved, describeWebGlProbe(info));
    return resolved;
  } catch (err) {
    logResolvedBrowserGpuMode("software", formatProbeFailure(err));
    return "software";
  }
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

  _autoBrowserGpuModeCache = probeAutoBrowserGpuMode(options);
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

function createBrowserLaunchFingerprint(
  chromeArgs: string[],
  config?: Partial<
    Pick<EngineConfig, "browserTimeout" | "protocolTimeout" | "chromePath" | "forceScreenshot">
  >,
): BrowserLaunchFingerprint {
  const launchConfig = {
    browserTimeout: DEFAULT_CONFIG.browserTimeout,
    protocolTimeout: DEFAULT_CONFIG.protocolTimeout,
    forceScreenshot: DEFAULT_CONFIG.forceScreenshot,
    ...config,
  };
  const headlessShell = resolveHeadlessShellPath(launchConfig);
  const requestedCaptureMode: CaptureMode =
    headlessShell && process.platform === "linux" && !launchConfig.forceScreenshot
      ? "beginframe"
      : "screenshot";
  return {
    args: chromeArgs,
    executablePath: headlessShell,
    browserTimeoutMs: launchConfig.browserTimeout,
    protocolTimeoutMs: launchConfig.protocolTimeout,
    requestedCaptureMode,
  };
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
  return browserLeasePool.acquire(createBrowserLaunchFingerprint(chromeArgs, config), enablePool);
}

// fallow-ignore-next-line complexity
async function launchBrowser(
  fingerprint: Readonly<BrowserLaunchFingerprint>,
): Promise<{ browser: Browser; captureMode: CaptureMode }> {
  const ppt = await getPuppeteer();
  let captureMode = fingerprint.requestedCaptureMode;
  let browser: Browser | undefined;
  try {
    browser = await ppt.launch({
      headless: true,
      args: [...fingerprint.args],
      defaultViewport: null,
      executablePath: fingerprint.executablePath,
      timeout: fingerprint.browserTimeoutMs,
      protocolTimeout: fingerprint.protocolTimeoutMs,
    });

    const browserVersion = await browser.version().catch(() => "unknown");
    const gpuFlags = fingerprint.args.filter(
      (a) => a.startsWith("--use-gl=") || a.startsWith("--use-angle="),
    );
    console.log(
      `[BrowserManager] Browser launched (${browserVersion}, ${captureMode}, gl=${gpuFlags.join(" ") || "default"}, headlessShell=${!!fingerprint.executablePath}, platform=${process.platform})`,
    );

    if (captureMode === "beginframe") {
      const supported = await probeBeginFrameSupport(browser).catch(() => true);
      if (!supported) {
        await browser.close().catch(() => {});
        browser = undefined;
        console.warn(
          "[BrowserManager] HeadlessExperimental.beginFrame unavailable in this Chromium build; falling back to screenshot mode.",
        );
        captureMode = "screenshot";
        browser = await ppt.launch({
          headless: true,
          args: stripBeginFrameFlags([...fingerprint.args]),
          defaultViewport: null,
          executablePath: fingerprint.executablePath,
          timeout: fingerprint.browserTimeoutMs,
          protocolTimeout: fingerprint.protocolTimeoutMs,
        });
      }
    }

    return { browser, captureMode };
  } catch (error) {
    await browser?.close().catch(() => {});
    throw error;
  }
}

function forceCloseBrowserProcess(browser: Browser): void {
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

const browserLeasePool = new BrowserLeasePool({
  launch: launchBrowser,
  close: async (browser) => browser.close(),
  forceClose: forceCloseBrowserProcess,
});

export async function releaseBrowser(
  browser: Browser,
  _config?: Partial<Pick<EngineConfig, "enableBrowserPool">>,
): Promise<void> {
  await browserLeasePool.releaseByBrowser(browser);
}

export function forceReleaseBrowser(browser: Browser): void {
  browserLeasePool.forceReleaseByBrowser(browser);
}

/**
 * Forcefully close the pooled browser if one exists, regardless of refCount.
 * Used for explicit cleanup at process exit or between independent render jobs
 * that should not share browser state.
 */
export async function drainBrowserPool(): Promise<void> {
  await browserLeasePool.drain();
}

/** Test-only: reset all pool state. */
export function _resetBrowserPoolForTests(): void {
  browserLeasePool.reset();
}

/** Test-only: inject a mock PuppeteerNode so tests bypass the dynamic import. */
export function _setPuppeteerForTests(mock: PuppeteerNode | undefined): void {
  _puppeteer = mock;
}

let _cachedVramMb: number | null = null;

function probeNvidiaVramMb(): number | null {
  if (_cachedVramMb !== null) return _cachedVramMb;
  try {
    // Synchronous, runs once per process (cached). ~50ms on typical systems.
    const out = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits", {
      timeout: 3000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const mb = parseInt(out.split("\n")[0] ?? "", 10);
    if (Number.isFinite(mb) && mb > 0) {
      _cachedVramMb = mb;
      return mb;
    }
  } catch {
    // nvidia-smi not available or no NVIDIA GPU
  }
  return null;
}

function getGpuMemBudgetMb(): number {
  const vram = probeNvidiaVramMb();
  if (vram) return Math.min(vram, 16384);

  const total = getSystemTotalMb();
  if (total < 4096) return 512;
  if (total <= LOW_MEMORY_TOTAL_MB_THRESHOLD) return 1024;
  return Math.min(Math.floor(total / 2), 16384);
}

function getLowMemoryFlags(): string[] {
  const total = getSystemTotalMb();
  if (total > LOW_MEMORY_TOTAL_MB_THRESHOLD) return [];
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
    // Allow AudioContext to start without a user gesture in headless Chrome.
    // Without this flag, any code path that constructs an AudioContext
    // (including GSAP tweening an <audio> element's volume) triggers the
    // autoplay policy and causes the AudioContext to stay suspended. The
    // frame-capture loop then blocks waiting for it, deadlocking the render.
    "--autoplay-policy=no-user-gesture-required",
  ];

  if (browserGpuMode !== "software") {
    chromeArgs.push(WEBGPU_FLAG);
  }

  // BeginFrame flags — only when using chrome-headless-shell on Linux
  if (options.captureMode !== "screenshot") {
    // SwiftShader's GPU compositor can retain a transformed layer for several
    // sequential frames after a GSAP yoyo/reversal. The DOM and timeline are
    // already at the requested time, but both BeginFrame and
    // Page.captureScreenshot read the stale surface (the duplicate is present
    // in the raw JPEG before encoding). Keep deterministic BeginFrame capture,
    // but route compositing through Chrome's software path when the browser is
    // already in software-GPU mode. Hardware-GPU and screenshot captures keep
    // their existing compositor paths. Remove this workaround once the pinned
    // chrome-headless-shell includes https://issues.chromium.org/issues/535256667.
    if (browserGpuMode === "software") {
      chromeArgs.push("--disable-gpu-compositing");
    }
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
      // Chrome 131+ headless shell only accepts (gl=angle, angle=gl-egl);
      // the old --use-gl=egl causes the GPU process to exit silently.
      // --ignore-gpu-blocklist: the operator explicitly opted into
      // browserGpuMode="hardware", so trust their driver/GPU choice.
      return [
        "--use-gl=angle",
        "--use-angle=gl-egl",
        "--enable-gpu-rasterization",
        "--ignore-gpu-blocklist",
        "--disable-software-rasterizer",
      ];
    default:
      return ["--enable-gpu-rasterization"];
  }
}
