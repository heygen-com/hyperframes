import { fileURLToPath } from "node:url";

type ProcessRead = "identity" | "parent" | "table" | "version";

/** powershell.exe's arguments for one read of the shipped processes.ps1 (beside this code in src, and in dist).
 * Only a file runs, with plain arguments: antivirus reads a -Command text on the command line as a script. */
export function processReadArgs(read: ProcessRead, target?: string | number): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    fileURLToPath(new URL("./processes.ps1", import.meta.url)),
    read,
    ...(target === undefined ? [] : [String(target)]),
  ];
}
