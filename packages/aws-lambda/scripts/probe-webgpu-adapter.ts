#!/usr/bin/env tsx
/** Reports whether the pinned Linux Chromium gets a hardware WebGPU adapter; a software-only host is reported, not a build failure. */
// Dynamic `puppeteer-core` import from a real file, same as probe-beginframe.ts —
// an inline `bun -e` eval's synthetic `/app/[eval]` path can't see the hoisted dep.
// Usage: bun probe-webgpu-adapter.ts --executable-path /opt/chrome/chrome-headless-shell

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChromeArgs,
  assertWebGpuAdapterAvailable,
  WebGpuUnavailableError,
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

  // navigator.gpu only exists on a secure-context origin; file:// is not one, http://127.0.0.1 is.
  const server = createServer((_req, res) => res.end(PROBE_HTML));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
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
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      await assertWebGpuAdapterAvailable(page, true);
      console.log("WebGPU adapter probe: hardware adapter available");
    } catch (err) {
      if (!(err instanceof WebGpuUnavailableError)) throw err;
      console.log(
        "WebGPU adapter probe: no usable adapter; data-requires-webgpu compositions will not render on this host",
      );
    } finally {
      await browser.close();
    }
  } finally {
    server.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((err) => {
    console.error("[probe-webgpu-adapter] FAIL —", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
