/**
 * Internal surface of the `cloud` module — only the symbols the `cloud`
 * commands consume today. Don't add re-exports speculatively; SDK
 * consumers can import directly from `_gen/client.js` or `_gen/types.js`
 * if they need the broader generated surface.
 */

export { PollTimeoutError, pollUntilTerminal } from "./poll.js";
export { DEFAULT_MAX_WAIT_MS, DEFAULT_POLL_INTERVAL_MS } from "./poll.js";
export { downloadToFile } from "./download.js";

export type { HyperframesCloudClient } from "./_gen/client.js";
export type { CreateHyperframesRenderRequest, HyperframesRenderDetail } from "./_gen/types.js";

import { HyperframesApiError, HyperframesCloudClient } from "./_gen/client.js";
import { forceRefreshCredentials, resolveCloudAuthHeaders, resolveCloudBaseUrl } from "./auth.js";

/**
 * Convenience factory that wires the generated client to the standard
 * credential resolver and adds a 401-retry-with-refresh decorator.
 *
 * The decorator catches `HyperframesApiError(status=401)` thrown from
 * any method on the client, force-refreshes the OAuth token, and
 * retries the call exactly once. This mirrors `auth/client.ts`'s
 * `onUnauthenticatedRefresh` behavior so server-side revocations or
 * clock-skew rejections don't fail the cloud command outright when a
 * refresh would have fixed them.
 */
export async function createCloudClient(): Promise<HyperframesCloudClient> {
  const client = new HyperframesCloudClient({
    baseUrl: resolveCloudBaseUrl(),
    getAuthHeaders: resolveCloudAuthHeaders,
  });
  return wrapWith401Retry(client);
}

function wrapWith401Retry(client: HyperframesCloudClient): HyperframesCloudClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      // Bind so internal `this`-references in the generated client
      // resolve back to the original instance, not the Proxy.
      const original = value.bind(target) as (...args: unknown[]) => Promise<unknown>;
      // Only wrap the public endpoint methods (return Promises). Don't
      // gate on method name — the generated client has stable shape,
      // and a future endpoint would otherwise be missed.
      // fallow-ignore-next-line complexity
      return async (...args: unknown[]): Promise<unknown> => {
        try {
          return await original(...args);
        } catch (err) {
          if (err instanceof HyperframesApiError && err.status === 401) {
            // Best-effort refresh; if it fails, surface the original
            // 401 not the refresh error.
            try {
              await forceRefreshCredentials();
            } catch {
              throw err;
            }
            return await original(...args);
          }
          throw err;
        }
      };
    },
  });
}
