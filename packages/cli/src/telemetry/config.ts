import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Config directory: ~/.hyperframes/
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".hyperframes");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Install-state file: ~/.local/state/hyperframes/install-state.json
//
// A second, deliberately separate location from CONFIG_DIR, so it survives
// the most common identity reset — deleting or reinstalling ~/.hyperframes.
// It exists to carry exactly two facts across that reset, and nothing else:
//
//   1. `markerAt` — "a hyperframes install existed on this machine". Written
//      unconditionally, so the fraction of fresh installs that find it is a
//      direct measurement of recoverable id churn (config wiped, machine
//      persisted) vs unrecoverable (fresh machine/container/new user).
//   2. `deParallelRouterTrialFired` — the DE parallel-router circuit
//      breaker's tripped state. Without this, a config wipe re-enrols the
//      install into an experimental path that already FAILED on this exact
//      machine; the breaker's whole point is that a real failure turns the
//      trial off for good.
//
// It intentionally holds NO identity: no anonymousId, no counters, nothing
// that could link the old install to the new one. A user who wipes their
// config gets a fresh id unconditionally — this file only stops the wipe
// from also discarding a safety fact about the machine.
// ---------------------------------------------------------------------------

const STATE_DIR = join(homedir(), ".local", "state", "hyperframes");
const STATE_FILE = join(STATE_DIR, "install-state.json");

interface InstallState {
  /** ISO timestamp of when the marker was first written. */
  markerAt: string;
  /** Rolled-over circuit-breaker state — see HyperframesConfig's field. */
  deParallelRouterTrialFired?: boolean;
}

/** Read the install-state file; any parse/shape failure reads as absent. */
function readInstallState(): InstallState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Partial<InstallState>;
    if (typeof parsed.markerAt !== "string") return null;
    return {
      markerAt: parsed.markerAt,
      deParallelRouterTrialFired: parsed.deParallelRouterTrialFired === true ? true : undefined,
    };
  } catch {
    return null;
  }
}

// Sync bookkeeping, so the existsSync+read doesn't run on every writeConfig:
// `stateMarkerSynced` = the marker is known present; `stateFiredSynced` = the
// state file is known to already carry fired=true.
let stateMarkerSynced = false;
let stateFiredSynced = false;

/** Test-only: reset the sync memo (module state leaks across vitest cases). */
export function __resetInstallStateSyncForTests(): void {
  stateMarkerSynced = false;
  stateFiredSynced = false;
}

/**
 * Atomic for the same reason writeConfig is: a torn read must never exist,
 * since a corrupted state file silently reads as absent.
 */
function writeInstallState(next: InstallState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmpFile = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmpFile, STATE_FILE);
}

/**
 * Bring the install-state file up to date with this config write: ensure the
 * marker exists, and mirror a tripped breaker. Called from `writeConfig` so
 * no breaker write site can forget it. Never throws — same contract as the
 * rest of this file, telemetry must not break the CLI.
 */
/** What the state file should say after this config write; null = already correct. */
function nextInstallState(state: InstallState | null, wantFired: boolean): InstallState | null {
  const hadFired = state?.deParallelRouterTrialFired === true;
  if (state !== null && (hadFired || !wantFired)) return null;
  return {
    markerAt: state?.markerAt ?? new Date().toISOString(),
    deParallelRouterTrialFired: wantFired || hadFired || undefined,
  };
}

function syncInstallState(config: HyperframesConfig): void {
  const wantFired = config.deParallelRouterTrialFired === true;
  if (stateMarkerSynced && (stateFiredSynced || !wantFired)) return;
  try {
    const state = readInstallState();
    const next = nextInstallState(state, wantFired);
    if (next !== null) writeInstallState(next);
    stateMarkerSynced = true;
    stateFiredSynced = wantFired || state?.deParallelRouterTrialFired === true;
  } catch {
    // Leave the memo unset so a later write retries.
  }
}

/**
 * Build a brand-new config for an install with no (readable) config file,
 * consulting the install-state file for what a previous install on this
 * machine left behind.
 */
function mintConfig(): HyperframesConfig {
  const state = readInstallState();
  return {
    ...DEFAULT_CONFIG,
    anonymousId: randomUUID(),
    predecessorFound: state !== null,
    // The rollover itself: a breaker tripped by a previous install on this
    // machine stays tripped for the new one.
    deParallelRouterTrialFired: state?.deParallelRouterTrialFired === true ? true : undefined,
  };
}

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
   * Whether a previous install's state marker existed on this machine when
   * this config was minted. Attached to telemetry so the fraction of fresh
   * installs that are RECOVERABLE churn (config wiped, machine persisted) is
   * measurable directly. `undefined` on configs minted before this field
   * existed — a different fact from `false` (minted fresh, no predecessor).
   */
  predecessorFound?: boolean;
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
    const config = mintConfig();
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
      predecessorFound:
        typeof parsed.predecessorFound === "boolean" ? parsed.predecessorFound : undefined,
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
    // Corrupted config — reset. Goes through the same mint path as a missing
    // file, so a tripped breaker survives config corruption too.
    const config = mintConfig();
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
    // Mirror into the install-state file (marker + tripped breaker) so no
    // breaker write site has to remember to do it.
    syncInstallState(config);
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

/** Expose the install-state path for the telemetry command output. */
export const STATE_PATH = STATE_FILE;
