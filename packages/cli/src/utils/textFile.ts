import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";

/** True when `input` names an existing `.txt` file, which `tts` reads instead of speaking the path. */
export function isTextFile(input: string): boolean {
  const path = resolve(input);
  return existsSync(path) && extname(path).toLowerCase() === ".txt";
}
