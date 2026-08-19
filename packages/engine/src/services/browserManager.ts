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

const CACHED_HEADLESS_SHELL_EXECUTABLES: Readonly<
  Record<string, readonly [directory: string, executable: string]>
> = {
  "darwin/arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  "darwin/x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
  "linux/x64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "win32/ia32": ["chrome-headless-shell-win32", "chrome-headless-shell.exe"],
  "win32/x64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
};

function cachedHeadlessShellExecutable(
  hostPlatform = process.platform,
  hostArch = process.arch,
): readonly [directory: string, executable: string] | undefined {
  // Chrome for Testing cache entries are host-specific. Resolve exactly one
  // platform/architecture directory so a foreign binary cannot win by probe order.
  // Chrome for Testing does not publish Linux ARM64 binaries. Windows ARM64 can
  // emulate x64 only on supported Windows 11 builds, which this platform/arch-only
  // resolver cannot prove, so both hosts deliberately fall through to system
  // browser discovery instead of attempting a potentially foreign cached binary.
  return CACHED_HEADLESS_SHELL_EXECUTABLES[`${hostPlatform}/${hostArch}`];
}

function findCachedHeadlessShell(baseDir: string): string | undefined {
  if (!existsSync(baseDir)) return undefined;
  const executable = cachedHeadlessShellExecutable();
  if (!executable) return undefined;
  try {
    const versions = readdirSync(baseDir).sort(compareBrowserVersionsDescending);
    for (const version of versions) {
      const binary = join(baseDir, version, ...executable);
      if (existsSync(binary)) return binary;
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
 * Probe the complete HeadlessExperimental.beginFrame runtime contract.
 *
 * Domain registration alone is insufficient: BeginFrame control must be
 * enabled at launch and a renderer-ready target must return a real PNG.
 * Every operation shares one short deadline so a wedged CDP call cannot hold
 * a serverless cold start until Puppeteer's much longer protocol timeout.
 */
interface BeginFrameProbeResult {
  supported: boolean;
  detail: string;
  durationMs: number;
}

const BEGINFRAME_SCREENSHOT_PROBE_ATTEMPTS = 10;
const BEGINFRAME_PROBE_TIMEOUT_MS = 2000;
const BEGINFRAME_PROBE_CLEANUP_TIMEOUT_MS = 250;

async function awaitBeforeDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  label: string,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`beginFrame probe timeout before ${label}`);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`beginFrame probe timeout during ${label}`)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function closeBrowserAfterFailedProbe(
  browser: Browser,
  timeoutMs = BEGINFRAME_PROBE_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  if (await settleWithin(browser.close(), timeoutMs)) return;
  // A wedged CDP transport can make graceful close inherit Puppeteer's
  // multi-minute protocol timeout. Kill the owned process and disconnect so
  // screenshot fallback can launch promptly.
  try {
    browser.process()?.kill("SIGKILL");
  } catch {
    // Best effort; disconnect below still releases Puppeteer's transport.
  }
  await settleWithin(browser.disconnect(), timeoutMs);
}

// The probe keeps its renderer setup, bounded CDP sequence, PNG validation,
// diagnostics, and cleanup together so every failure uses one contract.
// fallow-ignore-next-line complexity
async function probeBeginFrameSupport(
  browser: Browser,
  timeoutMs = BEGINFRAME_PROBE_TIMEOUT_MS,
): Promise<BeginFrameProbeResult> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let page;
  let result: BeginFrameProbeResult;
  try {
    page = await awaitBeforeDeadline(browser.newPage(), deadline, "newPage");
    // `browser.newPage()` resolves before a cold renderer has necessarily
    // submitted its first surface. Cloud Run exposed this as a false
    // "unsupported Chromium" result: probing the untouched about:blank
    // target raced renderer initialization, while the same binary passed
    // once a real document was ready. Navigate first so this tests protocol
    // capability rather than target-startup timing.
    await awaitBeforeDeadline(
      page.goto(
        "data:text/html,<style>html,body{margin:0;background:%23173}</style><div>hf-beginframe-probe</div>",
        { waitUntil: "domcontentloaded", timeout: timeoutMs },
      ),
      deadline,
      "navigation",
    );
    const client = await awaitBeforeDeadline(
      page.createCDPSession(),
      deadline,
      "CDP session creation",
    );
    await awaitBeforeDeadline(
      client.send("HeadlessExperimental.enable"),
      deadline,
      "HeadlessExperimental.enable",
    );
    await awaitBeforeDeadline(
      client.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks: 0,
        interval: 33,
        noDisplayUpdates: true,
      }),
      deadline,
      "warm-up beginFrame",
    );
    let bytes = Buffer.alloc(0);
    let isPng = false;
    let attempts = 0;
    for (attempts = 1; attempts <= BEGINFRAME_SCREENSHOT_PROBE_ATTEMPTS; attempts += 1) {
      const response = await awaitBeforeDeadline(
        client.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks: 1000 + (attempts - 1) * 33,
          interval: 33,
          screenshot: { format: "png" },
        }),
        deadline,
        `screenshot beginFrame attempt ${attempts}`,
      );
      const screenshot = response.screenshotData ?? "";
      bytes = screenshot ? Buffer.from(screenshot, "base64") : Buffer.alloc(0);
      isPng =
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47;
      if (isPng) break;
      await awaitBeforeDeadline(
        new Promise((resolveDelay) => setTimeout(resolveDelay, 10)),
        deadline,
        `screenshot retry delay ${attempts}`,
      );
    }
    if (!isPng) {
      throw new Error(
        `beginFrame screenshot returned ${bytes.length} bytes after ` +
          `${BEGINFRAME_SCREENSHOT_PROBE_ATTEMPTS} attempts with signature ` +
          `${bytes.length >= 4 ? bytes.subarray(0, 4).toString("hex") : "<empty>"}`,
      );
    }
    await awaitBeforeDeadline(client.detach(), deadline, "CDP detach").catch(() => {});
    result = {
      supported: true,
      detail:
        `enable + warm-up + ${bytes.length}-byte PNG beginFrame succeeded ` +
        `after ${attempts} screenshot attempt(s)`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    result = {
      supported: false,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
  if (page && !(await settleWithin(page.close(), BEGINFRAME_PROBE_CLEANUP_TIMEOUT_MS))) {
    return {
      supported: false,
      detail: `${result.detail}; probe page cleanup timed out`,
      durationMs: Date.now() - started,
    };
  }
  return result;
}

/** Test-only export for the renderer-readiness + PNG capability contract. */
export const _probeBeginFrameSupportForTests = probeBeginFrameSupport;
/** Test-only export for the forced browser-cleanup fallback. */
export const _closeBrowserAfterFailedProbeForTests = closeBrowserAfterFailedProbe;

/**
 * Outcome of the one-shot WebGL probe.
 *
 * `cause` distinguishes the two ways a probe lands on `"software"`, because
 * they need OPPOSITE remediation:
 *   - `"no-gpu"`  — the probe ran and Chrome reported a software renderer
 *                   (SwiftShader / llvmpipe). Remediation: GPU passthrough.
 *   - `"probe-error"` — the probe itself failed (Chrome couldn't launch, bad
 *                   executable path, sandbox denied). We have NO evidence
 *                   about the GPU either way; telling the operator to fix GPU
 *                   passthrough would send them chasing the wrong problem.
 */
interface GpuProbeOutcome {
  mode: "software" | "hardware";
  cause?: "no-gpu" | "probe-error";
}

/**
 * Cached *in-flight or resolved* probe Promise, shared by BOTH the `"auto"`
 * and explicit `"hardware"` entry points of `resolveBrowserGpuMode`.
 *
 * Caching the Promise (rather than the resolved value) deduplicates concurrent
 * callers — the parallel coordinator runs N workers via `Promise.all`, so a
 * `--workers 4` render against a no-GPU host would otherwise fire 4
 * simultaneous probe Chromes. The first call assigns the Promise and every
 * other concurrent caller awaits the same one, paying the ~240 ms probe cost
 * exactly once per process lifetime.
 */
let _autoBrowserGpuModeCache: Promise<GpuProbeOutcome> | undefined;

/** Test-only: reset the cached probe result. */
export function _resetAutoBrowserGpuModeCacheForTests(): void {
  _autoBrowserGpuModeCache = undefined;
  _unverifiedHardwareGpuWarned = false;
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
}): Promise<GpuProbeOutcome> {
  const platform = options.platform ?? process.platform;
  const browserTimeout = options.browserTimeout ?? DEFAULT_CONFIG.browserTimeout;
  const executablePath = options.chromePath ?? resolveHeadlessShellPath({});
  const ppt = await getPuppeteerOrNull();

  if (ppt === null) {
    logResolvedBrowserGpuMode("software", "puppeteer unavailable");
    return { mode: "software", cause: "probe-error" };
  }

  try {
    const info = await probeHardwareWebGlInfo(ppt, {
      args: getHardwareGpuProbeArgs(platform),
      browserTimeout,
      executablePath,
    });
    const resolved = resolveWebGlProbeMode(info);
    logResolvedBrowserGpuMode(resolved, describeWebGlProbe(info));
    return resolved === "hardware" ? { mode: "hardware" } : { mode: "software", cause: "no-gpu" };
  } catch (err) {
    logResolvedBrowserGpuMode("software", formatProbeFailure(err));
    return { mode: "software", cause: "probe-error" };
  }
}

