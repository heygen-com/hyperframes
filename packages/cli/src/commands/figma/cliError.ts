import { failCommand } from "../../utils/commandResult.js";
/**
 * Shared CLI error boundary for `hyperframes figma` subcommands: typed
 * client errors (NO_TOKEN, BAD_TOKEN, …) and input errors (bad ref, bad
 * format) all carry actionable, user-facing messages — present them via
 * the CLI's standard errorBox, not a stack trace. Non-Error throws still
 * surface raw.
 *
 * It reports inline to name the typed code (FigmaClientError code) — the whole
 * first-run funnel: NO_TOKEN → later success is onboarding conversion.
 */

import { FigmaClientError } from "@hyperframes/core/figma";
import { errorBox } from "../../ui/format.js";

export async function withFigmaErrors(command: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error) {
      try {
        const { trackCommandFailure } = await import("../../telemetry/events.js");
        // Surface the typed code (NO_TOKEN, BAD_TOKEN, RATE_LIMITED, …) as the
        // error name — `FigmaClientError` alone says nothing in a dashboard.
        trackCommandFailure(
          command,
          err,
          err instanceof FigmaClientError ? { error_name: err.code, endpoint: err.endpoint } : {},
        );
      } catch {
        // Telemetry must never mask the real command failure.
      }
      const [title = "figma command failed", ...rest] = err.message.split("\n");
      errorBox(title, rest.length > 0 ? rest.join("\n") : undefined);
      failCommand(1, err);
    }
    throw err;
  }
}
