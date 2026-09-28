import { mkdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One empty file per live CLI process, named by pid; the background installer waits until none is alive. */
export const RUNNING_DIR = join(homedir(), ".hyperframes", "running");
/** The file is touched this often; the installer ignores files older than RUNNING_STALE_MS. */
export const RUNNING_HEARTBEAT_MS = 30_000;
export const RUNNING_STALE_MS = 5 * 60_000;

/** Mark this process as running until it exits. Never throws: a failed write only lets an update land sooner. */
export function registerRunningCli(dir: string = RUNNING_DIR): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, String(process.pid));
    writeFileSync(file, "", { mode: 0o600 });
    // A killed process leaves its file behind; the heartbeat lets the installer tell it from a live one.
    setInterval(() => {
      try {
        const now = new Date();
        utimesSync(file, now, now);
      } catch {
        /* best-effort */
      }
    }, RUNNING_HEARTBEAT_MS).unref();
    process.on("exit", () => {
      try {
        unlinkSync(file);
      } catch {
        /* already gone */
      }
    });
  } catch {
    /* best-effort */
  }
}
