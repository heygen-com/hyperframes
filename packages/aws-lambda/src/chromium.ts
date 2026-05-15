/**
 * Lambda-runtime Chrome resolver.
 *
 * `renderChunk()` (the only primitive that needs a browser) launches Chrome
 * via the engine's `BrowserManager`. In Lambda we can't ship the full
 * Puppeteer-managed Chrome download — Puppeteer's Chrome binary is ~330 MB
 * unzipped, well over Lambda's 250 MB ZIP-deploy ceiling.
 *
 * Two valid runtime sources:
 *
 *   1. `@sparticuz/chromium` (primary). Decompresses a Lambda-optimised
 *      `chrome-headless-shell` build into `/tmp` at runtime. ~70 MB
 *      compressed; the same binary the rest of the ecosystem uses for
 *      headless-Chrome-in-Lambda. CDP-level BeginFrame works because the
 *      command lives in the protocol, not the binary; the
 *      `scripts/probe-beginframe.ts` regression guard pins this.
 *
 *   2. A bundled `chrome-headless-shell` binary (fallback). If
 *      `@sparticuz/chromium`'s build ever drops `HeadlessExperimental`
 *      support, we fall back to the same `chrome-headless-shell` build
 *      the K8s deploy uses. The fallback raises the ZIP from ~70 MB
 *      Chrome to ~140 MB Chrome — still well under 250 MB.
 *
 * The runtime path is selected by the `HYPERFRAMES_LAMBDA_CHROME_SOURCE`
 * env var (set by `build-zip.ts`):
 *
 *   "sparticuz"          → use `@sparticuz/chromium.executablePath()`
 *   "chrome-headless-shell" → use `process.env.HYPERFRAMES_LAMBDA_CHROME_PATH`
 *
 * Adapters that bundle this package can override
 * `HYPERFRAMES_LAMBDA_CHROME_PATH` directly when running outside Lambda
 * (e.g. the SAM-local RIE smoke).
 */

import { existsSync } from "node:fs";

/** Discriminator for the two supported Chrome sources. */
export type ChromeSource = "sparticuz" | "chrome-headless-shell";

/**
 * Read which Chrome source the bundled ZIP was built against. Defaults to
 * `"sparticuz"` so a fresh build with no env override picks the primary
 * path.
 */
export function resolveChromeSource(): ChromeSource {
  const raw = process.env.HYPERFRAMES_LAMBDA_CHROME_SOURCE?.toLowerCase();
  if (raw === "chrome-headless-shell" || raw === "shell") return "chrome-headless-shell";
  return "sparticuz";
}

/**
 * Resolve the absolute path to a Chrome binary suitable for BeginFrame.
 *
 * For `"sparticuz"`: dynamically import `@sparticuz/chromium` and call
 * `chromium.executablePath()`. The module is dynamic so a build-zip that
 * never reaches the import (because the fallback Chrome is bundled) can
 * tree-shake it out.
 *
 * For `"chrome-headless-shell"`: read the path from
 * `HYPERFRAMES_LAMBDA_CHROME_PATH`. Throws if absent or non-existent so a
 * misconfigured deploy fails loudly at boot rather than at first frame.
 */
export async function resolveChromeExecutablePath(): Promise<string> {
  const source = resolveChromeSource();
  if (source === "sparticuz") {
    const mod = await loadSparticuzChromium();
    return mod.executablePath();
  }
  const explicit = process.env.HYPERFRAMES_LAMBDA_CHROME_PATH;
  if (!explicit) {
    throw new Error(
      "[chromium] HYPERFRAMES_LAMBDA_CHROME_SOURCE=chrome-headless-shell requires " +
        "HYPERFRAMES_LAMBDA_CHROME_PATH to be set to the absolute path of the bundled binary.",
    );
  }
  if (!existsSync(explicit)) {
    throw new Error(
      `[chromium] HYPERFRAMES_LAMBDA_CHROME_PATH=${JSON.stringify(explicit)} does not exist`,
    );
  }
  return explicit;
}

/**
 * Resolve the Chromium launch args for the selected source. For
 * `@sparticuz/chromium` we forward `chromium.args` (Lambda-tuned defaults
 * — single-process, no-sandbox, /tmp paths). For the shell fallback the
 * engine's own arg builder owns it; we return an empty array so the
 * engine's defaults apply.
 */
export async function resolveChromeArgs(): Promise<string[]> {
  if (resolveChromeSource() !== "sparticuz") return [];
  const mod = await loadSparticuzChromium();
  return mod.args;
}

/**
 * Dynamic import wrapper isolated so unit tests can stub the module without
 * jest-style module mocking gymnastics. The narrow type here pins the
 * subset of `@sparticuz/chromium`'s surface this package depends on; if
 * the upstream module ever changes shape the type error here surfaces
 * before runtime.
 */
interface SparticuzChromiumModule {
  args: string[];
  executablePath(): Promise<string>;
}

let cachedSparticuz: SparticuzChromiumModule | null = null;

async function loadSparticuzChromium(): Promise<SparticuzChromiumModule> {
  if (cachedSparticuz) return cachedSparticuz;
  const mod = (await import("@sparticuz/chromium")) as
    | SparticuzChromiumModule
    | { default: SparticuzChromiumModule };
  const resolved = "default" in mod ? mod.default : mod;
  cachedSparticuz = resolved;
  return resolved;
}

/** Test-only seam: replace the cached `@sparticuz/chromium` module. */
export function _setSparticuzChromiumForTests(mod: SparticuzChromiumModule | null): void {
  cachedSparticuz = mod;
}