/**
 * Resolve `browserGpuMode` to a concrete `"software" | "hardware"` answer.
 *
 * For `"software"` this is a pure pass-through. For `"auto"` it launches a
 * tiny Chrome with the platform's hardware GPU args, runs a one-shot WebGL
 * availability probe, and falls back to `"software"` if hardware-mode WebGL
 * is unavailable. The Promise is cached for the process lifetime, so
 * concurrent callers (parallel workers) share the same probe.
 *
 * `"hardware"` (an explicit `--browser-gpu` / `PRODUCER_BROWSER_GPU_MODE=
 * hardware`) is honoured verbatim — the operator asked for it — but runs the
 * SAME probe to VERIFY it, because Chrome's hardware GL args are advisory:
 * with no usable GPU in the sandbox (no `/dev/dri`, no NVIDIA container
 * runtime, missing EGL/driver libraries) Chrome silently falls back to
 * software WebGL and the render just runs at CPU speed. Without this check
 * the only trace is a buried `Automatic fallback to software WebGL` browser
 * warning — heygen-com/hyperframes#2967 rendered 19186 frames on CPU while
 * `--browser-gpu` was set and nothing said so. The probe result never
 * changes the returned mode; it only makes the fallback loud.
 *
 * Any probe failure (Chrome launch error, navigation timeout, missing canvas
 * API, etc.) is treated as a `"software"` result. The render path with
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
  if (mode === "software") return Promise.resolve(mode);

  _autoBrowserGpuModeCache ??= probeAutoBrowserGpuMode(options);
  if (mode === "auto") return _autoBrowserGpuModeCache.then((probed) => probed.mode);

  return _autoBrowserGpuModeCache.then((probed) => {
    // Warn once per cache lifetime, not once per caller: `createCaptureSession`
    // resolves the mode for the probe browser AND every parallel worker, so
    // an un-deduplicated warning prints N+1 times and buries itself.
    if (probed.mode === "software" && !_unverifiedHardwareGpuWarned) {
      _unverifiedHardwareGpuWarned = true;
      console.warn(
        buildUnverifiedHardwareGpuWarning(options.platform ?? process.platform, probed.cause),
      );
    }
    return "hardware";
  });
}

/**
 * Latch for the explicit-hardware-probed-to-software warning: fires once per
 * cache lifetime (re-armed by `_resetAutoBrowserGpuModeCacheForTests`).
 */
