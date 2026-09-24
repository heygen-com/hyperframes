import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class HistoryBusyError extends Error {
  constructor(readonly pid: number) {
    super(`This project's history is open in another process (pid ${pid}).`);
    this.name = "HistoryBusyError";
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ownerOf(file: string): number | null {
  try {
    return Number(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * One process at a time keeps a project's history open (a second opener would fork the log). Waits up to `waitMs`
 * for the owner to close, takes over a dead owner's lock. ponytail: two takeovers of one dead owner can both win.
 */
export async function takeHistoryOwnership(home: string, waitMs: number): Promise<() => void> {
  const file = join(home, "owner.pid");
  const deadline = Date.now() + waitMs;
  mkdirSync(home, { recursive: true });
  for (;;) {
    // Written aside and linked in, so a reader never sees the file without its pid.
    const draft = join(home, `owner-${randomUUID()}.tmp`);
    writeFileSync(draft, String(process.pid));
    try {
      linkSync(draft, file);
      let held = true;
      return () => {
        if (held) rmSync(file, { force: true });
        held = false;
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      rmSync(draft, { force: true });
    }
    const pid = ownerOf(file);
    if (pid === null) continue;
    if (!alive(pid)) {
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new HistoryBusyError(pid);
    await new Promise((settle) => setTimeout(settle, 50));
  }
}
