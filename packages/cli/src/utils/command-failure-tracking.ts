import type { CommandDef } from "citty";
import { assertKnownFlags } from "./reject-unknown-flags.js";

// citty types subcommands as `CommandDef<any>` (SubCommandsDef); mirror that so
// each command's specific args type is accepted without per-command generics.
type AnyCommandDef = CommandDef<any>;

/**
 * Wrap a lazy command loader so a thrown failure is reported via `onFailure`
 * before it propagates. citty's `runMain` catches command errors and exits 1
 * without re-throwing, so this is the only place to capture the reason. The
 * error is re-thrown unchanged, preserving citty's print + exit-1 behavior.
 *
 * `onFailure` is awaited so it can resolve the (lazily-loaded) telemetry module
 * before the error propagates — otherwise a command that throws before the
 * telemetry import settles would lose its event. A throw from `onFailure` is
 * swallowed so telemetry can never mask the real command failure.
 *
 * Commands that call `process.exit()` themselves bypass this (the process is
 * already gone) and must report their failure inline.
 */
export function trackCommandFailures(
  load: () => Promise<AnyCommandDef>,
  onFailure: (err: unknown) => void | Promise<void>,
): () => Promise<AnyCommandDef> {
  return () => load().then((cmd) => wrapCommand(cmd, onFailure));
}

/**
 * Wrap a resolved command's `run` (assert-flags + report-failure) AND
 * recursively wrap every entry in its `subCommands`. Two HF#2033 fixes live
 * here:
 *   1. `assertKnownFlags` runs INSIDE the try, so an unknown-flag throw is
 *      routed through `onFailure` (telemetry) like any other failure — it
 *      used to throw before the try and lose the event entirely.
 *   2. Recursion covers nested command groups (`cloud/*`, `auth/*`, `figma/*`,
 *      `lambda/*`, `capture/*`, `skills`). cli.ts only wraps the top-level
 *      loaders, so before this a `hyperframes cloud render --badflag` silently
 *      ignored the flag and reported nothing — citty dispatches to the leaf,
 *      whose `run` was never wrapped.
 */
function wrapCommand(
  cmd: AnyCommandDef,
  onFailure: (err: unknown) => void | Promise<void>,
): AnyCommandDef {
  const run = cmd.run;
  // Nothing to wrap (no run, no nested subcommands) — preserve identity.
  if (typeof run !== "function" && !cmd.subCommands) return cmd;

  const wrapped: AnyCommandDef = { ...cmd };
  if (typeof run === "function") {
    wrapped.run = async (ctx: Parameters<typeof run>[0]) => {
      try {
        // Reject unknown flags before the command body: citty silently ignores
        // them otherwise, dropping the value (e.g. `render --out x` fell back to
        // the default output path). Inside the try so the rejection is reported.
        assertKnownFlags(cmd, ctx?.rawArgs ?? []);
        return await run(ctx);
      } catch (err) {
        try {
          await onFailure(err);
        } catch {
          // Telemetry must never mask the real command failure.
        }
        throw err;
      }
    };
  }
  if (cmd.subCommands) {
    const wrappedSubs: Record<string, () => Promise<AnyCommandDef>> = {};
    for (const [name, sub] of Object.entries(cmd.subCommands)) {
      // citty subCommands are Resolvable<CommandDef>: a def, a promise, or a
      // (possibly async) loader. Normalize to a loader that resolves then wraps.
      wrappedSubs[name] = () =>
        Promise.resolve(typeof sub === "function" ? (sub as () => unknown)() : sub).then((c) =>
          wrapCommand(c as AnyCommandDef, onFailure),
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