let _unverifiedHardwareGpuWarned = false;

/**
 * Warning text for "you asked for hardware GPU and we could not confirm it".
 *
 * Splits on `cause` because the two failure shapes need opposite remediation.
 * A probe that RAN and saw SwiftShader is a GPU-passthrough problem. A probe
 * that could not run tells us nothing about the GPU — pointing that operator
 * at `--gpus all` would send them chasing a phantom while their Chrome
 * install is the actual fault.
 */
function buildUnverifiedHardwareGpuWarning(
  platform: NodeJS.Platform | string,
  cause: GpuProbeOutcome["cause"],
): string {
  if (cause === "probe-error") {
    return (
      "[hyperframes] browserGpuMode=hardware was requested, but the GPU probe could not run, " +
      "so hardware acceleration is UNVERIFIED — if Chrome falls back to software WebGL the " +
      "capture will run at CPU speed. Honouring the explicit request anyway.\n" +
      "  This is a probe failure, not evidence of a missing GPU: see the " +
      "`browserGpuMode probe → software (probe failed ...)` line above for the underlying " +
      "error, which usually means Chrome could not launch (bad HYPERFRAMES_BROWSER_PATH, " +
      "missing shared libraries, or a denied sandbox) rather than a GPU problem.\n" +
      "  Run `hyperframes doctor` to check the Chrome install."
    );
  }
  const remediation =
    platform === "linux"
      ? "Inside Docker, the container needs GPU passthrough: `--gpus all` with the NVIDIA " +
        "Container Toolkit installed, or `--device /dev/dri` for Mesa/AMD/Intel. The image " +
        "also needs the matching userspace driver + libEGL. Verify with " +
        "`hyperframes render --browser-gpu` and watch for this warning disappearing."
      : "Check that the host exposes a GPU to this process and that the graphics drivers are " +
        "installed.";
  return (
    "[hyperframes] browserGpuMode=hardware was requested, but the WebGL probe found no " +
    "hardware GPU — Chrome will silently fall back to software WebGL and the capture will " +
    "run at CPU speed. Honouring the explicit request anyway.\n" +
    `  ${remediation}\n` +
    "  Pass --no-browser-gpu to select deterministic SwiftShader instead of waiting on a " +
    "hardware path that is not there."
  );
}

