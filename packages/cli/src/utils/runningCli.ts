import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One empty file per live CLI process, named by pid; the background installer waits until none is alive. */
export const RUNNING_DIR = join(homedir(), ".hyperframes", "running");
const RUNNING_HEARTBEAT_MS = 30_000;
export const RUNNING_STALE_MS = 10 * 60_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function pruneExitedClis(dir: string, own: string): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === own) continue;
    const file = join(dir, name);
    try {
      const pid = Number(name);
      const beating = Date.now() - statSync(file).mtimeMs <= RUNNING_STALE_MS;
      // A live pid whose file stopped beating is a reused pid, not a CLI.
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid) && beating) continue;
      unlinkSync(file);
    } catch {
      /* another CLI removed it first */
    }
  }
}

/** Mark this process as running until it exits. Never throws: a failed write only lets an update land sooner. */
export function registerRunningCli(
  dir: string = RUNNING_DIR,
  heartbeatMs: number = RUNNING_HEARTBEAT_MS,
): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, String(process.pid));
    writeFileSync(file, "", { mode: 0o600 });
    pruneExitedClis(dir, String(process.pid));
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
