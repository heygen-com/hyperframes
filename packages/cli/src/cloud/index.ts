/**
 * Internal surface of the `cloud` module — only the symbols the `cloud`
 * commands consume today. Don't add re-exports speculatively; SDK
 * consumers can import directly from `_gen/client.js` or `_gen/types.js`
 * if they need the broader generated surface.
 */

export { PollTimeoutError, pollUntilTerminal } from "./poll.js";
export { DEFAULT_MAX_WAIT_MS, DEFAULT_POLL_INTERVAL_MS } from "./poll.js";
export { downloadToFile } from "./download.js";

export { HyperframesApiError, HyperframesCloudClient } from "./_gen/client.js";
export type { CreateHyperframesRenderRequest, HyperframesRenderDetail } from "./_gen/types.js";

/**
 * Convenience factory that wires the generated client to the standard
 * credential resolver. The cloud commands all go through this rather
 * than constructing `HyperframesCloudClient` directly so refresh logic
 * lives in exactly one place.
 */
export async function createCloudClient(): Promise<
  import("./_gen/client.js").HyperframesCloudClient
> {
  const { HyperframesCloudClient } = await import("./_gen/client.js");
  const { resolveCloudAuthHeaders, resolveCloudBaseUrl } = await import("./auth.js");
  return new HyperframesCloudClient({
    baseUrl: resolveCloudBaseUrl(),
    getAuthHeaders: resolveCloudAuthHeaders,
  });
}
