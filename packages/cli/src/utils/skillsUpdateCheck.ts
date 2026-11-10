// Passive "your skills are stale" nudge. Mirrors updateCheck.ts: a background
// check populates a 2h cache; printSkillsUpdateNotice() reads the cache
// synchronously and prints one line on exit, at most once a day per project.
//
// Why a passive nudge (not just `skills check`): agents don't reliably run a
// check on their own, but they DO run render/lint/validate — so we piggyback
// the reminder on the commands they already run.

import { resolve } from "node:path";
import { readConfig, readConfigFresh, writeConfig } from "../telemetry/config.js";
import { isUnattended } from "./attendedTerminal.js";
import { claimDailyNotice } from "./dailyNotice.js";
import { hostAnswers } from "./hostAnswers.js";
import { checkSkills, type SkillsCheckResult } from "./skillsManifest.js";
import { updateCheckDisabled } from "./updateCheck.js";
import { VERSION } from "../version.js";

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

interface SkillsUpdateMeta {
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

function cacheFresh(config: ReturnType<typeof readConfig>, now: number): boolean {
  if (!config.lastSkillsCheck || config.skillsCheckedVersion !== VERSION) return false;
  return now - new Date(config.lastSkillsCheck).getTime() < CHECK_INTERVAL_MS;
}

/** Run the real check and persist the result to the cache. Skipped when DNS does not answer. */
export async function refreshSkillsCache(): Promise<void> {
  if (!(await hostAnswers("github.com"))) return;
  // `canonical: true` so this nudge's counts agree with `updateSkills`'s
  // source of truth — otherwise a stale in-repo skills-manifest.json (e.g.
  // inside a hyperframes checkout) can produce a false-positive count here.
  recordSkillsCheck(await checkSkills({ canonical: true, cliVersion: VERSION }));
}

/** Cache a canonical skills check (at this CLI's tag) for the nudge and `_meta.skillsOutdated`. */
export function recordSkillsCheck(result: SkillsCheckResult): void {
  // Only record a meaningful check when skills were actually found.
  if (!result.location) {
    forgetInstalledSkills();
    return;
  }
  // Fresh read: this runs in a background child, beside the command's own config writes.
  const config = readConfigFresh();
  config.lastSkillsCheck = new Date().toISOString();
  config.skillsCheckedVersion = VERSION;
  config.skillsUpdateAvailable = result.updateAvailable;
  config.skillsOutdatedCount = result.summary.outdated;
  // Core-missing only: skills that install on demand (workflows not yet
  // triggered on this machine) are not "missing" worth nagging about.
  config.skillsMissingCount = result.summary.coreMissing;
  // Which skills, for telemetry: an on-demand skill that never triggers may simply not be there.
  const installed = result.skills.filter((s) => s.status !== "missing");
  config.skillsInstalled = installed.map((s) => s.name).sort();
  config.skillsOutdated = installed
    .filter((s) => s.status === "outdated")
    .map((s) => s.name)
    .sort();
  writeConfig(config);
}

/**
 * Drop the cached verdict (counts + timestamp) so the next command's
 * background check re-runs instead of nagging from a pre-reconcile snapshot.
 *
 * Called after a `skills` install/update/check has reconciled or re-measured
 * the install. Those commands are excluded from the nudge pipeline entirely
 * (see cli.ts), so nothing else refreshes the cache when they run — without
 * this, the last background verdict (taken BEFORE the install) keeps printing
 * "N skills out of date or missing" on every other command for up to 2h
 * after a successful install/update.
 *
 * Counts are cleared along with the timestamp — not left behind — so an
 * offline machine (where the next refresh fails and falls back to the cached
 * meta) goes quiet rather than resurrecting the stale pre-install counts.
 *
 * Best-effort: a config write failure must never fail the skills command
 * that just succeeded.
 */
function forgetInstalledSkills(): void {
  const config = readConfigFresh();
  if (!config.skillsInstalled && !config.skillsOutdated) return;
  delete config.skillsInstalled;
  delete config.skillsOutdated;
  writeConfig(config);
}

export function invalidateSkillsCache(): void {
  try {
    // Fresh read narrows the lost-update window against a concurrently
    // running CLI process that wrote other config fields in the meantime.
    const config = readConfigFresh();
    delete config.lastSkillsCheck;
    delete config.skillsCheckedVersion;
    delete config.skillsUpdateAvailable;
    delete config.skillsOutdatedCount;
    delete config.skillsMissingCount;
    delete config.skillsInstalled;
    delete config.skillsOutdated;
    writeConfig(config);
  } catch {
    // best-effort — never break the command that just reconciled skills
  }
}

/** Not tied to a TTY: agents run the CLI without one and are the ones that need to hear it. */
function skillsNoticeOff(): boolean {
  return process.env["HYPERFRAMES_SKIP_SKILLS"] === "1" || updateCheckDisabled();
}

/** Whether a background skills check is due: this run shows notices and the 2 h cache is stale. */
export function skillsCheckDue(): boolean {
  if (skillsNoticeOff()) return false;
  return !cacheFresh(readConfig(), Date.now());
}

/** The stale-skills nudge text, or null when nothing is outdated or missing. */
function skillsNoticeText(meta: SkillsUpdateMeta): string | null {
  const total = meta.outdated + meta.missing;
  if (total < 1) return null;
  const noun = total === 1 ? "skill" : "skills";
  return `\n  ${total} HyperFrames ${noun} out of date or missing.\n  For the user: npx hyperframes skills update refreshes them.\n\n`;
}

/**
 * Print a one-line nudge to stderr if installed skills are stale, at most once a day per project.
 * Off in CI, dev, HYPERFRAMES_NO_UPDATE_CHECK and HYPERFRAMES_SKIP_SKILLS. Unattended, only
 * missing skills count: an agent without them cannot do the work, an outdated one still can.
 */
export function printSkillsUpdateNotice(cwd: string = process.cwd()): void {
  if (skillsNoticeOff()) return;
  const meta = getSkillsUpdateMeta();
  const text = skillsNoticeText(isUnattended() ? { ...meta, outdated: 0 } : meta);
  if (text && claimDailyNotice("skills", resolve(cwd))) process.stderr.write(text);
}
