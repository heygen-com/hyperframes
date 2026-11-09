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

/**
 * `hyperframes measure <video>` with no op is `hyperframes measure probe <video>`, the first look every
 * rebuild starts with. Only a bare file (or `--json`) is rewritten: with other flags the op is a guess,
 * so the unknown-command hint asks for one instead.
 */
export function measureProbeShortcutArgv(
  argv: readonly string[],
  ops: ReadonlySet<string>,
  cwd: string = process.cwd(),
): readonly string[] {
  const at = commandWordIndex(argv);
  if (at < 0 || argv[at] !== "measure") return argv;
  const file = argv[at + 1];
  if (file === undefined || file.startsWith("-") || ops.has(file)) return argv;
  if (!argv.slice(at + 2).every((arg) => arg === "--json")) return argv;
  try {
    if (!statSync(resolve(cwd, file)).isFile()) return argv;
  } catch {
    return argv;
  }
  return [...argv.slice(0, at + 1), "probe", ...argv.slice(at + 1)];
}
