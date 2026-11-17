import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { readRecordTail, recordKind, writeRecord } from "./projectRecords.js";

/**
 * The sha256s of received content that left a listed path, in the project's `.hyperframes/received-content.json`,
 * the file and format the desktop app keeps. A file holding the same bytes counts as received. Keys this module does
 * not use are written back as they were read.
 */
const RECEIVED_CONTENT = "received-content.json";
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export interface ReceivedContent {
  hashes: Set<string>;
  saved: Record<string, unknown>;
  readable: boolean;
}

/** The received content beside the record in `dir`; empty when it is missing. One that cannot be read is never written over. */
export function readReceivedContent(dir: string): ReceivedContent {
  const empty = (readable: boolean) => ({ hashes: new Set<string>(), saved: {}, readable });
  if (recordKind(dir, RECEIVED_CONTENT) === "absent") return empty(true);
  const read = readRecordTail(dir, RECEIVED_CONTENT, MAX_CONTENT_BYTES);
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

/** The sha256 of a plain file's bytes; null for a link, a folder or a file that cannot be read. */
export function contentHash(path: string): string | null {
  try {
    return lstatSync(path).isFile() ? sha256(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

export async function contentHashAsync(path: string): Promise<string | null> {
  try {
    return lstatSync(path).isFile() ? sha256(await readFile(path)) : null;
  } catch {
    return null;
  }
}

const CODE_FILE = new Set([".html", ".htm", ".xhtml", ".css", ".js", ".mjs", ".cjs", ".svg"]);

/** Pages, stylesheets, scripts and SVG: the files that can name other files for a render or upload to load. */
export const isCodeFile = (path: string): boolean => CODE_FILE.has(extname(path).toLowerCase());
