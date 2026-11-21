import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, type Stats } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { atomicTempPath, refuseReadOnly } from "@hyperframes/core/atomic-file";
import { isWindowsHold, renameWithRetryAsync } from "@hyperframes/core/rename-retry";
import { stopServingAndClose } from "../helpers/servedFiles.js";
import { assertLandedIn, assertStillWithin, folderWithin } from "./containedPath.js";

/** File contents stored once by sha256, text and binary alike. */
export interface BlobStore {
  /** Copies the file in (cloned where it can) and returns its hash; null while it keeps changing. */
  put(absPath: string, pin?: boolean): Promise<string | null>;
  unpin(hash: string): void;
  pinned(): Iterable<string>;
  reference(absPath: string): Promise<string>;
  has(hash: string): boolean;
  read(hash: string): Promise<Buffer>;
  /** Writes the blob's bytes, checked against `hash`, to `path` in `root` by clone and rename; no link is followed. */
  writeTo(hash: string, root: string, path: string, beforeReplace?: () => void): Promise<void>;
  bytes(): number;
  size(hash: string): number;
  keep(path: string, absPath: string, remove: boolean): Promise<void>;
  release(held: Iterable<readonly [hash: string, path: string]>): Promise<void>;
  prune(keep: ReadonlySet<string>): Promise<void>;
  drop(hashes: Iterable<string>): Promise<void>;
}

const BLOB_HASH = /^[0-9a-f]{64}$/;
const READ_ONCE_AT_MOST_BYTES = 64 * 1024;
const READS_BEFORE_LEAVING_IT = 3;

// Longer than the 20 ms a watcher gathers a burst for, so the sweep a save's first event starts sees it under way.
export const SETTLE_MS = 100;

export const isSettling = (file: { mtimeMs: number; ctimeMs: number }, now: number) =>
  Math.abs(now - Math.max(file.mtimeMs, file.ctimeMs)) < SETTLE_MS;

const unchanged = (before: Stats, after: Stats) =>
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs &&
  before.ctimeMs === after.ctimeMs;

