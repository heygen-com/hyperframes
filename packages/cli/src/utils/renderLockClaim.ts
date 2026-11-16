import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  type Stats,
} from "node:fs";
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

export class RenderLockFolderRefused extends Error {
  constructor(
    readonly dir: string,
    shared: boolean,
  ) {
    super(
      shared
        ? `${dir} is not a folder that this account or root owns with the sticky bit set, so another ` +
            "account could delete or replace render lock records in it. Point HYPERFRAMES_RENDER_LOCK_DIR " +
            `at a folder that does not exist yet, or have its owner run: chmod 1777 ${dir}`
        : `${dir} is not a folder this account owns, so another account could delete or replace render ` +
            "lock records in it. Remove it, or point HYPERFRAMES_RENDER_LOCK_DIR at a folder for lock records.",
    );
    this.name = "RenderLockFolderRefused";
  }
}

const OPEN_FOLDER_NOT_LINK = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const PRIVATE_FOLDER = 0o700;
const SHARED_STICKY_FOLDER = 0o1777;

const lockFolderAccepted = (stat: Stats, shared: boolean) =>
  shared ? (stat.mode & 0o1000) !== 0 : (stat.mode & 0o077) === 0;

export function ensureLockDir(dir: string, shared: boolean): void {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") return;
  let fd: number;
  try {
    fd = openSync(dir, OPEN_FOLDER_NOT_LINK);
  } catch (error) {
    throw Object.assign(new RenderLockFolderRefused(dir, shared), { cause: error });
  }
  try {
    settleLockFolder(fd, dir, shared);
  } finally {
    closeSync(fd);
  }
}

function settleLockFolder(fd: number, dir: string, shared: boolean): void {
  const stat = fstatSync(fd);
  const mine = stat.uid === process.getuid?.();
  if (!mine && !(shared && stat.uid === 0)) throw new RenderLockFolderRefused(dir, shared);
  const mode = shared ? SHARED_STICKY_FOLDER : PRIVATE_FOLDER;
  if (mine && (stat.mode & 0o7777) !== mode) fchmodSync(fd, mode);
  if (!lockFolderAccepted(fstatSync(fd), shared)) throw new RenderLockFolderRefused(dir, shared);
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
