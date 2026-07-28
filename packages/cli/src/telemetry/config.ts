import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { normalizeErrorMessage } from "../utils/errorMessage.js";

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
  /**
   * Ring of the last few local renders (newest last). `hyperframes feedback`
   * attaches these ids — which are the `render_job_id` /
   * `observability_render_job_id` on this install's PostHog events — to the
   * feedback it submits, so a wild bug report can be joined to the exact
   * telemetry rows of the renders it describes.
   */
  recentRenders?: RecentRenderRecord[];
}

/** One entry in {@link HyperframesConfig.recentRenders}. */
export interface RecentRenderRecord {
  /** The render job id (`RenderJob.id` — the telemetry `render_job_id`). */
  id: string;
  /** ISO timestamp of when the render finished. */
  at: string;
  /** Whether the render completed successfully. */
  ok: boolean;
}

/** Ring size for {@link HyperframesConfig.recentRenders}. */
const MAX_RECENT_RENDERS = 5;

/**
 * Append a finished render to the recent-renders ring (newest last, capped).
 * Fresh read-modify-write like the trial counters — narrows, but does not
 * eliminate, lost updates against a concurrent CLI process.
 */
export function recordRecentRender(id: string, ok: boolean): void {
  const config = readConfigFresh();
  const ring = [...(config.recentRenders ?? []), { id, at: new Date().toISOString(), ok }];
  config.recentRenders = ring.slice(-MAX_RECENT_RENDERS);
  writeConfig(config);
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
      recentRenders: Array.isArray(parsed.recentRenders)
        ? parsed.recentRenders
            .filter(
              (r): r is RecentRenderRecord =>
                typeof r === "object" &&
                r !== null &&
                typeof (r as RecentRenderRecord).id === "string" &&
                typeof (r as RecentRenderRecord).at === "string" &&
                typeof (r as RecentRenderRecord).ok === "boolean",
            )
            .slice(-MAX_RECENT_RENDERS)
        : undefined,
    };

    cachedConfig = config;
    return { ...config };
  } catch {
    // A missing file is handled above. Any failure here means an existing
    // preference could not be read safely (corrupt JSON, permissions, I/O).
    // Preserve the historical recovery behavior for the rest of the config,
    // but fail closed for the privacy control: recovery must never silently
    // turn telemetry back on.
    const config = {
      ...DEFAULT_CONFIG,
      telemetryEnabled: false,
      anonymousId: randomUUID(),
    };
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
  return writeConfigWithResult(config).ok;
}

export type ConfigWriteResult = { ok: true } | { ok: false; error: string };

/**
 * Persist config and retain the failure reason for user-facing commands that
 * must distinguish a durable preference write from a best-effort update.
 */
export function writeConfigWithResult(config: HyperframesConfig): ConfigWriteResult {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const tmpFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmpFile, CONFIG_FILE);
    cachedConfig = { ...config };
    return { ok: true };
  } catch (error) {
    // Non-fatal — telemetry should never break the CLI
    return { ok: false, error: normalizeErrorMessage(error) };
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
