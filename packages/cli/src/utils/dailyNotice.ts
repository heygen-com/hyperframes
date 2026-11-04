import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_PATH } from "../telemetry/config.js";

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The recorded showings; anything that is not an object of numbers reads as none. */
function readShown(noticeFile: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(noticeFile, "utf-8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
  );
}

/** Shown within the last day. A time ahead of the clock is not trusted, so it reads as stale. */
const recent = (at: number, now: number) => at <= now && now - at < NOTICE_INTERVAL_MS;

/** True at most once a day per project for this kind of notice, recorded in `<kind>-notice.json`. */
export function claimDailyNotice(kind: string, project: string, now = Date.now()): boolean {
  const noticeFile = join(dirname(CONFIG_PATH), `${kind}-notice.json`);
  const shown = readShown(noticeFile);
  if (recent(shown[project] ?? 0, now)) return false;
  const kept = Object.entries(shown).filter(([, at]) => recent(at, now));
  const tmp = `${noticeFile}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(noticeFile), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify(Object.fromEntries([...kept, [project, now]])), {
      mode: 0o600,
    });
    renameSync(tmp, noticeFile);
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
  return true;
}
