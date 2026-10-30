import { statSync } from "node:fs";
import { resolve } from "node:path";

/** Index of the root command word (first non-flag before `--`), or -1; the root has no value-taking options. */
export function commandWordIndex(argv: readonly string[]): number {
  const end = argv.indexOf("--");
  const index = argv.findIndex((arg) => !arg.startsWith("-"));
  return end >= 0 && index >= end ? -1 : index;
}

/** `hyperframes <dir>` is `hyperframes open <dir>`; a known command wins over a folder of the same name. */
export function openShortcutArgv(
  argv: readonly string[],
  commands: ReadonlySet<string>,
  cwd: string = process.cwd(),
): readonly string[] {
  const at = commandWordIndex(argv);
  if (at < 0 || commands.has(argv[at]!)) return argv;
  try {
    if (!statSync(resolve(cwd, argv[at]!)).isDirectory()) return argv;
  } catch {
    return argv;
  }
  return [...argv.slice(0, at), "open", ...argv.slice(at)];
}
