#!/usr/bin/env tsx
/** Fails closed if the pinned Linux Chromium can't get a WebGPU adapter in software GPU mode. */
// Dynamic `puppeteer-core` import from a real file, same as probe-beginframe.ts —
// an inline `bun -e` eval's synthetic `/app/[eval]` path can't see the hoisted dep.
// Usage: bun probe-webgpu-adapter.ts --executable-path /opt/chrome/chrome-headless-shell

import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChromeArgs,
  assertWebGpuAdapterAvailable,
} from "../../engine/src/services/browserManager.ts";

const PROBE_HTML = '<div data-composition-id="probe" data-requires-webgpu></div>';

function parseExecutablePath(args: string[]): string {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--executable-path") return resolve(args[i + 1]);
    if (args[i].startsWith("--executable-path=")) {
      return resolve(args[i].slice("--executable-path=".length));
    }
  }
  throw new Error("--executable-path is required");
}

async function main(): Promise<void> {
  const executablePath = parseExecutablePath(process.argv.slice(2));
  const puppeteer = await import("puppeteer-core");

  const tmpHtmlDir = mkdtempSync(join(tmpdir(), "hf-webgpu-probe-"));
  const htmlPath = join(tmpHtmlDir, "probe.html");
  try {
    await fs.writeFile(htmlPath, PROBE_HTML, "utf-8");

    const args = buildChromeArgs(
      {
        width: 800,
        height: 600,
        captureMode: "screenshot",
        platform: "linux",
        requiresWebGpu: true,
      },
      { browserGpuMode: "software" },
    );
    const browser = await puppeteer.launch({ executablePath, headless: true, args });
    try {
      const page = await browser.newPage();
      await page.goto(`file://${htmlPath}`);
      await assertWebGpuAdapterAvailable(page, true);
    } finally {
      await browser.close();
    }
    console.log("WebGPU adapter probe: OK");
  } finally {
    await fs.rm(tmpHtmlDir, { recursive: true, force: true }).catch(() => {});
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((err) => {
    console.error("[probe-webgpu-adapter] FAIL —", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
