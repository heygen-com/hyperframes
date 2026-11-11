/** A JSON flag: inline JSON, `-` for stdin or a file path; PowerShell drops inline quotes sent to a `.cmd`. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface JsonFlagIO {
  readFile: (path: string) => string;
  readStdin: () => string;
}

// PowerShell 5.1 writes redirected files as UTF-16LE with a BOM and pipes UTF-8 with one.
function decodeJsonText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

const defaultIO: JsonFlagIO = {
  readFile: (path) => decodeJsonText(readFileSync(resolve(path))),
  readStdin: () => decodeJsonText(readFileSync(0)),
};

export const readJsonFileText = (path: string): string => defaultIO.readFile(path);
export const readJsonStdinText = (): string => defaultIO.readStdin();

export class JsonFlagReadError extends Error {
  constructor(
    readonly path: string,
    readonly cause: string,
  ) {
    super(`${path}: ${cause}`);
  }
}

function isJsonScalar(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function readJsonFlagText(value: string, partialIo: Partial<JsonFlagIO> = {}): string {
  const io: JsonFlagIO = {
    readFile: partialIo.readFile ?? defaultIO.readFile,
    readStdin: partialIo.readStdin ?? defaultIO.readStdin,
  };
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || isJsonScalar(trimmed)) return value;
  const source = trimmed === "-" ? "stdin" : value;
  try {
    if (trimmed !== "-") return io.readFile(value);
    const piped = io.readStdin();
    if (!piped.trim()) throw new Error("nothing was piped in");
    return piped;
  } catch (error: unknown) {
    throw new JsonFlagReadError(source, errorText(error));
  }
}

export const inlineJsonHint = (flag: string) =>
  `PowerShell strips the quotes from inline JSON; pass a file (${flag} payload.json) or pipe it (${flag} -)`;

export const unreadableJsonHint = (flag: string, value: string) =>
  value.includes(":") && !/^\s*[A-Za-z]:[\\/]/.test(value) ? ` (${inlineJsonHint(flag)})` : "";

/** The parsed value of a JSON flag; an Error names the flag and, for inline JSON, the Windows fix. */
export function readJsonFlag(flag: string, value: string, io?: Partial<JsonFlagIO>): unknown {
  let text: string;
  try {
    text = readJsonFlagText(value, io);
  } catch (error: unknown) {
    if (!(error instanceof JsonFlagReadError)) throw error;
    throw new Error(`Could not read ${flag}: ${error.message}${unreadableJsonHint(flag, value)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const hint = /^\s*[{[]/.test(text) ? ` (${inlineJsonHint(flag)})` : "";
    throw new Error(`Could not parse ${flag} JSON: ${errorText(error)}${hint}`);
  }
}
