import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  /** Total successful renders (for feedback prompt gating) */
  renderSuccessCount: number;
  /** The renderSuccessCount at which feedback was last shown */
  lastFeedbackPromptAt: number;
  /** ISO timestamp of the last npm registry version check */
  lastUpdateCheck?: string;
  /** Latest version found on npm */
  latestVersion?: string;
  /** Throttle for the non-TTY stale-project-pin notice (ms epoch). */
  lastStalePinNoticeAt?: number;
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
  /** ISO timestamp of the last `skills check` freshness check (24h cache). */
  lastSkillsCheck?: string;
  /** Whether installed skills were stale at the last check. */
  skillsUpdateAvailable?: boolean;
  /** How many installed skills were outdated at the last check. */
  skillsOutdatedCount?: number;
  /** How many skills were missing (not installed) at the last check. */
  skillsMissingCount?: number;
  /** How many installed skills were flagged removed-upstream at the last check. */
  skillsRemovedCount?: number;
  /**
   * True once the DE parallel-router experiment ("HF_DE_PARALLEL_ROUTER")
   * has actually FAILED (its self-verify/generic-failure safety net fired —
   * "reverted", not merely "routed") on a render from this install. The CLI
   * enables the experiment for free on EVERY eligible render from a fresh
   * install — not just once — to maximize real-traffic router telemetry
   * (mostly successful "routed" outcomes) without requiring anyone to
   * manually opt in via env var; only a real failure turns it off, and only
   * for this install going forward. See `renderLocal`'s
   * `maybeEnableDeParallelRouterTrial`/`maybeConsumeDeParallelRouterTrial`.
   */
  deParallelRouterTrialFired?: boolean;
  /**
   * Count of engaged (routed or reverted) trial renders so far — the
   * backstop that caps exposure even absent an actual failure. See
   * `DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS` in `render.ts`.
   */
  deParallelRouterTrialRenderCount?: number;
}

const DEFAULT_CONFIG: HyperframesConfig = {
  telemetryEnabled: true,
  anonymousId: "",
  telemetryNoticeShown: false,
  commandCount: 0,
  renderSuccessCount: 0,
  lastFeedbackPromptAt: 0,
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
      renderSuccessCount: parsed.renderSuccessCount ?? DEFAULT_CONFIG.renderSuccessCount,
      lastFeedbackPromptAt: parsed.lastFeedbackPromptAt ?? DEFAULT_CONFIG.lastFeedbackPromptAt,
      lastUpdateCheck: parsed.lastUpdateCheck,
      latestVersion: parsed.latestVersion,
      lastStalePinNoticeAt: parsed.lastStalePinNoticeAt,
      pendingUpdate: parsed.pendingUpdate,
      completedUpdate: parsed.completedUpdate,
      lastSkillsCheck: parsed.lastSkillsCheck,
      skillsUpdateAvailable: parsed.skillsUpdateAvailable,
      skillsOutdatedCount: parsed.skillsOutdatedCount,
      skillsMissingCount: parsed.skillsMissingCount,
      skillsRemovedCount: parsed.skillsRemovedCount,
      // Explicit `=== true`/typeof-number checks rather than a truthy/nullish
      // read — a hand-edited or corrupted config could plausibly carry a
      // non-boolean/non-number JSON value (e.g. the STRING "false", which is
      // truthy in JS) for these two fields specifically, since they're read
      // with a bare truthy check at the call site (review finding).
      deParallelRouterTrialFired: parsed.deParallelRouterTrialFired === true ? true : undefined,
      deParallelRouterTrialRenderCount:
        typeof parsed.deParallelRouterTrialRenderCount === "number"
          ? parsed.deParallelRouterTrialRenderCount
          : undefined,
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
 * Re-read the config from disk, bypassing the in-process cache. Use
 * immediately before a targeted single-field read-modify-write (e.g. the DE
 * parallel-router trial's render count/fired flag) to narrow — though not
 * eliminate, there is no cross-process file locking here — the window for a
 * lost update against a concurrently-running CLI process that wrote other
 * fields in the meantime.
 */
export function readConfigFresh(): HyperframesConfig {
  cachedConfig = null;
  return readConfig();
}

/**
 * Persist config to disk. Updates the in-memory cache on success.
 *
 * Atomic: writes to a pid-suffixed temp file and renames it over the config —
 * `rename(2)` within one directory is atomic on POSIX, so a concurrent
 * reader can never observe a partially-written file. That matters beyond
 * hygiene: `readConfig`'s corrupted-file catch RESETS the config to defaults
 * (new anonymousId, telemetry re-enabled, all optional fields wiped), so a
 * torn read of a non-atomic write would silently destroy the user's config
 * (review finding).
 *
 * Returns whether the write actually landed — errors are still swallowed
 * (telemetry must never break the CLI), but callers that need persistence
 * certainty (e.g. the DE parallel-router trial's off-switch) can react
 * instead of re-implementing read-back verification.
 */
export function writeConfig(config: HyperframesConfig): boolean {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const tmpFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmpFile, CONFIG_FILE);
    cachedConfig = { ...config };
    return true;
  } catch {
    // Non-fatal — telemetry should never break the CLI
    return false;
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
