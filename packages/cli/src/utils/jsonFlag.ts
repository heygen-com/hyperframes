/** A JSON flag: inline JSON, `-` for stdin or a file path; PowerShell drops inline quotes sent to a `.cmd`. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface JsonFlagIO {
  readFile: (path: string) => string;
  readStdin: () => string;
}

// PowerShell 5.1 writes redirected files as UTF-16LE with a BOM and pipes UTF-8 with one.
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

const defaultIO: JsonFlagIO = {
  readFile: (path) => decode(readFileSync(resolve(path))),
  readStdin: () => decode(readFileSync(0)),
};

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
    return trimmed === "-" ? io.readStdin() : io.readFile(value);
  } catch (error: unknown) {
    throw new JsonFlagReadError(source, errorText(error));
  }
}

export const inlineJsonHint = (flag: string) =>
  `PowerShell strips the quotes from inline JSON; pass a file (${flag} payload.json) or pipe it (${flag} -)`;

/** The parsed value of a JSON flag; an Error names the flag and, for inline JSON, the Windows fix. */
export function readJsonFlag(flag: string, value: string, io?: Partial<JsonFlagIO>): unknown {
  let text: string;
  try {
    text = readJsonFlagText(value, io);
  } catch (error: unknown) {
    if (!(error instanceof JsonFlagReadError)) throw error;
    throw new Error(`Could not read ${flag}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const hint = /^\s*[{[]/.test(text) ? ` (${inlineJsonHint(flag)})` : "";
    throw new Error(`Could not parse ${flag} JSON: ${errorText(error)}${hint}`);
  }
}
