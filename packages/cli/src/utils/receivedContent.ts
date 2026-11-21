import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, type Stats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { extname, join } from "node:path";
import { readRecordTail, recordKind, writeRecord } from "./projectRecords.js";

/**
 * The sha256s of received content that left a listed path, kept beside the project's received-files record in the
 * file and format the desktop app keeps. A file holding the same bytes counts as received. Keys this module does
 * not use are written back as they were read.
 */
const RECEIVED_CONTENT = "received-content.json";
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const receivedContentFile = (dir: string): string =>
  join(dir, ".hyperframes", RECEIVED_CONTENT);

export interface ReceivedContent {
  hashes: Set<string>;
  saved: Record<string, unknown>;
  readable: boolean;
}

/** The received content beside the record in `dir`; empty when it is missing. One that cannot be read is never written over. */
export function readReceivedContent(dir: string): ReceivedContent {
  const empty = (readable: boolean) => ({ hashes: new Set<string>(), saved: {}, readable });
  const read = readRecordTail(dir, RECEIVED_CONTENT, MAX_CONTENT_BYTES);
  if (read === null) return empty(recordKind(dir, RECEIVED_CONTENT) === "absent");
  let saved: unknown;
  try {
    saved = read?.whole ? JSON.parse(read.text) : null;
  } catch {
    saved = null;
  }
  if (!isObject(saved)) return empty(false);
  const listed = Array.isArray(saved.hashes) ? saved.hashes : [];
  const hashes = listed.filter(
    (hash): hash is string => typeof hash === "string" && SHA256.test(hash),
  );
  return { hashes: new Set(hashes), saved, readable: true };
}

export function writeReceivedContent(dir: string, content: ReceivedContent): boolean {
  if (!content.readable) return false;
  const json = { ...content.saved, hashes: [...content.hashes].sort() };
  return writeRecord(dir, RECEIVED_CONTENT, `${JSON.stringify(json)}\n`);
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const MAX_HASHED_BYTES = 16 * 1024 * 1024;
const READ_PLAIN = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Pages, stylesheets, scripts and SVG of any size, and other plain files up to 16 MB, as `stat` reads them. */
export const hashable = (path: string, stat: Stats) =>
  stat.isFile() && (stat.size <= MAX_HASHED_BYTES || isCodeFile(path));

/** The sha256 of a plain file's bytes; null for a link, a folder, a large file that names no others, or one that cannot be read. */
export function contentHash(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, READ_PLAIN);
  } catch {
    return null;
  }
  try {
    return hashable(path, fstatSync(fd)) ? sha256(readFileSync(fd)) : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export async function contentHashAsync(path: string): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, READ_PLAIN);
  } catch {
    return null;
  }
  try {
    return hashable(path, await handle.stat()) ? sha256(await handle.readFile()) : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

const CODE_FILE = new Set([".html", ".htm", ".xhtml", ".css", ".js", ".mjs", ".cjs", ".svg"]);

/** Pages, stylesheets, scripts and SVG: the files that can name other files for a render or upload to load. */
export const isCodeFile = (path: string): boolean => CODE_FILE.has(extname(path).toLowerCase());
