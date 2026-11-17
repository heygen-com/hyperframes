import { fileURLToPath } from "node:url";

type ProcessRead = "identity" | "parent" | "table" | "version";

/** One read of processes.ps1, shipped beside this code; antivirus flags PowerShell given command text. */
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
