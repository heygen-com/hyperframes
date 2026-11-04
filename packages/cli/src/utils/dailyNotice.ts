import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_PATH } from "../telemetry/config.js";

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** True at most once a day per project for this kind of notice, recorded in `<kind>-notice.json`. */
export function claimDailyNotice(kind: string, project: string, now = Date.now()): boolean {
  const noticeFile = join(dirname(CONFIG_PATH), `${kind}-notice.json`);
  let shown: Record<string, number> = {};
  try {
    shown = JSON.parse(readFileSync(noticeFile, "utf-8")) as Record<string, number>;
  } catch {
    // first notice, or a damaged file that the write below replaces
  }
  if (now - (shown[project] ?? 0) < NOTICE_INTERVAL_MS) return false;
  const kept = Object.entries(shown).filter(([, at]) => now - at < NOTICE_INTERVAL_MS);
  try {
    mkdirSync(dirname(noticeFile), { recursive: true, mode: 0o700 });
    writeFileSync(noticeFile, JSON.stringify(Object.fromEntries([...kept, [project, now]])));
  } catch {
    return false;
  }
  return true;
}
