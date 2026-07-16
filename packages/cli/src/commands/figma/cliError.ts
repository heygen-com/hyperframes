/**
 * Shared CLI error boundary for `hyperframes figma` subcommands: typed
 * client errors (NO_TOKEN, BAD_TOKEN, …) and input errors (bad ref, bad
 * format) all carry actionable, user-facing messages — present them via
 * the CLI's standard errorBox, not a stack trace. Non-Error throws still
 * surface raw.
 *
 * Because this exits the process itself, it must ALSO report the failure
 * inline (the top-level trackCommandFailures wrapper never sees it) — the
 * typed error name (FigmaClientError code) is the whole first-run funnel:
 * NO_TOKEN → later success is onboarding conversion.
 */

import { FigmaClientError } from "@hyperframes/core/figma";
import { errorBox } from "../../ui/format.js";

export async function withFigmaErrors(command: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error) {
      try {
        const telemetry = await import("../../telemetry/index.js");
        // Surface the typed code (NO_TOKEN, BAD_TOKEN, RATE_LIMITED, …) as the
        // error name — `FigmaClientError` alone says nothing in a dashboard.
        telemetry.trackCliError({
          error_name: err instanceof FigmaClientError ? err.code : err.name,
          error_message: err.message,
          stack_trace: err.stack,
          command,
          kind: "command_error",
          endpoint: err instanceof FigmaClientError ? err.endpoint : undefined,
        });
        await telemetry.flush();
      } catch {
        // Telemetry must never mask the real command failure.
      }
      const [title = "figma command failed", ...rest] = err.message.split("\n");
      errorBox(title, rest.length > 0 ? rest.join("\n") : undefined);
      process.exit(1);
    }
    throw err;
  }
}
