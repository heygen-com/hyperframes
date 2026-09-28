import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One empty file per live CLI process, named by pid; the background installer waits until none is alive. */
export const RUNNING_DIR = join(homedir(), ".hyperframes", "running");
const RUNNING_HEARTBEAT_MS = 30_000;
export const RUNNING_STALE_MS = 10 * 60_000;

/** Mark this process as running until it exits. Never throws: a failed write only lets an update land sooner. */
export function registerRunningCli(
  dir: string = RUNNING_DIR,
  heartbeatMs: number = RUNNING_HEARTBEAT_MS,
): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, String(process.pid));
    writeFileSync(file, "", { mode: 0o600 });
    const heartbeat = setInterval(() => {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(file, String(Date.now()), { mode: 0o600 });
      } catch {
        /* best-effort */
      }
    }, heartbeatMs);
    heartbeat.unref();
    process.on("exit", () => {
      clearInterval(heartbeat);
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
