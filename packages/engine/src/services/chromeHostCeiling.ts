import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { debuglog } from "node:util";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { buildChromeLaunchEnv } from "@hyperframes/core/chrome-env";
import {
  chromeSandboxArgs,
  chromeSandboxEnabled,
  startsWithChromeSandboxFallback,
} from "@hyperframes/core/chrome-sandbox";

/** Chrome 151 dropped macOS 12 and older (Darwin < 22); 150 is the last major that launches there. */
const MACOS_12_LAST_CHROME_MAJOR = 150;

/** Newest Chrome major this host can run, or undefined when it has no ceiling. */
export function chromeMajorCeiling(
  hostPlatform: string = process.platform,
  hostRelease: string = release(),
): number | undefined {
  if (hostPlatform !== "darwin") return undefined;
  return Number.parseInt(hostRelease, 10) < 22 ? MACOS_12_LAST_CHROME_MAJOR : undefined;
}

/** True when a cache dir name (`mac-152.0.1.2`) or build id (`152.0.1.2`) is newer than the ceiling. */
export function exceedsChromeCeiling(versionName: string, ceiling: number | undefined): boolean {
  if (ceiling === undefined) return false;
  const major = Number.parseInt(versionName.slice(versionName.indexOf("-") + 1), 10);
  return major > ceiling;
}

// Chrome Stable, so the managed shell keeps receiving stable security fixes. macOS 12 gets 150, the last headless
// shell that launches there; it exposes canvas.drawElementImage under CanvasDrawElement.
const CHROME_VERSION = "158.0.8127.36";
const MACOS_12_CHROME_VERSION = "150.0.7871.124";

export function managedChromeVersion(
  hostPlatform: string = process.platform,
  hostRelease: string = release(),
): string {
  return chromeMajorCeiling(hostPlatform, hostRelease) === undefined
    ? CHROME_VERSION
    : MACOS_12_CHROME_VERSION;
}

/** Each pinned build's headless shell folder (Chrome for Testing), by `headlessShellDigest`, one per platform.
 * Regenerate with `bun run --cwd packages/cli pin:chrome <builds>` whenever a version above moves. */
export const PINNED_SHELL_DIGESTS: Readonly<Record<string, readonly string[]>> = {
  "158.0.8127.36": [
    "564ba9876826b3a3ce71f862a37c85ee7938191975afad9f427918db6b073e13",
    "32499804ce68213b7a3d5f622c8c94004522b02ed35bab7913495e6c8986c904",
    "2ba780aa9f4afc4f79f4d6c1b32eb0fb9c0217faaa88ac56b5c82facfb31742d",
    "ca7a3db192eb40cf690d8c338e5e15b62ebaaee4b02e0996521e22f6081c6db3",
    "dee5819f7bd47d82915bc0598a80288b7f09b9b3f819eef4008fdc208dc6f345",
  ],
  "150.0.7871.124": [
    "8c1c8a8f68f53b66b2ca340bcf0d6b3f50f9961b3042b759cefdecc7d2eacd4b",
    "fc5a7041fc62b0740093077cb476cae232853a0b4272c6851add5f60ce11d1c6",
  ],
};
export const CHROME_WRITES_WHILE_RUNNING: readonly string[] = ["debug.log", "chrome_debug.log"];

function filesUnder(folder: string, prefix = ""): string[] | undefined {
  const names: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isFile()) names.push(name);
    else if (!entry.isDirectory()) return undefined;
    else {
      const inner = filesUnder(join(folder, entry.name), `${name}/`);
      if (!inner) return undefined;
      names.push(...inner);
    }
  }
  return names;
}

