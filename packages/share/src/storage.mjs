// @ts-check
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename as renameFile,
  rm as remove,
} from "node:fs/promises";
import { join, sep } from "node:path";
import { randomUUID } from "node:crypto";

/** @param {unknown} error */
export const errorCode = (error) =>
  error instanceof Error && "code" in error ? error.code : undefined;

/** @template T @param {() => Promise<T>} run */
async function retryBusy(run) {
  const waits = [10, 25, 50, 100, 200];
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const delay = waits[attempt];
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(String(errorCode(error))) ||
        delay === undefined
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
/** @param {string} from @param {string} to */
export const rename = (from, to) => retryBusy(() => renameFile(from, to));
/** @param {string} path @param {import("node:fs").RmOptions} [options] */
export const rm = (path, options) => retryBusy(() => remove(path, options));

/** Make metadata folders without recreating a project that was moved or removed. @param {string} root @param {string} rel */
export async function mkdirInside(root, rel) {
  let dir = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    if (part === ".." || part === ".") throw new Error("Invalid metadata directory.");
    dir = join(dir, part);
    await mkdir(dir).catch((error) => {
      if (errorCode(error) !== "EEXIST") throw error;
    });
    if (!(await lstat(dir)).isDirectory())
      throw new Error("The destination must be a real folder, not a link.");
  }
  return dir;
}
/** @type {Map<string, Promise<void>>} */
const queued = new Map();
/** @param {string} path @param {unknown} data */
export function writeJsonAtomic(path, data) {
  const text = JSON.stringify(data, null, 2);
  const save = (queued.get(path) ?? Promise.resolve()).then(async () => {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, text, { mode: 0o600 });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  });
  const settled = save.catch(() => {});
  queued.set(path, settled);
  void settled.then(() => queued.get(path) === settled && queued.delete(path));
  return save;
}
/** @template T @param {string} path @param {T} fallback @returns {Promise<Record<string, unknown> | Exclude<T, object>>} */
export async function readJsonOr(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return /** @type {Record<string, unknown> | Exclude<T, object>} */ (fallback);
  }
}
