import type { CommandDef } from "citty";

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
  return () =>
    load().then((cmd) => {
      const run = cmd.run;
      if (typeof run !== "function") return cmd;
      return {
        ...cmd,
        run: async (ctx: Parameters<typeof run>[0]) => {
          try {
            return await run(ctx);
          } catch (err) {
            try {
              await onFailure(err);
            } catch {
              // Telemetry must never mask the real command failure.
            }
            throw err;
          }
        },
      };
    });
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
