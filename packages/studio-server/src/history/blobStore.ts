import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { atomicTempPath } from "@hyperframes/core/atomic-file";
import {
  isWindowsHold,
  renameWithRetry,
  renameWithRetryAsync,
} from "@hyperframes/core/rename-retry";
import { stopServingAndClose } from "../helpers/servedFiles.js";

/** File contents stored once by sha256, text and binary alike. */
export interface BlobStore {
  /** Copies the file in (a clone where the file system can) and returns the copy's hash. */
  put(absPath: string): Promise<string>;
  reference(absPath: string): Promise<string>;
  has(hash: string): boolean;
  read(hash: string): Promise<Buffer>;
  /** Writes the blob's bytes to `absPath` by clone-or-copy and rename, so a reader never sees half a file. */
  writeTo(hash: string, absPath: string, beforeReplace?: () => void): Promise<void>;
  bytes(): number;
  size(hash: string): number;
  keep(path: string, absPath: string, remove: boolean): Promise<void>;
  release(held: Iterable<readonly [hash: string, path: string]>): Promise<void>;
  prune(keep: ReadonlySet<string>): Promise<void>;
  drop(hashes: Iterable<string>): Promise<void>;
}

const BLOB_HASH = /^[0-9a-f]{64}$/;

export function blobPath(dir: string, hash: string): string {
  // Checked where the path is joined, so no caller can read or write outside the store.
  if (!BLOB_HASH.test(hash)) throw new Error("That is not a history blob.");
  return join(dir, hash.slice(0, 2), hash);
}

export const readBlob = (dir: string, hash: string) => readFile(blobPath(dir, hash));

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function cloneOrStream(from: string, to: string): Promise<void> {
  try {
    await copyFile(from, to, constants.COPYFILE_FICLONE_FORCE);
  } catch {
    const { mode } = await stat(from);
    await pipeline(createReadStream(from), createWriteStream(to, { mode }));
  }
}

export type InPlaceOutcome = "restored" | "mismatch" | "failed";
type InPlaceListener = (absPath: string, outcome: InPlaceOutcome) => void;
const inPlaceListeners = new Set<InPlaceListener>();

export function onRestoredInPlace(listener: InPlaceListener): () => void {
  inPlaceListeners.add(listener);
  return () => inPlaceListeners.delete(listener);
}

async function cloneOrCopy(
  from: string,
  to: string,
  hash: string,
  beforeReplace?: () => void,
): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  const temp = atomicTempPath(to);
  try {
    await copyFile(from, temp, constants.COPYFILE_FICLONE);
    await stopServingAndClose(to);
    beforeReplace?.();
    try {
      renameWithRetry(temp, to);
    } catch (error) {
      if (!isWindowsHold(error)) throw error;
      await writeInPlace(temp, to, hash);
    }
  } finally {
    await rm(temp, { force: true });
  }
}

// Something outside the app still holds the file: write in place, sync, and fail on any mismatch with the blob.
async function writeInPlace(temp: string, to: string, hash: string): Promise<void> {
  let outcome: InPlaceOutcome = "failed";
  try {
    await copyFile(temp, to);
    const handle = await open(to, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    outcome = (await hashFile(to)) === hash ? "restored" : "mismatch";
  } finally {
    for (const listener of inPlaceListeners) listener(to, outcome);
  }
  if (outcome === "mismatch")
    throw new Error("The file was written in place, but it does not match the copy history kept.");
}

const listDir = (path: string) =>
  readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

export async function openBlobStore(dir: string): Promise<BlobStore> {
  const sizes = new Map<string, number>();
  const asideDir = join(dirname(dir), "aside");
  const asideSizes = new Map<string, number>();
  // The project paths still counting on each set-aside copy; it goes when the last one has its file back.
  const holds = new Map<string, Set<string>>();
  await mkdir(dir, { recursive: true });
  for (const [root, found] of [
    [dir, sizes],
    [asideDir, asideSizes],
  ] as const)
    for (const shard of await listDir(root)) {
      if (!shard.isDirectory()) {
        // A crash mid-copy leaves its unpublished temp file beside the shards.
        if (shard.name.startsWith("incoming-")) await rm(join(root, shard.name), { force: true });
        continue;
      }
      for (const hash of await listDir(join(root, shard.name)))
        found.set(hash.name, (await stat(join(root, shard.name, hash.name))).size);
    }
  for (const hash of asideSizes.keys()) holds.set(hash, new Set(["*"]));
  const pathOf = (hash: string) => blobPath(sizes.has(hash) ? dir : asideDir, hash);
  let total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const forget = async (hash: string) => {
    await rm(blobPath(dir, hash), { force: true });
    total -= sizes.get(hash) ?? 0;
    sizes.delete(hash);
  };
  const forgetAside = async (hash: string) => {
    await rm(blobPath(asideDir, hash), { force: true });
    asideSizes.delete(hash);
    holds.delete(hash);
  };

  return {
    async put(absPath) {
      // Hash the copy, not the source, so a write racing the copy can never file bytes under the wrong hash.
      const temp = join(dir, `incoming-${randomUUID()}`);
      // Recreated if removed while open, so a missing folder is never mistaken for a deleted project file.
      await mkdir(dir, { recursive: true });
      await cloneOrStream(absPath, temp).catch(async (error) => {
        await rm(temp, { force: true });
        throw error;
      });
      const hash = await hashFile(temp);
      if (sizes.has(hash)) {
        await rm(temp, { force: true });
        return hash;
      }
      await mkdir(dirname(blobPath(dir, hash)), { recursive: true });
      const size = (await stat(temp)).size;
      await renameWithRetryAsync(temp, blobPath(dir, hash));
      sizes.set(hash, size);
      total += size;
      return hash;
    },
    reference: (absPath) => hashFile(absPath),
    has: (hash) => sizes.has(hash) || asideSizes.has(hash),
    read: (hash) => readFile(pathOf(hash)),
    writeTo: async (hash, absPath, beforeReplace) =>
      cloneOrCopy(pathOf(hash), absPath, hash, beforeReplace),
    async release(held) {
      for (const [hash, path] of held) {
        holds.get(hash)?.delete(path);
        if (holds.get(hash)?.size === 0) await forgetAside(hash);
      }
    },
    async keep(path, absPath, remove) {
      const hash = await hashFile(absPath);
      if (sizes.has(hash)) return;
      if (asideSizes.has(hash)) {
        holds.get(hash)!.add(path);
        return;
      }
      const to = blobPath(asideDir, hash);
      await mkdir(dirname(to), { recursive: true });
      const moved =
        remove &&
        (await renameWithRetryAsync(absPath, to).then(
          () => true,
          () => false,
        ));
      if (!moved) {
        const temp = join(asideDir, `incoming-${randomUUID()}`);
        await cloneOrStream(absPath, temp).catch(async (error) => {
          await rm(temp, { force: true });
          throw error;
        });
        await renameWithRetryAsync(temp, to);
      }
      asideSizes.set(hash, (await stat(to)).size);
      holds.set(hash, new Set([path]));
    },
    bytes: () => total,
    size: (hash) => sizes.get(hash) ?? 0,
    async drop(hashes) {
      for (const hash of hashes) if (sizes.has(hash)) await forget(hash);
    },
    async prune(keep) {
      for (const hash of [...sizes.keys()]) if (!keep.has(hash)) await forget(hash);
      for (const hash of [...asideSizes.keys()]) if (!keep.has(hash)) await forgetAside(hash);
    },
  };
}
