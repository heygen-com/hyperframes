import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, renameSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { atomicTempPath } from "@hyperframes/core/atomic-file";

/** File contents stored once by sha256, text and binary alike. */
export interface BlobStore {
  /** Archives the file and returns its hash; a signal makes copy and hash cancellable. */
  put(absPath: string, signal?: AbortSignal): Promise<string>;
  has(hash: string): boolean;
  read(hash: string): Promise<Buffer>;
  /** Writes the blob's bytes to `absPath` by clone-or-copy and rename, so a reader never sees half a file. */
  writeTo(hash: string, absPath: string, beforeReplace?: () => void): Promise<void>;
  bytes(): number;
  size(hash: string): number;
  prune(keep: ReadonlySet<string>): Promise<void>;
}

const BLOB_HASH = /^[0-9a-f]{64}$/;

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

async function cloneOrCopy(from: string, to: string, beforeReplace?: () => void): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  const temp = atomicTempPath(to);
  try {
    await copyFile(from, temp, constants.COPYFILE_FICLONE);
    beforeReplace?.();
    renameSync(temp, to);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function openBlobStore(dir: string): Promise<BlobStore> {
  const sizes = new Map<string, number>();
  await mkdir(dir, { recursive: true });
  for (const shard of await readdir(dir))
    for (const hash of await readdir(join(dir, shard)).catch(() => []))
      sizes.set(hash, (await stat(join(dir, shard, hash))).size);
  const pathOf = (hash: string) => {
    // Checked where the path is joined, so no caller can read or write outside the store.
    if (!BLOB_HASH.test(hash)) throw new Error("That is not a history blob.");
    return join(dir, hash.slice(0, 2), hash);
  };
  let total = [...sizes.values()].reduce((sum, size) => sum + size, 0);

  return {
    async put(absPath, signal) {
      // Hash the copy, not the source, so a write racing the copy can never file bytes under the wrong hash.
      const temp = join(dir, `incoming-${randomUUID()}`);
      // Recreated if removed while open, so a missing folder is never mistaken for a deleted project file.
      await mkdir(dir, { recursive: true });
      try {
        if (signal) {
          await pipeline(createReadStream(absPath), createWriteStream(temp), { signal });
        } else {
          await copyFile(absPath, temp, constants.COPYFILE_FICLONE);
        }
        const hash = await hashFile(temp, signal);
        signal?.throwIfAborted();
        if (sizes.has(hash)) return hash;
        await mkdir(dirname(pathOf(hash)), { recursive: true });
        const size = (await stat(temp)).size;
        signal?.throwIfAborted();
        await rename(temp, pathOf(hash));
        sizes.set(hash, size);
        total += size;
        return hash;
      } finally {
        await rm(temp, { force: true });
      }
    },
    has: (hash) => sizes.has(hash),
    read: async (hash) => readFile(pathOf(hash)),
    writeTo: async (hash, absPath, beforeReplace) =>
      cloneOrCopy(pathOf(hash), absPath, beforeReplace),
    bytes: () => total,
    size: (hash) => sizes.get(hash) ?? 0,
    async prune(keep) {
      for (const [hash, size] of sizes) {
        if (keep.has(hash)) continue;
        await rm(pathOf(hash), { force: true });
        sizes.delete(hash);
        total -= size;
      }
    },
  };
}
