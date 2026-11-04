import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { processIdentity } from "./orphanCleanup.js";
import { alive } from "./projectLock.js";

interface LockOwner {
  pid: number;
  identity: string | null;
}

const markerPrefix = (lockPath: string) => `${basename(lockPath)}.owner-`;

// Windows refuses to delete or replace a file another handle still holds: that file is in use, not abandoned.
const HELD_CODES = new Set(process.platform === "win32" ? ["EPERM", "EBUSY", "EACCES"] : ["EBUSY"]);
const UNREMOVABLE_CODES = new Set(["ENOENT", "EPERM", "EACCES", "EBUSY"]);

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code ?? "";

export function isHeldError(error: unknown): boolean {
  return HELD_CODES.has(errorCode(error));
}

/** Null on Windows, where the lookup starts PowerShell for every call: liveness falls back to the pid. */
export function startToken(pid: number): string | null {
  return process.platform === "win32" ? null : processIdentity(pid);
}

/** Marks a contender, under a name only it can take, before it creates the lock or its `.break`. */
export function writeOwnerMarker(lockPath: string, owner: LockOwner): string {
  const name = `${markerPrefix(lockPath)}${owner.pid}-${randomBytes(6).toString("hex")}`;
  const marker = join(dirname(lockPath), name);
  writeFileSync(marker, JSON.stringify(owner), { flag: "wx" });
  return marker;
}

export function removeIfPresent(marker: string): void {
  try {
    unlinkSync(marker);
  } catch (error) {
    if (!UNREMOVABLE_CODES.has(errorCode(error))) throw error;
  }
}

function recordedIdentity(marker: string): string | null {
  try {
    const owner = JSON.parse(readFileSync(marker, "utf8")) as Partial<LockOwner>;
    return typeof owner.identity === "string" ? owner.identity : null;
  } catch {
    return null;
  }
}

/** The pid is alive and, where its start time is known on both sides, it is the same process. */
export function sameProcess(pid: number, identity: string | null | undefined): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return false;
  const current = identity && startToken(pid);
  return !identity || !current || current === identity;
}

/** Counts the other contenders still alive, deleting the markers of processes that are gone. */
export function liveOtherOwners(lockPath: string, own?: string): number {
  const dir = dirname(lockPath);
  const prefix = markerPrefix(lockPath);
  let live = 0;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const marker = join(dir, name);
    if (marker === own) continue;
    if (sameProcess(Number(name.slice(prefix.length).split("-")[0]), recordedIdentity(marker))) {
      live += 1;
    } else removeIfPresent(marker);
  }
  return live;
}
