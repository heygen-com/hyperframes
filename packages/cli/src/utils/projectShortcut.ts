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

export function registryAliasArgv(argv: readonly string[]): readonly string[] {
  const at = commandWordIndex(argv);
  if (at < 0 || argv[at] !== "registry") return argv;
  const words = argv[at + 1] === "search" ? at + 2 : at + 1;
  return [...argv.slice(0, at), "catalog", ...argv.slice(words)];
}

export function measureProbeShortcutArgv(
  argv: readonly string[],
  ops: ReadonlySet<string>,
  cwd: string = process.cwd(),
): readonly string[] {
  const at = commandWordIndex(argv);
  if (at < 0 || argv[at] !== "measure") return argv;
  const words = argv.slice(at + 1);
  if (words.length === 0 || ops.has(words[0]!)) return argv;
  for (let n = words.length; n > 0; n--) {
    const file = words.slice(0, n).join(" ");
    const rest = words.slice(n);
    if (words.slice(0, n).some((w) => w.startsWith("-"))) continue;
    if (!rest.every((arg) => arg === "--json")) continue;
    if (isFile(resolve(cwd, file))) return [...argv.slice(0, at + 1), "probe", file, ...rest];
  }
  return argv;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
