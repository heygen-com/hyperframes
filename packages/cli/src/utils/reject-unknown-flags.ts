import type { ArgDef, ArgsDef, CommandDef } from "citty";
import { CliUsageError } from "./commandResult.js";
import { c } from "../ui/colors.js";

// citty is permissive: an unrecognized flag (e.g. `render --out x` when the flag
// is `--output`/`-o`) is silently ignored instead of rejected, so the value is
// dropped and the command falls back to its default — a silent wrong result. We
// reject unknown flags up front with a clear message.

// Global flags citty / the CLI understand on every command.
const ALWAYS_KNOWN = new Set(["help", "h", "version", "v", "json"]);

// A camelCase arg name (`gifLoop`) is passed as `--gif-loop`; a kebab name is
// passed as-is. Accept both spellings so the validator matches citty's parsing.
function nameVariants(name: string): string[] {
  const kebab = name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return [name, kebab, camel];
}

// Every spelling of one declared arg: name variants plus aliases. `def` may be undefined.
function* spellingsOf(name: string, def: ArgDef | undefined): Generator<string> {
  yield* nameVariants(name);
  const alias = def && "alias" in def ? def.alias : undefined;
  if (typeof alias === "string") yield alias;
  else if (Array.isArray(alias)) yield* alias;
}

function knownFlags(args: ArgsDef | undefined): Set<string> {
  const known = new Set(ALWAYS_KNOWN);
  for (const [name, def] of Object.entries(args ?? {})) {
    for (const s of spellingsOf(name, def)) known.add(s);
  }
  return known;
}

// The unknown flag a single token introduces, or null when it's fine
// (positional, flag value, `--`, or all-known). `--no-foo` -> `foo`,
// `--flag=value` -> `flag`; a combined short group (`-ab`) checks each char.
// `--flag`, `--flag=value`, `--no-flag` -> the bare flag name.
function longFlagName(tok: string): string {
  const name = tok.slice(2).split("=")[0] ?? "";
  return name.startsWith("no-") ? name.slice(3) : name;
}

function unknownFlagIn(tok: string, known: Set<string>): string | null {
  if (tok === "-" || !tok.startsWith("-")) return null; // positional or flag value
  if (tok.startsWith("--")) {
    const name = longFlagName(tok);
    return name && !known.has(name) ? `--${name}` : null;
  }
  for (const ch of tok.slice(1).split("=")[0] ?? "") {
    if (!known.has(ch)) return `-${ch}`; // combined shorts: check each char
  }
  return null;
}

/**
 * Throw on the first flag in `rawArgs` not declared by `cmd` (its args + aliases
 * + the global set). Only dash-prefixed tokens are inspected, so positionals and
 * flag values pass through untouched. Stops at `--`.
 */
export function assertKnownFlags(cmd: CommandDef<ArgsDef>, rawArgs: string[]): void {
  if (!Array.isArray(rawArgs)) return;
  // citty types `args` as Resolvable<ArgsDef> (it may be a fn/promise); every
  // hyperframes command uses a static object, so treat anything else as "no
  // declared args" and skip validation rather than risk a wrong rejection.
  const rawDef = cmd.args;
  const args = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const known = knownFlags(args);
  for (const tok of rawArgs) {
    if (tok === "--") break;
    const bad = unknownFlagIn(tok, known);
    if (bad) throw new Error(`Unknown flag: ${bad}`);
  }
}

// Spellings of a command's own string/enum args (the types citty lets swallow the next
// token), mapped to the canonical arg name. Args in `ignore` are left out.
function stringValueFlagOwners(
  args: ArgsDef | undefined,
  ignore: ReadonlySet<string> | undefined,
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [name, def] of Object.entries(args ?? {})) {
    if (def?.type !== "string" && def?.type !== "enum") continue;
    if (ignore?.has(name)) continue;
    for (const s of spellingsOf(name, def)) owners.set(s, name);
  }
  return owners;
}

