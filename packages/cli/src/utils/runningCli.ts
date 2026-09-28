import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One empty file per live CLI process, named by pid; the background installer waits until none is alive. */
export const RUNNING_DIR = join(homedir(), ".hyperframes", "running");

/** Mark this process as running until it exits. Never throws: a failed write only lets an update land sooner. */
export function registerRunningCli(dir: string = RUNNING_DIR): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, String(process.pid));
    writeFileSync(file, "", { mode: 0o600 });
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
