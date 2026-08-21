#!/usr/bin/env tsx
// fallow-ignore-file code-duplication
/**
 * BeginFrame regression guard for a Chromium executable.
 *
 * With no arguments, this boots the build shipped by `@sparticuz/chromium`
 * (decompressing into `/tmp` per the library's runtime contract). Passing
 * `--executable-path /path/to/chrome-headless-shell` probes an arbitrary
 * executable instead; the GCP image build uses that form against the exact
 * binary copied into the image.
 *
 * The script is the contract test, not a one-shot verification — every
 * release should run it inside the Docker container at
 * `scripts/probe-beginframe.dockerfile` to catch any future
 * `@sparticuz/chromium` rebuild that drops `HeadlessExperimental` support.
 *
 * Exits 0 on pass, 1 on fail. Run via:
 *
 *   bun run --cwd packages/aws-lambda probe:beginframe
 *   bun run --cwd packages/aws-lambda probe:beginframe -- \
 *     --executable-path /opt/chrome/chrome-headless-shell
 *   bun run --cwd packages/aws-lambda probe:beginframe:docker
 */

import { mkdtempSync, promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ProbeResult {
  passed: boolean;
  durationMs: number;
  chromiumPath: string;
  screenshotBytes: number;
  hasDamage: boolean;
  detail: string;
}

const PROBE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>hf-beginframe-probe</title>
<style>html,body{margin:0;background:#173;color:#fff;font:48px/1 sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}</style>
</head><body><div id="x">hf-beginframe-probe</div></body></html>`;
const SCREENSHOT_ATTEMPTS = 10;
const PROBE_OPERATION_TIMEOUT_MS = 5000;
const PROBE_CLEANUP_TIMEOUT_MS = 250;

export interface ProbeOptions {
  executablePath?: string;
  /** Exact launch arguments to probe instead of the standalone default profile. */
  launchArgs?: string[];
  /** Test override for the renderer/CDP operation deadline. */
  timeoutMs?: number;
}

// The CLI accepts paired and equals forms for two independent path options.
// fallow-ignore-next-line complexity
export function parseProbeArgs(args: string[]): ProbeOptions {
  let executablePath: string | undefined;
  let launchArgs: string[] | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--executable-path") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--executable-path requires a path");
      }
      executablePath = resolve(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--executable-path=")) {
      const value = arg.slice("--executable-path=".length);
      if (!value) throw new Error("--executable-path requires a path");
      executablePath = resolve(value);
      continue;
    }
    if (arg === "--launch-args-json") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--launch-args-json requires a path");
      }
      launchArgs = readLaunchArgs(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--launch-args-json=")) {
      const value = arg.slice("--launch-args-json=".length);
      if (!value) throw new Error("--launch-args-json requires a path");
      launchArgs = readLaunchArgs(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    ...(executablePath ? { executablePath } : {}),
    ...(launchArgs ? { launchArgs } : {}),
  };
}

function readLaunchArgs(path: string): string[] {
  const resolved = resolve(path);
  const value: unknown = JSON.parse(readFileSync(resolved, "utf-8"));
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`--launch-args-json must contain a JSON string array: ${resolved}`);
  }
  return value;
}

async function awaitBeforeDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  label: string,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error(`BeginFrame probe timeout before ${label}`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`BeginFrame probe timeout during ${label}`)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Test-only export for the standalone probe's bounded-operation contract. */
export const _awaitBeforeDeadlineForTests = awaitBeforeDeadline;

interface ProbeBrowserCleanup {
  close(): Promise<void>;
  disconnect(): Promise<void>;
  process(): { kill(signal?: NodeJS.Signals | number): boolean } | null;
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

async function closeBrowserForProbe(
  browser: ProbeBrowserCleanup,
  timeoutMs = PROBE_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  if (await settleWithin(browser.close(), timeoutMs)) return;
  try {
    browser.process()?.kill("SIGKILL");
  } catch {
    // Best effort; disconnect below still releases Puppeteer's transport.
  }
  await settleWithin(browser.disconnect(), timeoutMs);
}

/** Test-only export for bounded standalone-probe cleanup. */
export const _closeBrowserForProbeTests = closeBrowserForProbe;

async function main(): Promise<void> {
  const start = Date.now();
  const result = await probe(parseProbeArgs(process.argv.slice(2)));
  result.durationMs = Date.now() - start;
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) {
    process.exit(1);
  }
}

// This intentionally linear contract owns launch, renderer setup, CDP
// validation, diagnostics, and cleanup in one fail-closed lifecycle.
// fallow-ignore-next-line complexity
export async function probe(options: ProbeOptions = {}): Promise<ProbeResult> {
  let chromiumPath = "";
  let tmpHtmlDir = "";
  try {
    let sourceArgs: string[] = [];
    if (options.executablePath) {
      chromiumPath = options.executablePath;
    } else {
      const { default: chromium } = await import("@sparticuz/chromium");
      chromiumPath = await chromium.executablePath();
      sourceArgs = chromium.args;
    }

    const puppeteer = await import("puppeteer-core");

    // Write probe HTML to /tmp + serve via file:// — no HTTP server in the
    // probe so we don't add a dependency surface that could mask a
    // Chrome-side issue. `mkdtempSync` (vs `tmpdir() + Date.now()`) gives
    // an unguessable directory name so two concurrent probes on the same
    // host don't collide and CodeQL's insecure-tempfile rule clears.
    tmpHtmlDir = mkdtempSync(join(tmpdir(), "hf-beginframe-"));
    const htmlPath = join(tmpHtmlDir, "probe.html");
    await fs.writeFile(htmlPath, PROBE_HTML, "utf-8");

    // BeginFrame requires the full compositor-driving flag set. These match
    // the args the engine's `browserManager` passes when `captureMode !==
    // "screenshot"`. Without the surface-synchronization + threaded-disable
    // flags, Chrome's compositor returns `hasDamage: false` and skips the
    // screenshot — the same observation pinned in the hyperframes memory
    // ("Chrome's beginFrame with `screenshot` param always reports
    // hasDamage=true").
    const beginFrameFlags = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--deterministic-mode",
      "--enable-begin-frame-control",
      "--disable-new-content-rendering-timeout",
      "--run-all-compositor-stages-before-draw",
      "--disable-threaded-animation",
      "--disable-threaded-scrolling",
      "--disable-checker-imaging",
      "--disable-image-animation-resync",
      "--enable-surface-synchronization",
      // Software GL — Lambda has no GPU; matches the in-process renderer's
      // software-locked path.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      // Distributed Linux rendering explicitly uses software compositing to
      // avoid stale transformed layers in SwiftShader (see browserManager).
      "--disable-gpu-compositing",
    ];

    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: "shell",
      args: options.launchArgs ?? [...sourceArgs, ...beginFrameFlags],
      defaultViewport: { width: 800, height: 600 },
    });
    try {
      const timeoutMs = options.timeoutMs ?? PROBE_OPERATION_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;
      const page = await awaitBeforeDeadline(browser.newPage(), deadline, "newPage");
      await awaitBeforeDeadline(
        page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
        deadline,
        "navigation",
      );
      const session = await awaitBeforeDeadline(
        page.createCDPSession(),
        deadline,
        "CDP session creation",
      );
      await awaitBeforeDeadline(
        session.send("HeadlessExperimental.enable"),
        deadline,
        "HeadlessExperimental.enable",
      );
      // Warm-up beginFrame with noDisplayUpdates: true — drives the
      // compositor without producing a screenshot, matching how the engine
      // primes a capture loop.
      await awaitBeforeDeadline(
        session.send("HeadlessExperimental.beginFrame", {
          frameTimeTicks: 0,
          interval: 33,
          noDisplayUpdates: true,
        }),
        deadline,
        "warm-up beginFrame",
      );
      let hasDamage = false;
      let bytes = Buffer.alloc(0);
      let isPng = false;
      let attempts = 0;
      // A renderer-ready document can still need more than one controlled
      // frame before it submits a screenshot surface. Chromium explicitly
      // permits screenshotData to be absent during renderer initialization,
      // so retry a small bounded sequence with monotonically increasing ticks.
      for (attempts = 1; attempts <= SCREENSHOT_ATTEMPTS; attempts += 1) {
        const response = await awaitBeforeDeadline(
          session.send("HeadlessExperimental.beginFrame", {
            frameTimeTicks: 1000 + (attempts - 1) * 33,
            interval: 33,
            screenshot: { format: "png" },
          }),
          deadline,
          `screenshot beginFrame attempt ${attempts}`,
        );
        hasDamage = response.hasDamage;
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
      return {
        passed: isPng && bytes.length > 0,
        durationMs: 0,
        chromiumPath,
        screenshotBytes: bytes.length,
        hasDamage,
        detail: isPng
          ? `OK — BeginFrame returned a PNG buffer after ${attempts} attempt(s).`
          : `FAIL — BeginFrame returned ${bytes.length} bytes after ${SCREENSHOT_ATTEMPTS} ` +
            `attempts, PNG signature ${
              bytes.length >= 4 ? bytes.subarray(0, 4).toString("hex") : "<empty>"
            }`,
      };
    } finally {
      await closeBrowserForProbe(browser);
    }
  } catch (err) {
    return {
      passed: false,
      durationMs: 0,
      chromiumPath,
      screenshotBytes: 0,
      hasDamage: false,
      detail: `FAIL — ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (tmpHtmlDir) {
      await fs.rm(tmpHtmlDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((err) => {
    console.error("[probe-beginframe] unexpected:", err);
    process.exit(2);
  });
}
