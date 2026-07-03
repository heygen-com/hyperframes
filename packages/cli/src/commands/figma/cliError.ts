/**
 * Shared CLI error boundary for `hyperframes figma` subcommands: typed
 * client errors (NO_TOKEN, BAD_TOKEN, …) and input errors (bad ref, bad
 * format) all carry actionable, user-facing messages — print the message,
 * not a stack trace. Non-Error throws still surface raw.
 */

export async function withFigmaErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
