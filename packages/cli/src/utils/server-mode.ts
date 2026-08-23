/**
 * Marks the process as hosting a long-running server rather than running a
 * one-shot command.
 *
 * The CLI's process-wide `uncaughtException` handler exits the process. For
 * `render` that is correct: the command is over anyway, and the exit code is
 * the result. For `preview`, which hosts Studio, it means any uncaught error
 * anywhere in the process tears the server down, dropping every open SSE
 * connection at once. Studio then reports that to every connected client as
 * "Connection lost. Is the render server running?", blaming the user's setup
 * for a crash inside our own process.
 *
 * A one-shot command exiting on an uncaught exception loses nothing. A server
 * doing it loses every concurrent job and every connected client, so in server
 * mode the handler reports the error and leaves the process running.
 */

let serverMode = false;

/**
 * Called by the preview command once it commits to a long-running mode, before
 * the server starts accepting connections.
 */
export function markServerMode(): void {
  serverMode = true;
}

/**
 * Read by the cli.ts process handlers to decide whether an uncaught error
 * should be fatal.
 */
export function isServerMode(): boolean {
  return serverMode;
}

/** Test-only reset. Not exported from the package. */
export function _resetServerModeForTests(): void {
  serverMode = false;
}