function sha256Of(path: string): string {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk))
      hash.update(chunk.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** Every file's name and sha256, sorted; undefined with a link in the folder, as its target can change once hashed. */
export function headlessShellDigest(folder: string): string | undefined {
  if (!lstatSync(folder).isDirectory()) return undefined;
  const names = filesUnder(folder)
    ?.filter((name) => !CHROME_WRITES_WHILE_RUNNING.includes(name))
    .sort();
  if (!names) return undefined;
  const lines = names.map((name) => `${name}\0${sha256Of(join(folder, name))}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

const verdicts = new Map<string, { stamp: string; pinned: boolean }>();
// A file system stamps times by a coarse tick (up to 1 s), so a same-size write right after a verdict may leave every
// stamp unchanged: a verdict is kept only once every file is older than this, as git treats a racily clean index.
const RACY_MS = 2000;

/** Whether `executable` is in a pinned build's untouched folder; rehashed when a file's size, inode or ctime moves. */
export function isPinnedHeadlessShell(executable: string): boolean {
  const folder = dirname(executable);
  try {
    if (!lstatSync(executable).isFile()) return false;
    const stats = (filesUnder(folder) ?? [])
      .filter((name) => !CHROME_WRITES_WHILE_RUNNING.includes(name))
      .map((name) => ({ name, ...lstatSync(join(folder, name)) }));
    const stamp = stats
      .map(({ name, size, ino, ctimeMs }) => `${name}:${size}:${ino}:${ctimeMs}`)
      .join("|");
    const known = verdicts.get(folder);
    if (known?.stamp === stamp) return known.pinned;
    const digest = headlessShellDigest(folder);
    const pinned = Object.values(PINNED_SHELL_DIGESTS).some(
      (list) => digest !== undefined && list.includes(digest),
    );
    if (!pinned) debug("skipping %s: its folder is not a pinned build", executable);
    if (stats.every(({ ctimeMs }) => ctimeMs < Date.now() - RACY_MS))
      verdicts.set(folder, { stamp, pinned });
    return pinned;
  } catch {
    // expected: a folder that is gone or unreadable holds no pinned build
    return false;
  }
}

export const isManagedChromeDir = (versionName: string): boolean =>
  versionName.slice(versionName.indexOf("-") + 1) === managedChromeVersion();

/** Newest first, by numeric build (`linux-148.0.1` before `linux-99.0.1`). */
export function compareBrowserVersionsDescending(left: string, right: string): number {
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

const starts = new Map<string, boolean>();
const debug = debuglog("hyperframes:browser");

/** Whether a shell loads a blank page and exits: an old build can die at launch on a newer OS. Asked once per path. */
export function shellStarts(
  binary: string,
  timeoutMs = 10_000,
  sandbox = chromeSandboxEnabled(),
): boolean {
  let answer = starts.get(binary);
  if (answer === undefined) {
    const probe = [...chromeSandboxArgs(sandbox), "--dump-dom", "about:blank"];
    answer = startsWithChromeSandboxFallback(
      probe,
      (args) =>
        spawnSync(binary, args, {
          env: buildChromeLaunchEnv(),
          stdio: "ignore",
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          windowsHide: true,
        })?.status === 0,
    );
    if (!answer) debug("skipping %s: it did not start", binary);
    starts.set(binary, answer);
  }
  return answer;
}

/** The shared Puppeteer cache's shell: the managed build, else the newest under the host's ceiling that starts.
 * `shell` names a version dir's executable, or undefined when it holds no usable file. */
export function pickSharedShell(
  versions: readonly string[],
  shell: (version: string) => string | undefined,
): string | undefined {
  const managed = versions.find(isManagedChromeDir);
  const pinned = managed && shell(managed);
  if (pinned) return pinned;
  const ceiling = chromeMajorCeiling();
  for (const version of [...versions].sort(compareBrowserVersionsDescending)) {
    if (version === managed || exceedsChromeCeiling(version, ceiling)) continue;
    const binary = shell(version);
    if (binary && shellStarts(binary)) return binary;
  }
  return undefined;
}

// PUPPETEER_EXECUTABLE_PATH last: images set it for Puppeteer, which the engine no longer lets choose.
const BROWSER_PATH_VARS = [
  "HYPERFRAMES_BROWSER_PATH",
  "PRODUCER_HEADLESS_SHELL_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
] as const;

/** The browser binary an env var names. The CLI and the engine both resolve it here, HYPERFRAMES_BROWSER_PATH first. */
export function browserPathFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { name: (typeof BROWSER_PATH_VARS)[number]; path: string } | undefined {
  for (const name of BROWSER_PATH_VARS) {
    const path = env[name];
    if (path) return { name, path };
  }
  return undefined;
}
