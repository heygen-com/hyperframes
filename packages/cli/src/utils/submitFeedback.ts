import { getPublishApiBaseUrl } from "./publishProject.js";

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
        comment: cap(input.comment, MAX_COMMENT),
        cli_version: cap(input.cliVersion, MAX_CLI_VERSION),
        env: cap(input.env, MAX_ENV),
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
