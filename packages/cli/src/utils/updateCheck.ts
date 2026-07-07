import { compareVersions } from "compare-versions";
import { readConfig, writeConfig } from "../telemetry/config.js";
import { VERSION } from "../version.js";
import { isDevMode } from "./env.js";
import { detectInstaller } from "./installerDetection.js";

/**
 * True when `v` is a strict semver-shaped string. Registry-supplied versions
 * flow into commands that are displayed AND executed (the `upgrade` command and
 * the background auto-installer both run them), so a poisoned `latest` carrying
 * shell metacharacters must never reach them. This is enforced at the registry
 * boundary in `checkForUpdate` — an unsafe `data.version` is never cached — so
 * every consumer (notice, upgrade, background auto-install, and any future one)
 * is covered by this single gate; the per-consumer checks are defense in depth.
 */
export function isSafeVersion(v: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}

const NPM_REGISTRY_URL = "https://registry.npmjs.org/hyperframes/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;

/** Returns true if `a` is newer than `b` per semver (handles alpha, beta, rc). */
function isNewerSemver(a: string, b: string): boolean {
  try {
    return compareVersions(a, b) > 0;
  } catch {
    return a !== b;
  }
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export interface UpdateMeta {
  version: string;
  latestVersion?: string;
  updateAvailable: boolean;
}

/**
 * Check npm registry for the latest version. Uses a 24h cache to avoid
 * hitting the registry on every invocation.
 *
 * @param force - Skip cache and fetch fresh data
 */
export async function checkForUpdate(force?: boolean): Promise<UpdateCheckResult> {
  const config = readConfig();
  const now = Date.now();

  // Also guard the cache read: a cache written before this boundary guard
  // existed could hold an unsafe latestVersion — re-validate before trusting it.
  if (
    !force &&
    config.lastUpdateCheck &&
    config.latestVersion &&
    isSafeVersion(config.latestVersion)
  ) {
    const lastCheck = new Date(config.lastUpdateCheck).getTime();
    if (now - lastCheck < CHECK_INTERVAL_MS) {
      return {
        current: VERSION,
        latest: config.latestVersion,
        updateAvailable: isNewerSemver(config.latestVersion, VERSION),
      };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Connection: "close" },
    });
    clearTimeout(timeout);

    if (!res.ok) return fallbackResult(config.latestVersion);

    const data = (await res.json()) as { version?: unknown };
    // Registry boundary guard: only a strict-semver STRING is trusted. This
    // value is cached and later flows into an install command that the
    // background auto-updater executes, so a poisoned or non-string
    // data.version (e.g. "1.2.3; rm -rf /") must never be persisted. Reject it
    // and fall back to the last known-good version. Closes the injection class
    // for every consumer at one point.
    if (typeof data.version !== "string" || !isSafeVersion(data.version)) {
      return fallbackResult(config.latestVersion);
    }
    const latest = data.version;

    config.lastUpdateCheck = new Date().toISOString();
    config.latestVersion = latest;
    writeConfig(config);

    return { current: VERSION, latest, updateAvailable: isNewerSemver(latest, VERSION) };
  } catch {
    return fallbackResult(config.latestVersion);
  }
}

function fallbackResult(cachedLatest?: string): UpdateCheckResult {
  // Only surface a cached version we can prove is safe — a pre-existing
  // poisoned cache must not leak through the fallback path either.
  const safeCached = cachedLatest && isSafeVersion(cachedLatest) ? cachedLatest : undefined;
  return {
    current: VERSION,
    latest: safeCached ?? VERSION,
    updateAvailable: safeCached ? isNewerSemver(safeCached, VERSION) : false,
  };
}

/**
 * Synchronous read from cache — for _meta envelope on --json commands.
 * Never fetches. Returns what the last background check found.
 */
export function getUpdateMeta(): UpdateMeta {
  const config = readConfig();
  return {
    version: VERSION,
    latestVersion: config.latestVersion,
    updateAvailable: config.latestVersion ? isNewerSemver(config.latestVersion, VERSION) : false,
  };
}

/**
 * Wrap a JSON payload with the _meta version envelope.
 * Use this in all --json command outputs for consistent agent-friendly metadata.
 */
export function withMeta<T extends object>(data: T): T & { _meta: UpdateMeta } {
  return { ...data, _meta: getUpdateMeta() };
}

/**
 * True when update / freshness notices should stay silent — CI, non-TTY, dev
 * mode, or the HYPERFRAMES_NO_UPDATE_CHECK opt-out. Shared with the skills
 * freshness notice so both honour the same gating.
 */
export function updateNoticesSuppressed(): boolean {
  if (isDevMode()) return true;
  if (process.env["CI"] === "true" || process.env["CI"] === "1") return true;
  if (!process.stderr.isTTY) return true;
  if (process.env["HYPERFRAMES_NO_UPDATE_CHECK"] === "1") return true;
  return false;
}

/**
 * Print update notice to stderr if a newer version is available.
 * Skipped in CI, non-TTY, dev mode, or when HYPERFRAMES_NO_UPDATE_CHECK is set.
 */
export function printUpdateNotice(): void {
  if (updateNoticesSuppressed()) return;

  const meta = getUpdateMeta();
  if (!meta.updateAvailable || !meta.latestVersion) return;

  // Show the command that updates *this* install: the detected package
  // manager's upgrade for owned global installs (npm/bun/pnpm/brew), and the
  // universal `npx hyperframes@latest` for ephemeral/unknown installs (where a
  // manager command wouldn't apply). detectInstaller() only runs here, after
  // the suppression + update-available gates, so it adds no cost to normal runs.
  const safeLatest = isSafeVersion(meta.latestVersion);
  const managerCommand = safeLatest ? detectInstaller().installCommand(meta.latestVersion) : null;
  const command = managerCommand ?? "npx hyperframes@latest";

  process.stderr.write(
    `\n  Update available: ${meta.version} \u2192 ${meta.latestVersion}\n` +
      `  Run: ${command}\n\n`,
  );
}
