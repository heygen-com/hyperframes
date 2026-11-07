// @ts-check
import fs, { open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { errorCode, mkdirInside } from "./storage.mjs";

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
/** @param {string} path @returns {Promise<Owner | null>} */
async function ownerAt(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return typeof value.token === "string" &&
      /^[a-f0-9-]{36}$/.test(value.token) &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.hostname === "string"
      ? value
      : null;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || error instanceof SyntaxError) return null;
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
/** A claim scoped to the old owner prevents two stale readers deleting a replacement lock. @param {string} path */
async function reap(path) {
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
/** @param {string} candidate @param {string} lock @param {Owner} owner */
async function claim(candidate, lock, owner) {
  try {
    await fs.link(candidate, lock);
  } catch (error) {
    if (
      !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EINVAL", "EISDIR"].includes(
        String(errorCode(error)),
      )
    )
      throw error;
    const handle = await open(lock, "wx", 0o600);
    let written = false;
    try {
      await handle.writeFile(JSON.stringify(owner));
      written = true;
    } finally {
      await handle.close();
      if (!written) await unlink(lock);
    }
  }
}
/** @template T @param {string} projectPath @param {"review" | "export" | "source"} lane @param {() => Promise<T>} run
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
    lane === "review"
      ? "review.lock"
      : lane === "source"
        ? "share-source.lock"
        : "review-export.lock",
  );
  const owner = { token: randomUUID(), pid: process.pid, hostname: hostname() };
  const candidate = `${lock}.${owner.token}.tmp`;
  await writeFile(candidate, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  const deadline = Date.now() + timeoutMs;
  let held = false;
  try {
    while (!held) {
      signal?.throwIfAborted();
      held = await claim(candidate, lock, owner).then(
        () => true,
        (error) => {
          if (errorCode(error) === "EEXIST") return false;
          throw error;
        },
      );
      if (held) break;
      await reap(lock);
      if (Date.now() >= deadline) throw new ShareBusyError(lock);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    signal?.throwIfAborted();
    return await run();
  } finally {
    if (held && (await ownerAt(lock))?.token === owner.token) await unlink(lock);
    await unlink(candidate);
  }
}
