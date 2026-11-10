import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createFileAtomically } from "@hyperframes/core/atomic-file";
import { readHolder, type Holder } from "./projectLock.js";
import { liveOtherOwners, removeIfPresent, sameProcess } from "./renderLockOwners.js";

export interface RenderLockHolder extends Holder {
  project: string;
  identity?: string | null;
}

export class RenderLockStaleBreak extends Error {
  constructor(readonly breakPath: string) {
    super(
      `A render that was reclaiming the render slot stopped part way and left ${breakPath}. ` +
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
      `This account cannot write to ${dir}, where renders take their turn. If accounts share ` +
        `HYPERFRAMES_CACHE_DIR, make the folder writable for all of them (chmod 777 ${dir}); ` +
        "otherwise unset HYPERFRAMES_CACHE_DIR.",
      { cause },
    );
    this.name = "RenderLockUnwritable";
  }
}

/** Accounts sharing a cache folder take turns in one `locks` folder, so each of them must write in it. */
export function ensureLockDir(dir: string): void {
  if (mkdirSync(dir, { recursive: true }) !== undefined && process.platform !== "win32") {
    chmodSync(dir, 0o777);
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
    if (stillStale) removeIfPresent(path);
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
