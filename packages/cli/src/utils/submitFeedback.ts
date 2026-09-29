import { getPublishApiBaseUrl } from "./publishProject.js";
import { FEEDBACK_RATING_SCALE } from "./feedbackRating.js";

// Match the backend DTO caps (HyperframesFeedbackRequest). Truncate here so an
// over-long field (e.g. a pasted stack trace) is still forwarded truncated,
// rather than rejected by the backend with a 422 the best-effort path swallows.
const MAX_COMMENT = 2000;
const MAX_CLI_VERSION = 100;
const MAX_ENV = 500;

function cap(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export async function submitFeedback(input: {
  rating: number;
  comment?: string;
  cliVersion: string;
  env?: string;
}): Promise<void> {
  try {
    const apiBaseUrl = getPublishApiBaseUrl();
    await fetch(`${apiBaseUrl}/v1/hyperframes/feedback`, {
      method: "POST",
      body: JSON.stringify({
        rating: input.rating,
        rating_scale: FEEDBACK_RATING_SCALE,
        comment: cap(input.comment, MAX_COMMENT),
        cli_version: cap(input.cliVersion, MAX_CLI_VERSION),
        env: cap(input.env, MAX_ENV),
      }),
      headers: {
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort only.
  }
}

const MAX_QUERY = 500;
const MAX_WANTED = 500;
const MAX_TIER = 50;

/**
 * Forward a reported catalog gap to the same place a rating goes.
 *
 * A miss is the one search report that leaves the machine, and it is worth
 * more to a person reading a channel than to a chart: it names a move the
 * catalog does not have yet. Best-effort and bounded, exactly like
 * `submitFeedback` — a gap report must never fail the command that sent it.
 */
export async function submitCatalogSearchMiss(input: {
  query: string;
  wanted?: string;
  tier?: string;
  cliVersion: string;
}): Promise<void> {
  try {
    const apiBaseUrl = getPublishApiBaseUrl();
    await fetch(`${apiBaseUrl}/v1/hyperframes/catalog_search_miss`, {
      method: "POST",
      body: JSON.stringify({
        query: cap(input.query, MAX_QUERY),
        wanted: cap(input.wanted, MAX_WANTED),
        tier: cap(input.tier, MAX_TIER),
        cli_version: cap(input.cliVersion, MAX_CLI_VERSION),
      }),
      headers: {
        "content-type": "application/json",
        heygen_route: "canary",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort only.
  }
}
