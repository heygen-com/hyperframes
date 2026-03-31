import { readConfig, writeConfig } from "../telemetry/config.js";
import { VERSION } from "../version.js";
import { isDevMode } from "./env.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/hyperframes/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;

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

  if (!force && config.lastUpdateCheck && config.latestVersion) {
    const lastCheck = new Date(config.lastUpdateCheck).getTime();
    if (now - lastCheck < CHECK_INTERVAL_MS) {
      return {
        current: VERSION,
        latest: config.latestVersion,
        updateAvailable: config.latestVersion !== VERSION,
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

    const data = (await res.json()) as { version?: string };
    const latest = data.version ?? VERSION;

    config.lastUpdateCheck = new Date().toISOString();
    config.latestVersion = latest;
    writeConfig(config);

    return { current: VERSION, latest, updateAvailable: latest !== VERSION };
  } catch {
    return fallbackResult(config.latestVersion);
  }
}

function fallbackResult(cachedLatest?: string): UpdateCheckResult {
  return {
    current: VERSION,
    latest: cachedLatest ?? VERSION,
    updateAvailable: cachedLatest ? cachedLatest !== VERSION : false,
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
    updateAvailable: config.latestVersion ? config.latestVersion !== VERSION : false,
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
 * Print update notice to stderr if a newer version is available.
 * Skipped in CI, non-TTY, dev mode, or when HYPERFRAMES_NO_UPDATE_CHECK is set.
 */
export function printUpdateNotice(): void {
  if (isDevMode()) return;
  if (process.env["CI"] === "true" || process.env["CI"] === "1") return;
  if (!process.stderr.isTTY) return;
  if (process.env["HYPERFRAMES_NO_UPDATE_CHECK"] === "1") return;

  const meta = getUpdateMeta();
  if (!meta.updateAvailable || !meta.latestVersion) return;

  process.stderr.write(
    `\n  Update available: ${meta.version} \u2192 ${meta.latestVersion}\n` +
      `  Run: npx hyperframes@latest\n\n`,
  );
}
