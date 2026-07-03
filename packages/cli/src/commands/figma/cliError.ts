/**
 * Shared CLI error boundary for `hyperframes figma` subcommands: typed
 * client errors (NO_TOKEN, BAD_TOKEN, …) already carry actionable,
 * user-facing guidance — print the message, not a stack trace.
 */

import { FigmaClientError } from "@hyperframes/core/figma";

export async function withFigmaErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof FigmaClientError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
