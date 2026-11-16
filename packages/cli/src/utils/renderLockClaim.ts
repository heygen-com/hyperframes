import { chmodSync, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { createFileAtomically } from "@hyperframes/core/atomic-file";
import { readHolder, type Holder } from "./projectLock.js";
import { liveOtherOwners, removeIfPresent, sameProcess } from "./renderLockOwners.js";

export interface RenderLockHolder extends Holder {
  project: string;
  identity?: string | null;
}

export class RenderLockStaleBreak extends Error {
  constructor(
    readonly breakPath: string,
    otherAccount = false,
  ) {
    super(
      (otherAccount
        ? `A render of another account stopped and left ${breakPath}, which only that account or root ` +
          "can delete in a shared lock folder. "
        : `A render that was reclaiming the render slot stopped part way and left ${breakPath}. `) +
        "No render is using it: delete that file, then run the render again.",
    );
    this.name = "RenderLockStaleBreak";
  }
}

export class RenderLockUnwritable extends Error {
  constructor(
    readonly dir: string,
    cause: unknown,
  ) {
    super(
      `This account cannot write to ${dir}, where renders take their turn. To share one render slot ` +
        "across accounts, point HYPERFRAMES_RENDER_LOCK_DIR in each of them at one folder for lock " +
        "records only: the first render creates it writable by all and sticky (chmod 1777).",
      { cause },
    );
    this.name = "RenderLockUnwritable";
  }
}

/**
 * A folder this account alone uses is private to it. A folder shared on purpose is writable by every
 * account but sticky, so none of them can delete or replace another's lock records. chmod after
 * mkdir, since the umask would strip those bits.
 */
export function ensureLockDir(dir: string, shared: boolean): void {
  const created = mkdirSync(dir, { recursive: true }) !== undefined;
  if (process.platform === "win32") return;
  if (created) chmodSync(dir, shared ? 0o1777 : 0o700);
  else if (shared) makeSticky(dir);
  else makePrivate(dir);
}

/** Older releases made this account's own lock folder writable by every account. */
function makePrivate(dir: string): void {
  const stat = statSync(dir);
  if (stat.uid === process.getuid?.() && (stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

const warnedNotSticky = new Set<string>();

function makeSticky(dir: string): void {
  if ((statSync(dir).mode & 0o1000) !== 0) return;
  try {
    chmodSync(dir, 0o1777);
  } catch {
    if (warnedNotSticky.has(dir)) return;
    warnedNotSticky.add(dir);
    console.warn(
      `[render] ${dir} (HYPERFRAMES_RENDER_LOCK_DIR) has no sticky bit, so another account could ` +
        `delete or replace this render's lock records. Have its owner run: chmod 1777 ${dir}`,
    );
  }
}

const holderAlive = (holder: RenderLockHolder) => sameProcess(holder.pid, holder.identity);

const sameRecord = (a: RenderLockHolder | null, b: RenderLockHolder) =>
  a?.pid === b.pid && a.startedAt === b.startedAt && a.identity === b.identity;

function createExclusive(path: string, holder: Holder): boolean {
  try {
    createFileAtomically(path, JSON.stringify(holder));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

const writerAbsent = (file: string, lockPath: string, marker: string) =>
  existsSync(file) && !readHolder(file) && liveOtherOwners(lockPath, marker) === 0;

/**
 * Removes a stale lock and creates this one. The sticky bit of a shared lock folder keeps a stale lock of
 * another account where it is, which no render of this account can then replace.
 */
function replaceStale(
  path: string,
  holder: RenderLockHolder,
  observed: RenderLockHolder | null,
): boolean {
  removeIfPresent(path);
  if (createExclusive(path, holder)) return true;
  if (
    process.platform !== "win32" &&
    observed &&
    sameRecord(readHolder<RenderLockHolder>(path), observed)
  ) {
    throw new RenderLockStaleBreak(path, true);
  }
  return false;
}

/**
 * Replaces a stale lock under `.break`, which only its writer ever removes: a `.break` whose writer is
 * gone stops the render with what to delete, since removing it on an earlier reading could remove a
 * live one written since.
 */
async function takeOver(
  path: string,
  holder: RenderLockHolder,
  observed: RenderLockHolder | null,
  marker: string,
  beforeReplace?: () => void | Promise<void>,
): Promise<boolean> {
  const breakPath = `${path}.break`;
  if (!createExclusive(breakPath, holder)) {
    const breaker = readHolder<RenderLockHolder>(breakPath);
    if (breaker ? holderAlive(breaker) : !writerAbsent(breakPath, path, marker)) return false;
    throw new RenderLockStaleBreak(breakPath);
  }
  try {
    await beforeReplace?.();
    const stillStale = observed
      ? sameRecord(readHolder<RenderLockHolder>(path), observed)
      : writerAbsent(path, path, marker);
    if (stillStale) return replaceStale(path, holder, observed);
    return createExclusive(path, holder);
  } finally {
    if (sameRecord(readHolder<RenderLockHolder>(breakPath), holder)) unlinkSync(breakPath);
  }
}

/** Creates the lock, or replaces one whose holder is provably gone. */
export async function claimSlot(
  path: string,
  holder: RenderLockHolder,
  marker: string,
  beforeReplace?: () => void | Promise<void>,
): Promise<boolean> {
  if (createExclusive(path, holder)) return true;
  const current = readHolder<RenderLockHolder>(path);
  if (current ? holderAlive(current) : !writerAbsent(path, path, marker)) return false;
  return takeOver(path, holder, current, marker, beforeReplace);
}
