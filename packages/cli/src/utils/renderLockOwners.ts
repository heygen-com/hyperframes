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

/**
 * Marks a contender before it creates the lock, under a name no other process can take, so a lock
 * that cannot be read yet is never taken from a writer that is still alive.
 */
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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

function markerLive(marker: string, pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return false;
  const recorded = recordedIdentity(marker);
  const current = recorded && processIdentity(pid);
  return !recorded || !current || current === recorded;
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
    if (markerLive(marker, Number(name.slice(prefix.length).split("-")[0]))) live += 1;
    else removeIfPresent(marker);
  }
  return live;
}
