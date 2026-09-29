import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, readConfigFresh, writeConfig } from "../telemetry/config.js";
import { skillsCheckDue } from "./skillsUpdateCheck.js";
import { updateCheckDue } from "./updateCheck.js";

/** A check that did not refresh its cache (offline, DNS down) is retried at most this often. */
const FAILED_CHECK_RETRY_MS = 60 * 60 * 1000;

function attemptedRecently(stamp: string | undefined, now: number): boolean {
  const age = stamp === undefined ? NaN : now - new Date(stamp).getTime();
  return age >= 0 && age < FAILED_CHECK_RETRY_MS;
}

/** Refresh the due update and skills caches in a detached child, so this process never waits on it. */
export function launchBackgroundChecks(): void {
  const now = Date.now();
  const config = readConfig();
  const due: string[] = [];
  if (updateCheckDue() && !attemptedRecently(config.lastUpdateAttemptAt, now)) due.push("update");
  if (skillsCheckDue() && !attemptedRecently(config.lastSkillsAttemptAt, now)) due.push("skills");
  if (due.length === 0) return;

  const stamped = readConfigFresh();
  const at = new Date(now).toISOString();
  if (due.includes("update")) stamped.lastUpdateAttemptAt = at;
  if (due.includes("skills")) stamped.lastSkillsAttemptAt = at;
  writeConfig(stamped);

  // Next to the bundled cli.js; from source (dev mode) no check is ever due.
  const worker = join(dirname(fileURLToPath(import.meta.url)), "backgroundChecksWorker.js");
  try {
    const child = spawn(process.execPath, [worker, ...due], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort: the next run tries again.
  }
}
