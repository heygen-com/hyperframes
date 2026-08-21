import type { CommandDef } from "citty";
import { assertKnownFlags } from "./reject-unknown-flags.js";

// citty types subcommands as `CommandDef<any>` (SubCommandsDef); mirror that so
// each command's specific args type is accepted without per-command generics.
type AnyCommandDef = CommandDef<any>;

/**
 * Wrap a lazy command loader so leaf commands and nested subcommands share the
 * unknown-flag guard. Errors propagate unchanged to the executable boundary,
 * which is the sole command-failure telemetry reporter.
 */
export function trackCommandFailures(
  load: () => Promise<AnyCommandDef>,
): () => Promise<AnyCommandDef> {
  return () => load().then((cmd) => wrapCommand(cmd));
}

/**
 * Wrap a resolved command's `run` (assert-flags) AND
 * recursively wrap every entry in its `subCommands`. Two HF#2033 fixes live
 * here:
 *   1. `assertKnownFlags` runs in the wrapped command, so an unknown-flag
 *      throw reaches the executable boundary like every other failure.
 *   2. Recursion covers nested command groups (`cloud/*`, `auth/*`, `figma/*`,
 *      `lambda/*`, `capture/*`, `skills`). Without it, a nested command's
 *      unknown flags would bypass the leaf's guard.
 */
function wrapCommand(cmd: AnyCommandDef): AnyCommandDef {
  const run = cmd.run;
  // Nothing to wrap (no run, no nested subcommands) — preserve identity.
  if (typeof run !== "function" && !cmd.subCommands) return cmd;

  const wrapped: AnyCommandDef = { ...cmd };
  if (typeof run === "function") {
    wrapped.run = async (ctx: Parameters<typeof run>[0]) => {
      // Reject unknown flags before the command body: citty silently ignores
      // them otherwise, dropping the value (e.g. `render --out x` fell back to
      // the default output path).
      //
      // A command group (subCommands + fallback-help run) delegating to a
      // subcommand must NOT assert here: the flags belong to the subcommand's
      // table, not the group's, and would be falsely rejected (e.g.
      // `figma component <ref> --name x`). The wrapped subcommand loaders
      // below assert the leaf's own table, so typo protection is preserved.
      // Heuristic caveat: "first non-dash token names a subcommand" is sound
      // only while command groups declare no flags of their own — if a group
      // grows a flag whose value could match a subcommand name, replace this
      // with a real argv parse.
      const rawArgs = ctx?.rawArgs ?? [];
      const firstPositional = rawArgs.find((tok) => tok && !tok.startsWith("-"));
      const delegatesToSub =
        cmd.subCommands != null &&
        firstPositional != null &&
        Object.prototype.hasOwnProperty.call(cmd.subCommands, firstPositional);
      if (!delegatesToSub) assertKnownFlags(cmd, rawArgs);
      return await run(ctx);
    };
  }
  if (cmd.subCommands) {
    const wrappedSubs: Record<string, () => Promise<AnyCommandDef>> = {};
    for (const [name, sub] of Object.entries(cmd.subCommands)) {
      // citty subCommands are Resolvable<CommandDef>: a def, a promise, or a
      // (possibly async) loader. Normalize to a loader that resolves then wraps.
      wrappedSubs[name] = () =>
        Promise.resolve(typeof sub === "function" ? (sub as () => unknown)() : sub).then((c) =>
          wrapCommand(c as AnyCommandDef),
        );
    }
    wrapped.subCommands = wrappedSubs;
  }
  return wrapped;
}

/**
 * Report a command failure to telemetry, loading the telemetry module on demand
 * (keeps it off the CLI cold-start path) and awaiting it so the event is
 * enqueued before the caller re-throws / exits. Best-effort — never throws.
 */
export async function reportCommandFailure(command: string, err: unknown): Promise<void> {
  try {
    const { trackCommandFailure } = await import("../telemetry/events.js");
    trackCommandFailure(command, err);
  } catch {
    // ignore: a telemetry failure must not affect the command's exit path
  }
}
