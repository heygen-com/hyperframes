// @ts-check
import fs, {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { errorCode, isJsonObject, mkdirInside } from "./storage.mjs";

export class ShareBusyError extends Error {
  /** @param {string} path */
  constructor(path) {
    super("Another process is sharing this project. Wait for it to finish, then retry.");
    this.name = "ShareBusyError";
    this.reason = "review_operation_busy";
    this.lockPath = path;
  }
}
/** @typedef {{ token: string, pid: number, hostname: string }} Owner */
/** @param {unknown} value @returns {value is Owner} */
function isOwner(value) {
  return (
    isJsonObject(value) &&
    typeof value.token === "string" &&
    /^[a-f0-9-]{36}$/.test(value.token) &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.hostname === "string"
  );
}

/** @param {string} path @returns {Promise<Owner | null>} */
async function ownerAt(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return isOwner(value) ? value : null;
  } catch (error) {
    if (missing(error) || errorCode(error) === "EISDIR" || error instanceof SyntaxError)
      return null;
    throw error;
  }
}
/** @param {Owner} owner */
function isDead(owner) {
  if (owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}
/** @param {unknown} error */
function missing(error) {
  return errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";
}

/** @param {string} path */
function lockAt(path) {
  return lstat(path).catch((error) => {
    if (missing(error)) return null;
    throw error;
  });
}

/** A claim scoped to the old owner prevents two stale readers deleting a replacement file. @param {string} path */
async function reapFile(path) {
  const old = await ownerAt(path);
  if (!old || !isDead(old)) return;
  const claim = `${path}.reap-${old.token}`;
  const guard = await open(claim, "wx", 0o600).catch((error) => {
    if (errorCode(error) === "EEXIST") return null;
    throw error;
  });
  if (!guard) return;
  try {
    if ((await ownerAt(path))?.token === old.token) await unlink(path);
  } finally {
    await guard.close();
    await unlink(claim);
  }
}
/** Remove only an empty directory: a replacement is published with its owner already inside. @param {string} path */
async function removeEmptyDirectory(path) {
  await rmdir(path).catch((error) => {
    if (!missing(error) && !["ENOTEMPTY", "EEXIST"].includes(String(errorCode(error)))) throw error;
  });
}

/** @param {string} path @param {string} marker */
async function releaseDirectory(path, marker) {
  await unlink(join(path, marker)).catch((error) => {
    if (!missing(error)) throw error;
  });
  await removeEmptyDirectory(path);
}

/** @param {string} path */
async function reapDirectory(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
    if (missing(error)) return [];
    throw error;
  });
  if (entries.length === 0) return removeEmptyDirectory(path);
  const [entry] = entries;
  if (entries.length !== 1 || !entry?.isFile()) return;
  const owner = await ownerAt(join(path, entry.name));
  if (owner && entry.name === `${owner.token}.json` && isDead(owner))
    await releaseDirectory(path, entry.name);
}

/** @param {string} path */
async function reap(path) {
  const stat = await lockAt(path);
  if (stat?.isFile()) return reapFile(path);
  if (stat?.isDirectory()) return reapDirectory(path);
}

/** @param {string} draft @param {string} marker @param {string} lock @param {number} deadline */
async function claim(draft, marker, lock, deadline) {
  try {
    await fs.link(join(draft, marker), lock);
    return "file";
  } catch (error) {
    if (errorCode(error) === "EEXIST") return null;
    if (
      !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EINVAL", "EISDIR", "EACCES"].includes(
        String(errorCode(error)),
      )
    )
      throw error;
  }
  return claimDirectory(draft, lock, deadline);
}

/** @param {string} draft @param {string} lock @param {number} deadline */
async function claimDirectory(draft, lock, deadline) {
  // A directory rename publishes the owner atomically and cannot replace a file or a nonempty directory.
  try {
    await fs.rename(draft, lock);
    return "directory";
  } catch (error) {
    const code = String(errorCode(error));
    if (["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(code)) return null;
    if (["EPERM", "EACCES", "EBUSY"].includes(code)) {
      if (await lockAt(lock)) return null;
      // Windows can deny the rename while another process has a handle open on the draft.
      if (process.platform === "win32" && Date.now() < deadline) return null;
    }
    throw error;
  }
}
/** @template T @param {string} projectPath @param {"review" | "export" | "source" | "operation"} lane @param {() => Promise<T>} run
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options] @returns {Promise<T>} */
export async function withProjectShareLock(
  projectPath,
  lane,
  run,
  { timeoutMs = 30_000, signal } = {},
) {
  const root = await realpath(projectPath);
  const folder = await mkdirInside(root, ".hyperframes");
  const lock = join(
    folder,
    lane === "operation"
      ? "share-operation.lock"
      : lane === "review"
        ? "review.lock"
        : lane === "source"
          ? "share-source.lock"
          : "review-export.lock",
  );
  const owner = { token: randomUUID(), pid: process.pid, hostname: hostname() };
  const draft = `${lock}.${owner.token}.tmp`;
  const marker = `${owner.token}.json`;
  await mkdir(draft, { mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let held = null;
  try {
    await writeFile(join(draft, marker), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    while (!held) {
      signal?.throwIfAborted();
      held = await claim(draft, marker, lock, deadline);
      if (held) break;
      await reap(lock);
      if (Date.now() >= deadline) throw new ShareBusyError(lock);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    signal?.throwIfAborted();
    return await run();
  } finally {
    try {
      if (held === "directory") await releaseDirectory(lock, marker);
      if (held === "file" && (await ownerAt(lock))?.token === owner.token) await unlink(lock);
    } finally {
      await releaseDirectory(draft, marker);
    }
  }
}
