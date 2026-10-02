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

// Every spelling of one declared arg — its name variants plus any aliases.
// `def` is tolerated as undefined: this guard runs on every CLI invocation, so a
// malformed args entry must not turn a valid command into a crash.
function* spellingsOf(name: string, def: ArgDef | undefined): Generator<string> {
  yield* nameVariants(name);
  const alias = def && "alias" in def ? def.alias : undefined;
  if (typeof alias === "string") yield alias;
  else if (Array.isArray(alias)) yield* alias;
}

function addSpellings(into: Set<string>, name: string, def: ArgDef | undefined): void {
  for (const s of spellingsOf(name, def)) into.add(s);
}

function knownFlags(args: ArgsDef | undefined): Set<string> {
  const known = new Set(ALWAYS_KNOWN);
  for (const [name, def] of Object.entries(args ?? {})) addSpellings(known, name, def);
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

// Every declared spelling (name variants + aliases) of a command's OWN
// `type:"string"|"enum"` args, mapped back to the canonical arg name — the only
// arg types citty's parser lets a following raw token be "swallowed" into.
function stringValueFlagOwners(args: ArgsDef | undefined): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [name, def] of Object.entries(args ?? {})) {
    if (def?.type !== "string" && def?.type !== "enum") continue;
    for (const s of spellingsOf(name, def)) owners.set(s, name);
  }
  return owners;
}

// The bare flag spelling a token could own a following value under (`--flag` or
// `-f`), or null when the token already carries an inline `--flag=value` (never
// a swallow candidate — the value is unambiguous) or isn't flag-shaped at all.
function ownableFlagSpelling(tok: string): string | null {
  if (tok.includes("=")) return null;
  if (tok.startsWith("--")) return tok.slice(2);
  if (tok.length === 2 && tok.startsWith("-")) return tok.slice(1);
  return null;
}

// Per-command opt-out of the default throw, for a command's OWN declared
// string/enum flag that already has bespoke handling for its value being
// swallowed by the next flag:
//   - "rewrite": silently normalize the bare flag to `--flag=` instead of
//     rejecting. Only check's `--frame-check` needs this: its own grammar (see
//     check.ts's `parseFrameCheck`) already treats a bare flag as "use
//     defaults" and independently rejects ANY dash-prefixed value regardless
//     of where it came from, so assuming "no value" here can never mask a
//     real typo — a bogus follow-on token that isn't actually a flag still
//     fails, just via that grammar check instead.
//   - "ignore": leave rawArgs untouched and let the swallowed value reach the
//     command's own run() as-is. Only upgrade's `--project` needs this: it
//     already recovers a swallowed flag gracefully itself (see upgrade.ts's
//     `resolveProjectArgs`, which inspects the literal swallowed string and
//     falls back to the current directory while still honoring the flag it
//     ate) rather than treating it as an error.
const SWALLOW_REWRITE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  check: new Set(["frame-check"]),
};
const SWALLOW_IGNORE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  upgrade: new Set(["project"]),
};

// Keyed by `meta.name` — the only stable identifier citty exposes on a
// resolved leaf command, though it's only the leaf's own short name (e.g.
// "check" for both the top-level check command AND `skills check`), not a
// full "skills.check" path. Safe in practice because the flag name is also
// scoped to that specific command's own declared args (a coincidentally
// same-named sibling command would need to ALSO declare the exact same flag
// name to collide) — but keep this in mind before adding a policy entry for a
// command name shared across the CLI's command tree.
function commandName(cmd: CommandDef<any> | undefined): string | undefined {
  const meta = cmd?.meta;
  if (!meta || typeof meta !== "object" || !("name" in meta)) return undefined;
  return typeof meta.name === "string" ? meta.name : undefined;
}

function swallowedValueMessage(flagName: string, next: string): string {
  const hint = `use --${flagName}= or move --${flagName} to the end`;
  if (next === "--")
    return `Missing value for --${flagName}: "--" ends option parsing here; ${hint}`;
  return `Missing value for --${flagName}: value "${next}" appears to have swallowed the next option; ${hint}`;
}

// A plain `CliUsageError` for a swallowed flag value, with no side effects —
// for a caller whose OWN try/catch already prints and presents every error it
// catches uniformly (e.g. check.ts's `run()`), so a second print here would
// double it up. The caller throws this itself.
export function swallowedFlagUsageError(flagName: string, next: string): CliUsageError {
  return new CliUsageError(swallowedValueMessage(flagName, next));
}

