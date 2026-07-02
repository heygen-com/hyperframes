// fallow-ignore-file code-duplication
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { detectWSL } from "../telemetry/platform.js";

/**
 * Linux/WSL Chrome & ffmpeg dependency detection and remediation.
 *
 * WSL first-render success is only ~34.7% (vs ~53% local_agent) — the dominant
 * cause is a downloaded `chrome-headless-shell` that launches into
 * `libnss3.so: cannot open shared object file` (and friends) because the
 * headless Chromium shared-library set is not installed. A binary existing on
 * disk is NOT sufficient; `doctor`/preflight must verify it can actually load
 * its shared libraries and, when it can't, print the exact per-distro install
 * command.
 *
 * Design decision: detect + print precise remediation, do NOT auto-install.
 * Auto-install needs sudo + network and is surprising in an agent/CI context;
 * remediation is a copy-paste line the user (or their provisioning script) runs.
 */

export type LinuxDistroFamily = "debian" | "fedora" | "arch" | "alpine" | "unknown";

export interface LinuxDistroInfo {
  /** Package-manager family used to pick the install command. */
  family: LinuxDistroFamily;
  /** `ID` from /etc/os-release (e.g. "ubuntu", "debian", "fedora"), if any. */
  id?: string;
  /** Human-readable name from /etc/os-release `PRETTY_NAME`, if any. */
  prettyName?: string;
  /** True when running under Windows Subsystem for Linux. */
  isWsl: boolean;
}

/**
 * Full per-distro package list that provides the headless Chrome dependency
 * set. Kept as the complete set (not just the missing ones) so the remediation
 * line is a single deterministic, copy-pasteable command that fixes the whole
 * class of failure in one shot rather than one library at a time.
 *
 * The headless Chrome shared-library set (libnss3, libnspr4, libatk,
 * at-spi2, cups, libdrm, libxkbcommon, gbm, pango, cairo, alsa, ...) surfaces
 * at launch as `error while loading shared libraries: <lib>: cannot open shared
 * object file`, which Puppeteer wraps as `Failed to launch the browser process`.
 * `ldd` reports the exact missing `.so`; the package list below is what provides
 * them.
 */
const DISTRO_PACKAGES: Record<Exclude<LinuxDistroFamily, "unknown">, string[]> = {
  debian: [
    "libnss3",
    "libnspr4",
    "libatk1.0-0",
    "libatk-bridge2.0-0",
    "libcups2",
    "libdrm2",
    "libxkbcommon0",
    "libatspi2.0-0",
    "libxcomposite1",
    "libxdamage1",
    "libxfixes3",
    "libxrandr2",
    "libgbm1",
    "libpango-1.0-0",
    "libcairo2",
    "libasound2",
  ],
  fedora: [
    "nss",
    "nspr",
    "atk",
    "at-spi2-atk",
    "cups-libs",
    "libdrm",
    "libxkbcommon",
    "at-spi2-core",
    "libXcomposite",
    "libXdamage",
    "libXfixes",
    "libXrandr",
    "mesa-libgbm",
    "pango",
    "cairo",
    "alsa-lib",
  ],
  arch: [
    "nss",
    "nspr",
    "atk",
    "at-spi2-atk",
    "libcups",
    "libdrm",
    "libxkbcommon",
    "at-spi2-core",
    "libxcomposite",
    "libxdamage",
    "libxfixes",
    "libxrandr",
    "mesa",
    "pango",
    "cairo",
    "alsa-lib",
  ],
  alpine: [
    "nss",
    "nspr",
    "atk",
    "at-spi2-atk",
    "cups-libs",
    "libdrm",
    "libxkbcommon",
    "at-spi2-core",
    "libxcomposite",
    "libxdamage",
    "libxfixes",
    "libxrandr",
    "mesa-gbm",
    "pango",
    "cairo",
    "alsa-lib",
  ],
};

const INSTALL_PREFIX: Record<Exclude<LinuxDistroFamily, "unknown">, string> = {
  debian: "sudo apt-get update && sudo apt-get install -y",
  fedora: "sudo dnf install -y",
  arch: "sudo pacman -S --needed",
  alpine: "sudo apk add",
};

