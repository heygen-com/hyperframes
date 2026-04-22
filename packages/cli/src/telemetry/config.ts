import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Config directory: ~/.hyperframes/
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".hyperframes");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface HyperframesConfig {
  /** Whether anonymous telemetry is enabled (default: true in production) */
  telemetryEnabled: boolean;
  /** Stable anonymous identifier — no PII, just a random UUID */
  anonymousId: string;
  /** Whether the first-run telemetry notice has been shown */
  telemetryNoticeShown: boolean;
  /** Total CLI command invocations (for engagement prompts) */
  commandCount: number;
  /** ISO timestamp of the last npm registry version check */
  lastUpdateCheck?: string;
  /** Latest version found on npm */
  latestVersion?: string;
  /**
   * Auto-update marker. Set when a background install is spawned so a
   * subsequent run can skip re-triggering it. Cleared once
   * `completedUpdate` captures the outcome.
   */
  pendingUpdate?: {
    /** Version being installed. */
    version: string;
    /** Install command being run, for debug logging. */
    command: string;
    /** ISO timestamp of when the background install was launched. */
    startedAt: string;
  };
  /**
   * Outcome of the last completed auto-update, written by the detached
   * installer. Surfaced once in the next invocation and then cleared.
   */
  completedUpdate?: {
    version: string;
    /** Whether the install succeeded. */
    ok: boolean;
    /** ISO timestamp of when the installer finished. */
    finishedAt: string;
    /** Non-empty when `ok === false` — the installer's stderr tail. */
    error?: string;
    /** True after the result has been surfaced once to the user. */
    reported?: boolean;
  };
}

const DEFAULT_CONFIG: HyperframesConfig = {
  telemetryEnabled: true,
  anonymousId: "",
  telemetryNoticeShown: false,
  commandCount: 0,
};

let cachedConfig: HyperframesConfig | null = null;

/**
 * Read the config file, creating it with defaults if it doesn't exist.
 * Returns a mutable copy — call `writeConfig()` to persist changes.
 */
export function readConfig(): HyperframesConfig {
  if (cachedConfig) return { ...cachedConfig };

  if (!existsSync(CONFIG_FILE)) {
    const config = { ...DEFAULT_CONFIG, anonymousId: randomUUID() };
    writeConfig(config);
    return config;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<HyperframesConfig>;

    const config: HyperframesConfig = {
      telemetryEnabled: parsed.telemetryEnabled ?? DEFAULT_CONFIG.telemetryEnabled,
      anonymousId: parsed.anonymousId || randomUUID(),
      telemetryNoticeShown: parsed.telemetryNoticeShown ?? DEFAULT_CONFIG.telemetryNoticeShown,
      commandCount: parsed.commandCount ?? DEFAULT_CONFIG.commandCount,
      lastUpdateCheck: parsed.lastUpdateCheck,
      latestVersion: parsed.latestVersion,
      pendingUpdate: parsed.pendingUpdate,
      completedUpdate: parsed.completedUpdate,
    };

    cachedConfig = config;
    return { ...config };
  } catch {
    // Corrupted config — reset
    const config = { ...DEFAULT_CONFIG, anonymousId: randomUUID() };
    writeConfig(config);
    return config;
  }
}

/**
 * Persist config to disk. Updates the in-memory cache.
 */
export function writeConfig(config: HyperframesConfig): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    cachedConfig = { ...config };
  } catch {
    // Non-fatal — telemetry should never break the CLI
  }
}

/**
 * Increment the command counter and persist.
 */
export function incrementCommandCount(): number {
  const config = readConfig();
  config.commandCount++;
  writeConfig(config);
  return config.commandCount;
}

/** Expose the config directory path for the telemetry command output */
export const CONFIG_PATH = CONFIG_FILE;