/**
 * Single observability surface for the GPU probe outcome. Logged exactly
 * once per process (the probe runs once); without this line, a regression
 * to "always software even with a GPU present" would be invisible in
 * production. Goes to stderr to stay out of stdout pipelines. Says "probe"
 * rather than "auto" because explicit `browserGpuMode=hardware` runs the
 * same probe to verify itself.
 */
function logResolvedBrowserGpuMode(resolved: "hardware" | "software", reason: string): void {
  console.error(`[hyperframes] browserGpuMode probe → ${resolved} (${reason})`);
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
  // The launch arguments are the authoritative capture-mode contract.
  // A caller can pass `forceScreenshot:false` while a later safety clamp
  // deliberately omits BeginFrame control flags. Inferring solely from the
  // raw config in that case makes BrowserManager probe a capability it never
  // enabled, then mislabel the result as an unsupported Chromium build.
  const beginFrameControlEnabled = chromeArgs.includes("--enable-begin-frame-control");
  const requestedCaptureMode: CaptureMode =
    headlessShell &&
    process.platform === "linux" &&
    !launchConfig.forceScreenshot &&
    beginFrameControlEnabled
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

/** Test-only export for launch-argument/capture-mode agreement. */
export const _createBrowserLaunchFingerprintForTests = createBrowserLaunchFingerprint;

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
      const probe = await probeBeginFrameSupport(browser).catch((error) => ({
        supported: true,
        detail: `probe harness error ignored: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: 0,
      }));
      if (!probe.supported) {
        await closeBrowserAfterFailedProbe(browser);
        browser = undefined;
        console.warn(
          `[BrowserManager] HeadlessExperimental.beginFrame probe failed after ${probe.durationMs}ms: ` +
            `${probe.detail}; falling back to screenshot mode.`,
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

  // SwiftShader's GPU compositor can retain a transformed layer for several
  // sequential frames after a GSAP yoyo/reversal, and it re-presents stale
  // raster for a partially invalidated layer: content already drawn in an
  // earlier seek is never cleared, so successive captures accumulate copies of
  // it (HF#3049 — a moving SVG group smears wider on every frame, and static
  // siblings appear duplicated one band lower). The DOM and timeline are
  // already at the requested time; the defect is in the compositor surface both
  // BeginFrame and Page.captureScreenshot read, so it is not specific to a
  // capture mode — it is specific to compositing on SwiftShader.
  //
  // Routing compositing through Chrome's software path is the only mitigation
  // that holds: capture-side changes (fromSurface, captureBeyondViewport, a
  // second capture, extra rAF ticks, a 250ms settle) and every raster/tiling
  // flag (--disable-partial-raster, --disable-checker-imaging, --disable-zero-copy,
  // forced tile sizes) leave the accumulation untouched. The cost is that
  // SwiftShader rasterizes thin strokes and glyph edges slightly differently
  // (antialiased edges only — measured on HF#3049's frame 0: 96 opaque pixels
  // differ, by 1/255). Duplicated content in 68% of frames is the worse defect.
  //
  // Remove this workaround once the pinned chrome-headless-shell includes
  // https://issues.chromium.org/issues/535256667.
  if (browserGpuMode === "software") {
    chromeArgs.push("--disable-gpu-compositing");
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