/**
 * Map an /etc/os-release `ID` / `ID_LIKE` to a package-manager family.
 * Exported for direct unit testing without touching the filesystem.
 */
export function distroFamilyFromOsRelease(id?: string, idLike?: string): LinuxDistroFamily {
  const haystack = `${id ?? ""} ${idLike ?? ""}`.toLowerCase();
  if (/\b(debian|ubuntu|linuxmint|pop|elementary|raspbian|kali)\b/.test(haystack)) return "debian";
  if (/\b(fedora|rhel|centos|rocky|almalinux|amzn|ol)\b/.test(haystack)) return "fedora";
  if (/\b(arch|manjaro|endeavouros|garuda)\b/.test(haystack)) return "arch";
  if (/\b(alpine)\b/.test(haystack)) return "alpine";
  return "unknown";
}

/** Parse the shell-style key=value contents of /etc/os-release. */
export function parseOsRelease(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding single/double quotes.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Detect the running Linux distribution family and WSL status. Reads
 * /etc/os-release; falls back to "unknown" when it can't be read or matched.
 */
export function detectLinuxDistro(): LinuxDistroInfo {
  const isWsl = detectWSL();
  try {
    const contents = readFileSync("/etc/os-release", "utf-8");
    const parsed = parseOsRelease(contents);
    const family = distroFamilyFromOsRelease(parsed["ID"], parsed["ID_LIKE"]);
    return {
      family,
      ...(parsed["ID"] ? { id: parsed["ID"] } : {}),
      ...(parsed["PRETTY_NAME"] ? { prettyName: parsed["PRETTY_NAME"] } : {}),
      isWsl,
    };
  } catch {
    return { family: "unknown", isWsl };
  }
}

/**
 * Build the exact command to install the full Chrome shared-library set for a
 * distro family, or a generic pointer for unknown families.
 */
export function chromeDepsInstallCommand(family: LinuxDistroFamily): string {
  if (family === "unknown") {
    return "Install the Chrome headless dependencies for your distro (nss, atk, at-spi2, cups, libdrm, libxkbcommon, gbm, pango, cairo, alsa), then re-run.";
  }
  return `${INSTALL_PREFIX[family]} ${DISTRO_PACKAGES[family].join(" ")}`;
}

/**
 * Per-distro ffmpeg install command (ffprobe ships in the same `ffmpeg` package
 * on every family we support).
 */
export function ffmpegInstallCommand(family: LinuxDistroFamily): string {
  if (family === "unknown") {
    return "Install ffmpeg (which includes ffprobe) via your distro package manager, then re-run.";
  }
  return `${INSTALL_PREFIX[family]} ffmpeg`;
}

/**
 * Human-readable environment label for a detected distro — "WSL" when running
 * under WSL, else the /etc/os-release PRETTY_NAME, else "Linux". Shared so the
 * preflight check and the render-failure remediation name the environment
 * identically for the same machine.
 */
export function distroLabel(distro: LinuxDistroInfo): string {
  if (distro.isWsl) return "WSL";
  return distro.prettyName ?? "Linux";
}

export interface SharedLibProbeResult {
  /** True when the probe ran and every required library resolved. */
  ok: boolean;
  /** Shared libs reported by `ldd` as "not found". Empty when ok. */
  missing: string[];
  /**
   * True when the probe itself could not run (no `ldd`, non-Linux, exec
   * failure). Distinct from `ok:false` — we can't conclude libs are missing, so
   * callers should not fabricate a false "Chrome broken" error.
   */
  probeUnavailable: boolean;
}

/**
 * True when a child-process error indicates the process was killed (e.g. by the
 * `timeout` option → SIGTERM), whose stdout is only a partial capture.
 */
function isKilledExecError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
  return e.killed === true || e.signal != null;
}

/** Extract captured stdout from a child-process error, if present, as a string. */
function execErrorStdout(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("stdout" in err)) return undefined;
  const stdout = (err as { stdout?: string | Buffer | null }).stdout;
  if (stdout == null) return undefined;
  return stdout.toString();
}