// `--flag` -> "flag", `-f` -> "f"; null for `--flag=value` or a non-flag token.
function ownableFlagSpelling(tok: string): string | null {
  if (tok.includes("=")) return null;
  if (tok.startsWith("--")) return tok.slice(2);
  if (tok.length === 2 && tok.startsWith("-")) return tok.slice(1);
  return null;
}

// Keyed by command path. "rewrite": bare flag becomes `--flag=` (check's parseFrameCheck reads
// that as defaults). "ignore": the command recovers the swallowed value itself
// (upgrade's resolveProjectArgs).
const SWALLOW_REWRITE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  check: new Set(["frame-check"]),
};
const SWALLOW_IGNORE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  upgrade: new Set(["project"]),
};

function swallowedValueMessage(flagName: string, next: string, hint: string): string {
  if (next === "--")
    return `Missing value for --${flagName}: "--" ends option parsing here; ${hint}`;
  return `Missing value for --${flagName}: value "${next}" appears to have swallowed the next option; ${hint}`;
}

/** For a caller whose own try/catch prints the error (check.ts's run()). */
export function swallowedFlagUsageError(flagName: string, next: string): CliUsageError {
  const hint = `use --${flagName}= or move --${flagName} to the end`;
  return new CliUsageError(swallowedValueMessage(flagName, next, hint));
}

// Prints and marks `presented`: otherwise executeCli dumps usage to stdout, breaking `--json`.
function throwSwallowedFlagError(flagName: string, next: string): never {
  const hint = `pass one: --${flagName} <value> or --${flagName}=<value>`;
  const message = swallowedValueMessage(flagName, next, hint);
  console.error(c.error(message));
  throw new CliUsageError(message, { presented: true });
}

export interface SwallowGuardResult {
  rawArgs: string[];
  rewritten: boolean;
}

// End of argv, a bare `-` (stdin) and `--no-x` (citty never swallows it) are not a swallow.
function looksLikeSwallowedFlag(next: string | undefined, known: Set<string>): boolean {
  if (next === undefined || next === "-" || next.startsWith("--no-")) return false;
  return next === "--" || (next.startsWith("-") && unknownFlagIn(next, known) === null);
}

// The arg `tok` spells when citty would swallow `next` as its value, else undefined.
function swallowingArgName(
  tok: string,
  next: string | undefined,
  owners: Map<string, string>,
  known: Set<string>,
): string | undefined {
  const spelling = ownableFlagSpelling(tok);
  const ownerArgName = spelling ? owners.get(spelling) : undefined;
  return ownerArgName && looksLikeSwallowedFlag(next, known) ? ownerArgName : undefined;
}

// Reject a string/enum flag whose value citty swallowed from the next flag (`catalog --query --json`).
// Scans rawArgs: parsed args cannot tell `--query --json` from the legitimate `--query=--json`.
export function guardSwallowedFlagValues(
  // `CommandDef<any>`: citty's CommandContext is invariant in its args type.
  cmd: CommandDef<any> | undefined,
  path: string,
  rawArgs: string[],
): SwallowGuardResult {
  if (!Array.isArray(rawArgs)) return { rawArgs, rewritten: false };
  const rawDef = cmd?.args;
  const argsDef = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const known = knownFlags(argsDef);
  const owners = stringValueFlagOwners(argsDef, SWALLOW_IGNORE_FLAGS[path]);
  const rewriteFlags = SWALLOW_REWRITE_FLAGS[path];

  let out: string[] | undefined;
  for (const [i, tok] of rawArgs.entries()) {
    if (tok === "--") break;
    const next = rawArgs[i + 1];
    const ownerArgName = swallowingArgName(tok, next, owners, known);
    if (!ownerArgName) continue;
    if (!rewriteFlags?.has(ownerArgName)) throwSwallowedFlagError(ownerArgName, next as string);
    out ??= rawArgs.slice();
    out[i] = `${tok}=`;
  }
  return { rawArgs: out ?? rawArgs, rewritten: out !== undefined };
}
