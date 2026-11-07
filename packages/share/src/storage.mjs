// @ts-check
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename as renameFile,
  rm as remove,
} from "node:fs/promises";
import { basename, join, sep } from "node:path";
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

/** Create metadata folders only inside an existing project. @param {string} root @param {string} rel */
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
export class SharingStateError extends Error {
  /** @param {string} path @param {unknown} [cause] */
  constructor(path, cause) {
    super(
      `Sharing state in .hyperframes/${basename(path)} could not be read. Restore this file from a backup, or contact support to reconnect the existing share. Keep the file; deleting it can lose recovery state or create a duplicate share.`,
      { cause },
    );
    this.name = "SharingStateError";
  }
}

/** @template T @param {string} path @param {T} fallback @returns {Promise<Record<string, unknown> | Exclude<T, object>>} */
export async function readJsonOr(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw new SharingStateError(path, error);
    return /** @type {Record<string, unknown> | Exclude<T, object>} */ (fallback);
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const isJsonObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value @returns {value is string} */
export const isSavedId = (value) => typeof value === "string" && value.trim() !== "";

/** @param {unknown} value @returns {value is string | null} */
export const isNullableSavedId = (value) => value === null || isSavedId(value);

/** @param {unknown} value @returns {value is string | null | undefined} */
export const isOptionalSavedId = (value) => value === undefined || isNullableSavedId(value);

/** @param {unknown} value @returns {value is boolean | undefined} */
export const isOptionalBoolean = (value) => value === undefined || typeof value === "boolean";

/** An absent file is the only source of an empty record. @param {string} path */
export async function readJsonRecord(path) {
  const value = await readJsonOr(path, undefined);
  if (value === undefined) return null;
  if (!isJsonObject(value)) throw new SharingStateError(path);
  return value;
}