/**
 * Run `ldd <chromeBinary>` and report any shared libraries the dynamic linker
 * cannot resolve (lines containing "=> not found"). This is the check that
 * catches the `libnss3.so: cannot open shared object file` launch failure
 * BEFORE a render is attempted — a binary can exist on disk yet be unlaunchable.
 *
 * Only meaningful on Linux. Returns `probeUnavailable:true` on any platform
 * where `ldd` isn't applicable or the probe can't run, so callers treat it as
 * "inconclusive" rather than "missing".
 */
export function probeChromeSharedLibs(chromeBinaryPath: string): SharedLibProbeResult {
  if (process.platform !== "linux") {
    return { ok: true, missing: [], probeUnavailable: true };
  }
  if (!existsSync(chromeBinaryPath)) {
    return { ok: true, missing: [], probeUnavailable: true };
  }
  let output: string;
  try {
    // ldd exits non-zero when libs are missing but still prints the resolution
    // table to stdout, so capture stdout even on failure.
    output = execFileSync("ldd", [chromeBinaryPath], {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (err) {
    // A timed-out/killed ldd leaves only a partial resolution table, which we
    // must NOT parse as authoritative (would report spurious missing libs).
    // Anything other than a clean non-zero exit with full stdout is
    // inconclusive.
    if (isKilledExecError(err)) {
      return { ok: true, missing: [], probeUnavailable: true };
    }
    const stdout = execErrorStdout(err);
    if (stdout == null) {
      // `ldd` not installed / not executable — we cannot conclude anything.
      return { ok: true, missing: [], probeUnavailable: true };
    }
    output = stdout;
  }
  return parseLddMissingLibs(output);
}

/**
 * Parse `ldd` output into the set of unresolved libraries. Exported so the
 * parsing (the actual logic) is unit-tested without spawning a real process.
 *
 * A line like `libnss3.so => not found` means the loader can't find it.
 */
export function parseLddMissingLibs(lddOutput: string): SharedLibProbeResult {
  const missing: string[] = [];
  for (const rawLine of lddOutput.split("\n")) {
    const line = rawLine.trim();
    // Match the exact unresolved marker `=> not found` — NOT a bare "not found"
    // substring, which would false-positive on a resolved lib whose path
    // happens to contain that text (e.g. `libfoo.so => /opt/not found/...`).
    if (!/=>\s*not found\b/.test(line)) continue;
    const soname = line.split("=>")[0]?.trim();
    if (soname) missing.push(soname);
  }
  return { ok: missing.length === 0, missing, probeUnavailable: false };
}

/**
 * True when an error message is the "Chrome couldn't load its shared libraries"
 * launch failure — the exact class `doctor` remediates. Matches both the raw
 * dynamic-linker text and Puppeteer's wrapper.
 */
export function isSharedLibLaunchError(message: string): boolean {
  return (
    /cannot open shared object file/i.test(message) ||
    /error while loading shared libraries/i.test(message) ||
    /lib[\w.+-]*\.so[\w.]*: cannot open/i.test(message)
  );
}

/**
 * Turn a cryptic Chrome launch failure into actionable, per-distro guidance.
 * Returns the remediation block to show the user, or `undefined` when the error
 * isn't a shared-library/launch failure this module can help with.
 */
export function chromeLaunchRemediation(errorMessage: string): string | undefined {
  const isLaunchFailure =
    /Failed to launch the browser process/i.test(errorMessage) ||
    isSharedLibLaunchError(errorMessage);
  if (!isLaunchFailure) return undefined;
  if (process.platform !== "linux") return undefined;
  // On Linux ARM64 the render browser is system Chromium (see
  // ensureLinuxArmBrowser in manager.ts), so a launch failure there is almost
  // always a missing/mis-pathed chromium — NOT the headless-shell .so set. The
  // shared-lib install line would be wrong advice, so defer to that path's own
  // guidance instead of emitting it here.
  if (process.arch === "arm64") return undefined;

  const distro = detectLinuxDistro();
  const lines: string[] = [];
  lines.push(
    `Chrome could not launch on ${distroLabel(distro)} — this is almost always missing system libraries (e.g. libnss3).`,
  );
  lines.push("Install the Chrome headless dependencies:");
  lines.push(`  ${chromeDepsInstallCommand(distro.family)}`);
  lines.push("Then verify with: npx hyperframes doctor");
  return lines.join("\n");
}
