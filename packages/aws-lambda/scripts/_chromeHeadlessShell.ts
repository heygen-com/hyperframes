import { cpSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CHROME_WRITES_WHILE_RUNNING,
  headlessShellDigest,
  managedChromeVersion,
  PINNED_SHELL_DIGESTS,
} from "@hyperframes/engine/chrome-host-ceiling";
import { BUNDLED_SHELL_DIR } from "../src/chromium.js";

/**
 * Stage the repo's pinned linux64 chrome-headless-shell from the Puppeteer cache under `home` into
 * `<stagingDir>/<BUNDLED_SHELL_DIR>/`. The whole folder: the executable alone exits at launch
 * ("Invalid file descriptor to ICU data received") without icudtl.dat and its .pak files.
 * Only the pinned build, and only when its folder matches that build's own pinned digest; the files the digest leaves
 * out are not copied. Returns the version.
 */
export function stageChromeHeadlessShell(
  stagingDir: string,
  home = process.env.HOME ?? "/root",
  pinned: Readonly<Record<string, readonly string[]>> = PINNED_SHELL_DIGESTS,
): string {
  const version = managedChromeVersion("linux");
  const cache = join(home, ".cache", "puppeteer");
  const folder = join(
    cache,
    "chrome-headless-shell",
    `linux-${version}`,
    "chrome-headless-shell-linux64",
  );
  const executable = join(folder, "chrome-headless-shell");
  if (!existsSync(executable)) {
    throw new Error(
      `[build-zip] chrome-headless-shell ${version} is not in ${cache}. Run\n` +
        `  npx --yes @puppeteer/browsers install chrome-headless-shell@${version} --path ${cache}\n` +
        `before --source=chrome-headless-shell.`,
    );
  }
  const digest = headlessShellDigest(folder);
  if (digest === undefined || !(pinned[version] ?? []).includes(digest)) {
    throw new Error(
      `[build-zip] ${folder} does not match the pinned chrome-headless-shell ${version} digest. ` +
        `Delete it and install it again.`,
    );
  }
  // cpSync keeps each file's mode, so the executable stays executable.
  cpSync(folder, join(stagingDir, BUNDLED_SHELL_DIR), {
    recursive: true,
    filter: (path) => !CHROME_WRITES_WHILE_RUNNING.includes(relative(folder, path)),
  });
  return version;
}
