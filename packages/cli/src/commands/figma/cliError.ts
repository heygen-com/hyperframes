/**
 * Shared CLI error boundary for `hyperframes figma` subcommands: typed
 * client errors (NO_TOKEN, BAD_TOKEN, …) and input errors (bad ref, bad
 * format) all carry actionable, user-facing messages — present them via
 * the CLI's standard errorBox, not a stack trace. Non-Error throws still
 * surface raw.
 */

import { errorBox } from "../../ui/format.js";

export async function withFigmaErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error) {
      const [title = "figma command failed", ...rest] = err.message.split("\n");
      errorBox(title, rest.length > 0 ? rest.join("\n") : undefined);
      process.exit(1);
    }
    throw err;
  }
}