export function blobPath(dir: string, hash: string): string {
  // Checked where the path is joined, so no caller can read or write outside the store.
  if (!BLOB_HASH.test(hash)) throw new Error("That is not a history blob.");
  return join(dir, hash.slice(0, 2), hash);
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const damaged = () =>
  new Error("History's copy of this version is damaged, so it was not used. Nothing was changed.");

async function readChecked(path: string, hash: string): Promise<Buffer> {
  const bytes = await readFile(path);
  if (sha256(bytes) !== hash) throw damaged();
  return bytes;
}

export const readBlob = (dir: string, hash: string) => readChecked(blobPath(dir, hash), hash);

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readIfSmall(
  path: string,
): Promise<{ bytes: Buffer; mode: number; moved: boolean } | null> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (before.size > READ_ONCE_AT_MOST_BYTES) return null;
    const bytes = await handle.readFile();
    return { bytes, mode: before.mode, moved: !unchanged(before, await handle.stat()) };
  } finally {
    await handle.close();
  }
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
  hash: string,
  root: string,
  path: string,
  beforeReplace?: () => void,
): Promise<void> {
  const folder = folderWithin(root, path, true)!;
  const to = join(folder, basename(path));
  const servedAs = join(root, path);
  refuseReadOnly(to);
  const temp = atomicTempPath(to);
  try {
    await copyFile(from, temp, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
    assertLandedIn(folder, temp);
    if ((await hashFile(temp)) !== hash) throw damaged();
    await stopServingAndClose(servedAs);
    try {
      await renameWithRetryAsync(temp, to, {
        rename: async (from, to) => {
          beforeReplace?.();
          assertStillWithin(folder);
          await rename(from, to);
        },
      });
    } catch (error) {
      if (!isWindowsHold(error)) throw error;
      await writeInPlace(temp, folder, to, servedAs, hash);
    }
  } finally {
    await rm(temp, { force: true });
  }
}

// Something outside the app still holds the file: write in place, sync, and fail on any mismatch with the blob.
async function writeInPlace(
  temp: string,
  folder: string,
  to: string,
  servedAs: string,
  hash: string,
): Promise<void> {
  let outcome: InPlaceOutcome = "failed";
  try {
    assertLandedIn(folder, to);
    await copyFile(temp, to);
    const handle = await open(to, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    outcome = (await hashFile(to)) === hash ? "restored" : "mismatch";
  } finally {
    for (const listener of inPlaceListeners) listener(servedAs, outcome);
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
  const pins = new Map<string, number>();
  const pin = (hash: string) => pins.set(hash, (pins.get(hash) ?? 0) + 1);
  const turns = new Map<string, Promise<unknown>>();
  const inTurn = <T>(hash: string, step: () => Promise<T>): Promise<T> => {
    const done = (turns.get(hash) ?? Promise.resolve()).then(step, step);
    const tail = done.catch(() => {});
    turns.set(hash, tail);
    void tail.then(() => turns.get(hash) === tail && turns.delete(hash));
    return done;
  };
  const forget = (hash: string) =>
    inTurn(hash, async () => {
      if (pins.has(hash) || !sizes.has(hash)) return;
      await rm(blobPath(dir, hash), { force: true });
      total -= sizes.get(hash) ?? 0;
      sizes.delete(hash);
    });
  const forgetAside = async (hash: string) => {
    await rm(blobPath(asideDir, hash), { force: true });
    asideSizes.delete(hash);
    holds.delete(hash);
  };

  const file = (hash: string, size: number) => {
    if (!sizes.has(hash)) total += size;
    sizes.set(hash, size);
  };
  const withFolderMadeIfMissing = (folder: string, write: () => Promise<void>) =>
    write().catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      await mkdir(folder, { recursive: true });
      await write();
    });
  // The bytes hashed are the bytes filed, so a write racing the read can never file bytes under the wrong hash.
  const putBytes = async (bytes: Buffer, mode: number, pinned: boolean) => {
    const hash = sha256(bytes);
    return inTurn(hash, () => filedBytes(hash, bytes, mode, pinned));
  };
  const filedBytes = async (hash: string, bytes: Buffer, mode: number, pinned: boolean) => {
    if (sizes.has(hash)) return pinned ? (pin(hash), hash) : hash;
    const temp = join(dir, `incoming-${randomUUID()}`);
    try {
      await withFolderMadeIfMissing(dir, () => writeFile(temp, bytes, { mode }));
      // A write applies the umask; the clone used for larger files keeps the mode exactly.
      await chmod(temp, mode & 0o7777);
      const to = blobPath(dir, hash);
      await withFolderMadeIfMissing(dirname(to), () => renameWithRetryAsync(temp, to));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    file(hash, bytes.length);
    if (pinned) pin(hash);
    return hash;
  };

  const putIfUnchanged = async (absPath: string, pinned: boolean): Promise<string | null> => {
    const small = await readIfSmall(absPath);
    if (small) return small.moved ? null : putBytes(small.bytes, small.mode, pinned);
    // Hash the copy, not the source, so a write racing the copy can never file bytes under the wrong hash.
    const temp = join(dir, `incoming-${randomUUID()}`);
    // Recreated if removed while open, so a missing folder is never mistaken for a deleted project file.
    await mkdir(dir, { recursive: true });
    const before = await stat(absPath);
    const moved = await cloneOrStream(absPath, temp)
      .then(async () => !unchanged(before, await stat(absPath)))
      .catch(async (error) => {
        await rm(temp, { force: true });
        throw error;
      });
    if (moved) {
      await rm(temp, { force: true });
      return null;
    }
    const hash = await hashFile(temp);
    return inTurn(hash, async () => {
      if (sizes.has(hash)) {
        await rm(temp, { force: true });
        if (pinned) pin(hash);
        return hash;
      }
      await mkdir(dirname(blobPath(dir, hash)), { recursive: true });
      const size = (await stat(temp)).size;
      await renameWithRetryAsync(temp, blobPath(dir, hash));
      file(hash, size);
      if (pinned) pin(hash);
      return hash;
    });
  };

  return {
    async put(absPath, pinned = false) {
      for (let read = 0; read < READS_BEFORE_LEAVING_IT; read += 1) {
        const hash = await putIfUnchanged(absPath, pinned);
        if (hash !== null) return hash;
      }
      return null;
    },
    reference: (absPath) => hashFile(absPath),
    has: (hash) => sizes.has(hash) || asideSizes.has(hash),
    read: (hash) => readChecked(pathOf(hash), hash),
    writeTo: async (hash, root, path, beforeReplace) =>
      cloneOrCopy(pathOf(hash), hash, root, path, beforeReplace),
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
    unpin(hash) {
      const left = (pins.get(hash) ?? 0) - 1;
      if (left > 0) pins.set(hash, left);
      else pins.delete(hash);
    },
    pinned: () => pins.keys(),
    async prune(keep) {
      for (const hash of [...sizes.keys()]) if (!keep.has(hash)) await forget(hash);
      for (const hash of [...asideSizes.keys()]) if (!keep.has(hash)) await forgetAside(hash);
    },
  };
}
