/**
 * Shared API-error reporter for the cloud subverbs.
 *
 * Centralizes the three-branch `instanceof HyperframesApiError` → `Error`
 * → `String` cascade so the curated `ERROR_CODE_HINTS` table is applied
 * uniformly across `render`/`list`/`get`/`delete`. Without this, each
 * subverb had to remember to consult the hint table (and most didn't,
 * which is why review finding 10 was that `hyperframes_render_not_found`
 * was unreachable from get/delete).
 */

import { errorBox } from "../ui/format.js";
import { HyperframesApiError } from "./_gen/client.js";

/**
 * Hints surfaced when a HyperframesApiError carries a known machine-
 * readable code. Keep entries actionable; if there's nothing useful to
 * say, leave the code out and let the message stand on its own.
 */
const ERROR_CODE_HINTS: Record<string, string> = {
  hyperframes_project_too_large:
    "The zip exceeded the 200 MB limit. Run `hyperframes cloud render --dry-run`, then add only verified-unneeded paths to `.hyperframesignore` or pre-host required large media.",
  hyperframes_render_not_found:
    "The render_id no longer exists — either soft-deleted or never created.",
  invalid_parameter:
    "Check the listed parameter against `hyperframes cloud render --help` for the accepted values.",
  authentication_failed:
    "Run `hyperframes auth status` to confirm your credential; `hyperframes auth login` to re-auth.",
  rate_limit_exceeded: "Retry after the duration in the Retry-After header.",
};

/**
 * Print an errorBox and `process.exit(1)` for any unknown error from
 * the cloud subverbs. The `stage` is the human-readable name of the
 * step that failed (e.g. "Upload failed", "Submit failed", "Could not
 * list cloud renders"). Returns `never` so call sites can `throw` from
 * the catch block without a separate exit.
 *
 * Options:
 *   - `notFound`: short-circuit on a 404 with this friendly message
 *     (the render-id, asset-id, etc. that wasn't found).
 *   - `extraHints`: per-code overrides merged on top of
 *     `ERROR_CODE_HINTS`.
 *   - `suggestion`: a fallback line shown when no code-specific hint
 *     matches. Use this for caller-context that's always actionable
 *     (e.g. "Resume with: hyperframes cloud get hfr_X" on poll
 *     errors) so the user can recover without having to remember the
 *     render_id.
 */
// fallow-ignore-next-line complexity
export function reportApiError(
  stage: string,
  err: unknown,
  options: {
    notFound?: string;
    extraHints?: Record<string, string>;
    suggestion?: string;
  } = {},
): never {
  const hints = { ...ERROR_CODE_HINTS, ...options.extraHints };
  if (err instanceof HyperframesApiError) {
    if (err.status === 404 && options.notFound) {
      errorBox("Not found", options.notFound);
      process.exit(1);
    }
    const hint = err.code ? hints[err.code] : undefined;
    const title = `${stage} (HTTP ${err.status})`;
    // Priority: code-specific hint > caller suggestion > bare code
    // label > no third line. Code-specific hints win because they
    // address the specific failure mode; the caller suggestion is a
    // generic-context fallback.
    if (hint) {
      errorBox(title, err.message, hint);
    } else if (options.suggestion) {
      errorBox(title, err.message, options.suggestion);
    } else if (err.code) {
      errorBox(title, err.message, `code: ${err.code}`);
    } else {
      errorBox(title, err.message);
    }
    process.exit(1);
  }
  if (err instanceof Error) {
    errorBox(stage, err.message, options.suggestion);
    process.exit(1);
  }
  errorBox(stage, String(err), options.suggestion);
  process.exit(1);
}
