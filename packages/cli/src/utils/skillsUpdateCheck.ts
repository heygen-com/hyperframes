// Passive "your skills are stale" nudge. Mirrors updateCheck.ts: a background
// check populates a 24h cache; printSkillsUpdateNotice() reads the cache
// synchronously and prints one line on exit.
//
// Why a passive nudge (not just `skills check`): agents don't reliably run a
// check on their own, but they DO run render/lint/validate — so we piggyback
// the reminder on the commands they already run.

import { readConfig, writeConfig } from "../telemetry/config.js";
import { checkSkills } from "./skillsManifest.js";
import { updateNoticesSuppressed } from "./updateCheck.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SkillsUpdateMeta {
  updateAvailable: boolean;
  outdated: number;
  missing: number;
}

/** Synchronous read from cache — never fetches. */
function getSkillsUpdateMeta(): SkillsUpdateMeta {
  const config = readConfig();
  return {
    updateAvailable: config.skillsUpdateAvailable ?? false,
    outdated: config.skillsOutdatedCount ?? 0,
    missing: config.skillsMissingCount ?? 0,
  };
}

function cacheFresh(lastSkillsCheck: string | undefined, now: number): boolean {
  if (!lastSkillsCheck) return false;
  return now - new Date(lastSkillsCheck).getTime() < CHECK_INTERVAL_MS;
}

/** Run the real check and persist the result to the cache. */
async function refreshSkillsCache(): Promise<SkillsUpdateMeta> {
  const result = await checkSkills();
  // Only record a meaningful check when skills were actually found.
  if (result.location) {
    const config = readConfig();
    config.lastSkillsCheck = new Date().toISOString();
    config.skillsUpdateAvailable = result.updateAvailable;
    config.skillsOutdatedCount = result.summary.outdated;
    config.skillsMissingCount = result.summary.missing;
    writeConfig(config);
  }
  return {
    updateAvailable: result.updateAvailable,
    outdated: result.summary.outdated,
    missing: result.summary.missing,
  };
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

/** The stale-skills nudge text, or null when nothing is outdated or missing. */
function skillsNoticeText(meta: SkillsUpdateMeta): string | null {
  const total = meta.outdated + meta.missing;
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
