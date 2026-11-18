import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_SHELL_DIR } from "../src/chromium.js";

/**
 * Stage the newest linux64 chrome-headless-shell from the Puppeteer cache under `home` into
 * `<stagingDir>/<BUNDLED_SHELL_DIR>/`. The whole folder: the executable alone exits at launch
 * ("Invalid file descriptor to ICU data received") without icudtl.dat and its .pak files.
 * Returns the cached version it staged.
 */
export function stageChromeHeadlessShell(
  stagingDir: string,
  home = process.env.HOME ?? "/root",
): string {
  // The fallback path bundles the same chrome-headless-shell build the K8s deploy uses. It is
  // fetched via `@puppeteer/browsers` into the host's `~/.cache/puppeteer/`; the build re-uses that
  // cache rather than redownloading.
  const baseDir = join(home, ".cache", "puppeteer", "chrome-headless-shell");
  if (!existsSync(baseDir)) {
    throw new Error(
      `[build-zip] chrome-headless-shell cache missing at ${baseDir}. Run\n` +
        `  npx --yes @puppeteer/browsers install chrome-headless-shell@158.0.8127.36 --path ${home}/.cache/puppeteer\n` +
        `before --source=chrome-headless-shell.`,
    );
  }
  // Sort by numeric semver descending. `sort().reverse()` is lexicographic,
  // which silently picks "99.0.0" over "131.0.0" once Chrome ships
  // three-digit majors that aren't strictly width-aligned. `compareSemver`
  // returns negative/zero/positive on (a, b), so descending = `b - a`.
  const versions = readdirSync(baseDir).sort((a, b) => compareSemver(b, a));
  for (const v of versions) {
    const folder = join(baseDir, v, "chrome-headless-shell-linux64");
    if (existsSync(join(folder, "chrome-headless-shell"))) {
      // cpSync keeps each file's mode, so the executable stays executable.
      cpSync(folder, join(stagingDir, BUNDLED_SHELL_DIR), { recursive: true });
      return v;
    }
  }
  throw new Error(`[build-zip] no linux64 chrome-headless-shell binary found under ${baseDir}.`);
}

/**
 * Compare two semver-shaped strings like "131.0.6778.108". Treats any
 * non-numeric directory name as `-Infinity` so it sorts to the bottom
 * (Puppeteer's cache layout sometimes includes `latest` or branch tags).
 * Used by `stageChromeHeadlessShell` to pick the newest cached Chrome
 * without tripping on the lexicographic "99 > 131" trap.
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map((s) => Number.parseInt(s, 10));
  const partsB = b.split(".").map((s) => Number.parseInt(s, 10));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const ai = partsA[i] ?? 0;
    const bi = partsB[i] ?? 0;
    if (Number.isNaN(ai) && Number.isNaN(bi)) continue;
    if (Number.isNaN(ai)) return -1;
    if (Number.isNaN(bi)) return 1;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}
