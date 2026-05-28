/**
 * Bridge between the existing credential resolution chain (auth/) and the
 * generated cloud client (`_gen/client.ts`). Hands the client a
 * `getAuthHeaders()` callback that resolves credentials fresh on every
 * request — so OAuth refreshes that happen between calls (e.g. during a
 * long poll loop) are picked up automatically the next time the callback
 * fires.
 *
 * Why this lives in `cloud/` instead of extending `auth/client.ts`: the
 * auth client is scoped to `/v3/users/me` (the credential-verification
 * endpoint) and we want the cloud client to be a standalone surface. The
 * shared primitives (`buildAuthHeaders`, `resolveCredential`) are pulled
 * in here without coupling the two clients.
 */

import { apiBaseUrl, buildAuthHeaders } from "../auth/client.js";
import { refreshTokens } from "../auth/oauth.js";
import { resolveCredential, type ResolvedCredential } from "../auth/resolver.js";

/**
 * Build the cloud client's `getAuthHeaders` callback. Each invocation
 * re-resolves credentials so refreshes that happened since the last call
 * are picked up. When the OAuth access token is past expiry AND a
 * refresh_token is present, the token endpoint is hit before headers
 * are returned.
 */
export async function resolveCloudAuthHeaders(): Promise<Record<string, string>> {
  let credential = await resolveCredential();
  credential = await refreshIfNeeded(credential);
  return buildAuthHeaders(credential);
}

/**
 * Return the base URL the cloud client should hit. Honors
 * `HEYGEN_API_URL` (matches `auth/client.ts:apiBaseUrl`).
 */
export function resolveCloudBaseUrl(): string {
  return apiBaseUrl();
}

// fallow-ignore-next-line complexity
async function refreshIfNeeded(credential: ResolvedCredential): Promise<ResolvedCredential> {
  if (credential.type !== "oauth") return credential;
  if (!credential.refreshable || !credential.refresh_token) return credential;
  const fresh = await refreshTokens(credential.refresh_token);
  return {
    ...credential,
    access_token: fresh.access_token,
    expires_at: parseDateOrUndef(fresh.expires_at),
    refreshable: false,
    ...(fresh.refresh_token ? { refresh_token: fresh.refresh_token } : {}),
  };
}

function parseDateOrUndef(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Force-refresh the OAuth access token regardless of locally-known
 * expiry. Used by `createCloudClient`'s 401-retry path when the server
 * rejects a token that the local resolver thought was still valid (e.g.
 * server-side revocation, clock skew, IdP rotation). No-op for API-key
 * credentials.
 *
 * Throws if the credential can't be refreshed (no refresh_token, or the
 * IdP refresh call itself fails). Callers should let the throw surface
 * — the original 401 is what the user needs to see, not a confusing
 * "refresh failed" message.
 */
export async function forceRefreshCredentials(): Promise<void> {
  const credential = await resolveCredential();
  if (credential.type !== "oauth" || !credential.refresh_token) return;
  await refreshTokens(credential.refresh_token);
}
