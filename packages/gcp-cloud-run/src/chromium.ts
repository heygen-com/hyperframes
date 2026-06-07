/**
 * Cloud Run Chrome resolver.
 *
 * `renderChunk()` (the only primitive that needs a browser) launches Chrome
 * via the engine's `BrowserManager`. Because Cloud Run runs a container
 * image rather than a size-capped ZIP, the Chrome story is far simpler than
 * the Lambda adapter's: the `Dockerfile` installs `chrome-headless-shell`
 * (the same BeginFrame-capable build the K8s deploy uses) into the image at
 * a known path and exports `HYPERFRAMES_CHROME_PATH`. There is no runtime
 * decompression-into-/tmp step and no 250 MB packaging ceiling to fight.
 *
 * Resolution order:
 *   1. `PRODUCER_HEADLESS_SHELL_PATH` — the engine's own override. If a
 *      caller (or the Docker image) already set it, honour it untouched.
 *   2. `HYPERFRAMES_CHROME_PATH` — set by the Dockerfile to the installed
 *      `chrome-headless-shell` binary.
 *   3. A small list of conventional install paths, as a last resort for
 *      images built outside our Dockerfile.
 *
 * Throws {@link ChromeBinaryUnavailableError} when nothing resolves, so a
 * misconfigured image fails loudly at the first chunk rather than emitting
 * a confusing puppeteer-core "executablePath must be specified" assertion.
 */

import { existsSync } from "node:fs";

/**
 * Thrown when the Chrome binary resolver can't produce a usable path. The
 * class name is the workflow's non-retryable error discriminator.
 */
export class ChromeBinaryUnavailableError extends Error {
  // Read indirectly via the error envelope / Error.prototype.toString.
  // fallow-ignore-next-line unused-class-member
  override readonly name = "ChromeBinaryUnavailableError";
  readonly resolvedPath: string | null;
  constructor(resolvedPath: string | null, hint: string) {
    super(`[chromium] Chrome binary unavailable: ${hint}`);
    this.resolvedPath = resolvedPath;
  }
}

/**
 * Conventional locations a `chrome-headless-shell` (or full Chrome) binary
 * may live at in a Debian/Ubuntu-based container. Checked only after the
 * two env-var overrides miss.
 */
const FALLBACK_CHROME_PATHS = [
  "/opt/chrome/chrome-headless-shell",
  "/usr/bin/chrome-headless-shell",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Resolve the absolute path to a Chrome binary suitable for BeginFrame.
 * Pure (no env mutation) so callers decide whether to export the result
 * into `PRODUCER_HEADLESS_SHELL_PATH`.
 */
// fallow-ignore-next-line complexity
export function resolveChromeExecutablePath(): string {
  const fromEngineOverride = process.env.PRODUCER_HEADLESS_SHELL_PATH?.trim();
  if (fromEngineOverride) {
    if (!existsSync(fromEngineOverride)) {
      throw new ChromeBinaryUnavailableError(
        fromEngineOverride,
        `PRODUCER_HEADLESS_SHELL_PATH=${JSON.stringify(fromEngineOverride)} does not exist on disk.`,
      );
    }
    return fromEngineOverride;
  }

  const fromImage = process.env.HYPERFRAMES_CHROME_PATH?.trim();
  if (fromImage) {
    if (!existsSync(fromImage)) {
      throw new ChromeBinaryUnavailableError(
        fromImage,
        `HYPERFRAMES_CHROME_PATH=${JSON.stringify(fromImage)} does not exist on disk.`,
      );
    }
    return fromImage;
  }

  for (const candidate of FALLBACK_CHROME_PATHS) {
    if (existsSync(candidate)) return candidate;
  }

  throw new ChromeBinaryUnavailableError(
    null,
    "no Chrome binary found. Set HYPERFRAMES_CHROME_PATH (the Dockerfile does this) or " +
      "PRODUCER_HEADLESS_SHELL_PATH to the absolute path of a chrome-headless-shell binary. " +
      `Searched: ${FALLBACK_CHROME_PATHS.join(", ")}.`,
  );
}
