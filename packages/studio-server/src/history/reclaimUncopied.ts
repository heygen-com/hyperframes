import { readdirSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { blobPath } from "./blobStore.js";
import { isHistoryId } from "./historyId.js";
import { readLog, type HistoryLog } from "./historyLog.js";
import { HistoryBusyError, takeHistoryOwnership } from "./ownerLock.js";
import { uncopiedOnlyHashes } from "./uncopied.js";

export interface ReclaimedHistory {
  id: string;
  bytes: number;
}

function historyIds(historyRoot: string): string[] {
  try {
    return readdirSync(historyRoot).filter(isHistoryId);
  } catch {
    return [];
  }
}

function namedHashes(log: HistoryLog): Set<string> {
  const hashes = new Set<string>(log.baseline.values());
  for (const entry of log.entries) {
    for (const file of entry.files) {
      if (file.before) hashes.add(file.before);
      if (file.after) hashes.add(file.after);
    }
  }
  return hashes;
}

async function blobSizes(blobs: string, hashes: Iterable<string>): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const hash of hashes)
    sizes.set(hash, (await stat(blobPath(blobs, hash)).catch(() => null))?.size ?? 0);
  return sizes;
}

async function reclaimOne(home: string, dryRun: boolean): Promise<number> {
  const log = readLog(join(home, "log.jsonl"), () => {});
  if (!log) return 0;
  const blobs = join(home, "blobs");
  const sizes = await blobSizes(blobs, namedHashes(log));
  let bytes = 0;
  for (const hash of uncopiedOnlyHashes(log, (known) => sizes.get(known) ?? 0)) {
    const size = sizes.get(hash) ?? 0;
    if (size === 0) continue;
    bytes += size;
    if (!dryRun) await rm(blobPath(blobs, hash), { force: true });
  }
  return bytes;
}

/** Drops the media copies older versions left in every history no running process holds; the same rule as on open. */
export async function reclaimUncopiedBlobs(
  historyRoot: string,
  { dryRun = false, onError }: { dryRun?: boolean; onError?: (error: unknown) => void } = {},
): Promise<ReclaimedHistory[]> {
  const reclaimed: ReclaimedHistory[] = [];
  for (const id of historyIds(historyRoot)) {
    const home = join(historyRoot, id);
    let release: (() => void) | undefined;
    try {
      release = await takeHistoryOwnership(home, 0);
      const bytes = await reclaimOne(home, dryRun);
      if (bytes > 0) reclaimed.push({ id, bytes });
    } catch (error) {
      if (!(error instanceof HistoryBusyError)) onError?.(error);
    } finally {
      release?.();
    }
  }
  return reclaimed;
}
