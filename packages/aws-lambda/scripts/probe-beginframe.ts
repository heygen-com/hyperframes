#!/usr/bin/env tsx
/**
 * BeginFrame regression guard for `@sparticuz/chromium`.
 *
 * The load-bearing assumption of `@hyperframes/aws-lambda` is that the
 * Chromium build shipped by `@sparticuz/chromium` honours CDP
 * `HeadlessExperimental.beginFrame` with `screenshot: true`. This script
 * boots that Chromium build (decompressing into `/tmp` per the library's
 * runtime contract), navigates to a tiny static page, issues one
 * `beginFrame` with a screenshot request, and asserts the response
 * carries a PNG buffer.
 *
 * The script is the contract test, not a one-shot verification — every
 * release should run it inside the Docker container at
 * `scripts/probe-beginframe.dockerfile` to catch any future
 * `@sparticuz/chromium` rebuild that drops `HeadlessExperimental` support.
 *
 * Exits 0 on pass, 1 on fail. Run via:
 *
 *   bun run --cwd packages/aws-lambda probe:beginframe          # host
 *   bun run --cwd packages/aws-lambda probe:beginframe:docker   # Lambda-like
 */

import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface ProbeResult {
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

async function main(): Promise<void> {
  const start = Date.now();
  const result = await probe();
  result.durationMs = Date.now() - start;
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) {
    process.exit(1);
  }
}

async function probe(): Promise<ProbeResult> {
  let chromiumPath = "";
  try {
    const { default: chromium } = await import("@sparticuz/chromium");
    chromiumPath = await chromium.executablePath();
    const args = chromium.args;

    const puppeteer = await import("puppeteer-core");

    // Write probe HTML to /tmp + serve via file:// — no HTTP server in the
    // probe so we don't add a dependency surface that could mask a
    // Chrome-side issue. `mkdtempSync` (vs `tmpdir() + Date.now()`) gives
    // an unguessable directory name so two concurrent probes on the same
    // host don't collide and CodeQL's insecure-tempfile rule clears.
    const tmpHtmlDir = mkdtempSync(join(tmpdir(), "hf-beginframe-"));
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
    ];

    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: "shell",
      args: [...args, ...beginFrameFlags],
      defaultViewport: { width: 800, height: 600 },
    });
    try {
      const page = await browser.newPage();
      await page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const session = await page.createCDPSession();
      await session.send("HeadlessExperimental.enable");
      // Warm-up beginFrame with noDisplayUpdates: true — drives the
      // compositor without producing a screenshot, matching how the engine
      // primes a capture loop.
      await session.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks: 0,
        interval: 33,
        noDisplayUpdates: true,
      });
      const response = await session.send("HeadlessExperimental.beginFrame", {
        frameTimeTicks: 1000,
        interval: 33,
        screenshot: { format: "png" },
      });
      await fs.rm(tmpHtmlDir, { recursive: true, force: true }).catch(() => {});
      const screenshot = response.screenshotData ?? "";
      const bytes = screenshot ? Buffer.from(screenshot, "base64") : Buffer.alloc(0);
      const isPng =
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47;
      return {
        passed: isPng && bytes.length > 0,
        durationMs: 0,
        chromiumPath,
        screenshotBytes: bytes.length,
        hasDamage: response.hasDamage,
        detail: isPng
          ? "OK — BeginFrame returned a PNG buffer."
          : `FAIL — BeginFrame returned ${bytes.length} bytes, PNG signature ${
              bytes.length >= 4 ? bytes.subarray(0, 4).toString("hex") : "<empty>"
            }`,
      };
    } finally {
      await browser.close().catch(() => {});
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
  }
}

void main().catch((err) => {
  console.error("[probe-beginframe] unexpected:", err);
  process.exit(2);
});
