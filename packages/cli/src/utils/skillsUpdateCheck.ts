// Passive "your skills are stale" nudge. Mirrors updateCheck.ts: a background
// check populates a 24h cache; printSkillsUpdateNotice() reads the cache
// synchronously and prints one line on exit.
//
// Why a passive nudge (not just `skills check`): agents don't reliably run a
// check on their own, but they DO run render/lint/validate — so we piggyback
// the reminder on the commands they already run.

import { readConfig, readConfigFresh, writeConfig } from "../telemetry/config.js";
import { checkSkills } from "./skillsManifest.js";
import { updateNoticesSuppressed } from "./updateCheck.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SkillsUpdateMeta {
  updateAvailable: boolean;
  outdated: number;
  missing: number;
  /** Installed skills flagged removed-upstream (renamed/dropped) at the last check. */
  removed: number;
}

/** Synchronous read from cache — never fetches. */
function getSkillsUpdateMeta(): SkillsUpdateMeta {
  const config = readConfig();
  return {
    updateAvailable: config.skillsUpdateAvailable ?? false,
    outdated: config.skillsOutdatedCount ?? 0,
    missing: config.skillsMissingCount ?? 0,
    removed: config.skillsRemovedCount ?? 0,
  };
}

function cacheFresh(lastSkillsCheck: string | undefined, now: number): boolean {
  if (!lastSkillsCheck) return false;
  return now - new Date(lastSkillsCheck).getTime() < CHECK_INTERVAL_MS;
}

/** Run the real check and persist the result to the cache. */
async function refreshSkillsCache(): Promise<SkillsUpdateMeta> {
  // `canonical: true` so this nudge's counts agree with `updateSkills`'s
  // source of truth — otherwise a stale in-repo skills-manifest.json (e.g.
  // inside a hyperframes checkout) can produce a false-positive count here.
  const result = await checkSkills({ canonical: true });
  // Only record a meaningful check when skills were actually found.
  if (result.location) {
    const config = readConfig();
    config.lastSkillsCheck = new Date().toISOString();
    config.skillsUpdateAvailable = result.updateAvailable;
    config.skillsOutdatedCount = result.summary.outdated;
    // Core-missing only: skills that install on demand (workflows not yet
    // triggered on this machine) are not "missing" worth nagging about.
    config.skillsMissingCount = result.summary.coreMissing;
    // Removed-upstream skills are just as reconcilable as outdated/missing
    // ones (a plain `skills update` prunes them) — omitting them here is what
    // made the nudge undercount (e.g. reporting "2 skills out of date or
    // missing" while a 3rd, renamed/dropped skill sat unmentioned).
    config.skillsRemovedCount = result.summary.removed;
    writeConfig(config);
  }
  return {
    updateAvailable: result.updateAvailable,
    outdated: result.summary.outdated,
    missing: result.summary.coreMissing,
    removed: result.summary.removed,
  };
}

/**
 * Drop the cached verdict (counts + timestamp) so the next command's
 * background check re-runs instead of nagging from a pre-reconcile snapshot.
 *
 * Called after a `skills` install/update/check has reconciled or re-measured
 * the install. Those commands are excluded from the nudge pipeline entirely
 * (see cli.ts), so nothing else refreshes the cache when they run — without
 * this, the last background verdict (taken BEFORE the install) keeps printing
 * "N skills out of date or missing" on every other command for up to 24h
 * after a successful install/update.
 *
 * Counts are cleared along with the timestamp — not left behind — so an
 * offline machine (where the next refresh fails and falls back to the cached
 * meta) goes quiet rather than resurrecting the stale pre-install counts.
 *
 * Best-effort: a config write failure must never fail the skills command
 * that just succeeded.
 */
export function invalidateSkillsCache(): void {
  try {
    // Fresh read narrows the lost-update window against a concurrently
    // running CLI process that wrote other config fields in the meantime.
    const config = readConfigFresh();
    delete config.lastSkillsCheck;
    delete config.skillsUpdateAvailable;
    delete config.skillsOutdatedCount;
    delete config.skillsMissingCount;
    delete config.skillsRemovedCount;
    writeConfig(config);
  } catch {
    // best-effort — never break the command that just reconciled skills
  }
}

/**
 * Refresh the skills freshness cache if it is older than 24h. Best-effort:
 * any failure (offline, no manifest published yet, no skills installed) leaves
 * the cache untouched and reports "no update".
 *
 * @param force - skip the cache and check now
 */
export async function checkSkillsForUpdate(force?: boolean): Promise<SkillsUpdateMeta> {
  if (!force && cacheFresh(readConfig().lastSkillsCheck, Date.now())) return getSkillsUpdateMeta();
  try {
    return await refreshSkillsCache();
  } catch {
    return getSkillsUpdateMeta();
  }
}

/** The stale-skills nudge text, or null when nothing is outdated, missing, or removed. */
function skillsNoticeText(meta: SkillsUpdateMeta): string | null {
  const total = meta.outdated + meta.missing + meta.removed;
  if (total < 1) return null;
  const noun = total === 1 ? "skill" : "skills";
  return `\n  ${total} HyperFrames ${noun} out of date or missing.\n  Run: npx hyperframes skills update\n\n`;
}

/**
 * Print a one-line nudge to stderr if installed skills are stale. Same gating
 * as the CLI self-update notice (CI, non-TTY, dev, HYPERFRAMES_NO_UPDATE_CHECK).
 */
export function printSkillsUpdateNotice(): void {
  if (updateNoticesSuppressed()) return;
  const text = skillsNoticeText(getSkillsUpdateMeta());
  if (text) process.stderr.write(text);
}
