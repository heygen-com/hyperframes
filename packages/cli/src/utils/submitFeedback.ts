import { getPublishApiBaseUrl } from "./publishProject.js";

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
        comment: input.comment,
        cli_version: input.cliVersion,
        env: input.env,
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