// For a caller with no try/catch of its own between here and `executeCli`
// (cli.ts) — e.g. `guardSwallowedFlagValues` below, thrown from inside
// `wrapCommand` before a command's own `run()` (and its try/catch, if any)
// ever starts. Prints the message here and marks the error `presented`,
// because `executeCli` dumps full command usage to stdout for any
// `CliUsageError` that isn't `presented` — noise on top of this already-
// specific message, and stdout pollution for a `--json` caller. Mirrors the
// print-then-`failUsage()` pair used elsewhere (e.g. renderArgs.ts), except
// the specific message stays on the error for failure reporting.
function throwSwallowedFlagError(flagName: string, next: string): never {
  const message = swallowedValueMessage(flagName, next);
  console.error(c.error(message));
  throw new CliUsageError(message, { presented: true });
}

export interface SwallowGuardResult {
  rawArgs: string[];
  rewritten: boolean;
}

// True end of argv (`next === undefined`) is never a swallow: citty coerces a
// trailing bare string flag to "" on its own. A bare `-` (the stdin
// convention) is never a flag either. Otherwise: `--` ends option parsing
// with nothing real following, or `next` is itself a recognized flag spelling
// — both mean the flag before it has no value of its own.
function looksLikeSwallowedFlag(next: string | undefined, known: Set<string>): boolean {
  if (next === undefined || next === "-") return false;
  return next === "--" || (next.startsWith("-") && unknownFlagIn(next, known) === null);
}

interface SwallowPolicy {
  known: Set<string>;
  owners: Map<string, string>;
  rewriteFlags: ReadonlySet<string> | undefined;
  ignoreFlags: ReadonlySet<string> | undefined;
}

function resolveSwallowPolicy(cmd: CommandDef<any> | undefined): SwallowPolicy {
  const rawDef = cmd?.args;
  const argsDef = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const name = commandName(cmd) ?? "";
  return {
    known: knownFlags(argsDef),
    owners: stringValueFlagOwners(argsDef),
    rewriteFlags: SWALLOW_REWRITE_FLAGS[name],
    ignoreFlags: SWALLOW_IGNORE_FLAGS[name],
  };
}

/**
 * The single mechanism for "a `type:'string'|'enum'` flag's value is missing,
 * so citty's parser (`node:util.parseArgs`, `strict: false`) swallowed the next
 * raw token as that flag's literal value" — e.g. `catalog --query --json`
 * parses to `query: "--json"`, `json` never set, so a `--json`-mode caller
 * silently gets human-readable output instead of an error.
 *
 * Operates on `rawArgs`, not the already-parsed `args` (by the time any command
 * body runs, `args` already reflects the wrong parse) — this is also the only
 * way to accept `--query=--json` (an explicit, always-legitimate inline value)
 * while still rejecting `--query --json` (a swallow): `node:util.parseArgs`
 * produces an identical parsed object for both, so only a raw-args scan sees
 * the difference (a literal `=` in the token).
 *
 * Default: throw `CliUsageError`. Two opt-outs, per command+flag (see the
 * policy maps above): `SWALLOW_REWRITE_FLAGS` silently rewrites the bare flag
 * to `--flag=` instead of rejecting; `SWALLOW_IGNORE_FLAGS` leaves rawArgs
 * untouched entirely, for a flag whose command already recovers the swallowed
 * value itself.
 */
export function guardSwallowedFlagValues(
  // `CommandDef<any>`, not `<ArgsDef>`: citty's `CommandContext` is invariant in
  // its args type (via `setup`), so a caller's own concretely-typed `cmd`
  // doesn't structurally satisfy `CommandDef<ArgsDef>` — mirrors `AnyCommandDef`
  // in command-failure-tracking.ts, which hits the same variance issue.
  cmd: CommandDef<any> | undefined,
  rawArgs: string[],
): SwallowGuardResult {
  if (!Array.isArray(rawArgs)) return { rawArgs, rewritten: false };
  const { known, owners, rewriteFlags, ignoreFlags } = resolveSwallowPolicy(cmd);

  let out: string[] | undefined;
  for (const [i, tok] of rawArgs.entries()) {
    if (tok === "--") break;
    const spelling = ownableFlagSpelling(tok);
    const ownerArgName = spelling ? owners.get(spelling) : undefined;
    if (!ownerArgName || ignoreFlags?.has(ownerArgName)) continue;
    const next = rawArgs[i + 1];
    if (!looksLikeSwallowedFlag(next, known)) continue;

    if (rewriteFlags?.has(ownerArgName)) {
      out ??= rawArgs.slice();
      out[i] = `${tok}=`;
      continue;
    }
    // `looksLikeSwallowedFlag` only returns true when `next` is defined.
    throwSwallowedFlagError(ownerArgName, next as string);
  }
  return { rawArgs: out ?? rawArgs, rewritten: out !== undefined };
}
