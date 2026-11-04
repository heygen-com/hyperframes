import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const POLL_MS = 500;
const UNREADABLE_LOCK_MS = 10_000;

function lockPathFor(cachePath: string): string {
  return join(dirname(cachePath), `.lock-${basename(cachePath)}`);
}

export class CopyLockStalledError extends Error {
  constructor(copy: string, stallMs: number) {
    super(
      `another process holds the copy of ${copy} and has made no progress for ${Math.round(stallMs / 1000)}s`,
    );
    this.name = "CopyLockStalledError";
  }
}

function lastActivityMs(cachePath: string, lockPath: string): number {
  const name = basename(cachePath);
  const stem = basename(cachePath, extname(cachePath));
  const mine = (file: string) =>
    file === basename(lockPath) ||
    (file.startsWith(".tmp-") && (file.endsWith(`-${name}`) || file.includes(`-.part-${stem}-`))) ||
    file.startsWith(`.part-${stem}-`);
  let newest = 0;
  for (const file of readdirSync(dirname(cachePath))) {
    if (!mine(file)) continue;
    const changed = statSync(join(dirname(cachePath), file), { throwIfNoEntry: false })?.mtimeMs;
    newest = Math.max(newest, changed ?? 0);
  }
  return newest;
}

function ownerIsAlive(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) {
      return Date.now() - statSync(lockPath).mtimeMs < UNREADABLE_LOCK_MS;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch {
    return false;
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The right to make the copy at `cachePath`; null once another process finished it; throws on a stalled live owner. */
export async function acquireCopyLock(
  cachePath: string,
  signal: AbortSignal,
  stallMs: number,
): Promise<(() => void) | null> {
  const lockPath = lockPathFor(cachePath);
  for (;;) {
    signal.throwIfAborted();
    if (existsSync(cachePath)) return null;
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      if (!existsSync(cachePath)) return () => rmSync(lockPath, { force: true });
      rmSync(lockPath, { force: true });
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (!ownerIsAlive(lockPath)) rmSync(lockPath, { force: true });
    else if (Date.now() - lastActivityMs(cachePath, lockPath) > stallMs)
      throw new CopyLockStalledError(basename(cachePath), stallMs);
    else await pause(POLL_MS, signal);
  }
}
