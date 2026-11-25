// Prints PINNED_SHELL_DIGESTS for packages/engine/src/services/chromeHostCeiling.ts: each pinned build's headless
// shell, downloaded from Chrome for Testing with the installer the CLI uses, digested as the CLI checks it.
//
//   bun run --cwd packages/cli pin:chrome 158.0.8127.88 150.0.7871.124

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Browser, BrowserPlatform, install } from "@puppeteer/browsers";
import { headlessShellDigest, managedChromeVersion } from "@hyperframes/engine/chrome-host-ceiling";

const PLATFORMS = [
  BrowserPlatform.MAC_ARM,
  BrowserPlatform.MAC,
  BrowserPlatform.LINUX,
  BrowserPlatform.WIN32,
  BrowserPlatform.WIN64,
];

const builds = process.argv.slice(2);
if (builds.length === 0) throw new Error("Name the builds to pin.");
const digests: Record<string, string[]> = {};
for (const buildId of builds) {
  digests[buildId] = [];
  for (const platform of PLATFORMS) {
    // Only macOS 12 is ever given a build other than the current one (managedChromeVersion).
    if (buildId !== managedChromeVersion("linux") && !platform.startsWith("mac")) continue;
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-pin-chrome-"));
    try {
      const { executablePath } = await install({
        browser: Browser.CHROMEHEADLESSSHELL,
        buildId,
        platform,
        cacheDir,
      });
      const digest = headlessShellDigest(dirname(executablePath));
      if (!digest) throw new Error(`${buildId} ${platform}: the unpacked folder holds a link`);
      console.error(`${buildId} ${platform} ${digest}`);
      digests[buildId].push(digest);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
}
console.log(JSON.stringify(digests, null, 2));
