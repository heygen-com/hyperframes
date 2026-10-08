/**
 * Chain resolver for HeyGen credentials.
 *
 * Priority — first non-empty wins:
 *   1. `HEYGEN_API_KEY` env (matches heygen-cli)
 *   2. `HYPERFRAMES_API_KEY` env (alias for parity with other tools)
 *   3. `HEYGEN_ACCESS_TOKEN` env (host-managed OAuth)
 *   4. `~/.heygen/credentials` (JSON) — unexpired OAuth, else api_key
 *
 * Absent sources fall through. Broken files surface `ErrInvalidStore` immediately;
 * silently falling back would mask user configuration errors.
 *
 * Expiry policy: an OAuth access_token whose `expires_at` is in the
 * past (60s skew) is considered expired. If a `refresh_token` is also
 * present, callers can still use it via `refreshable: true`. Otherwise
 * the api_key (if any) wins, else `ErrLoginExpired`, not `ErrNotConfigured`.
 */

import { isHeaderSafe, readStore } from "./store.js";
import { ErrInvalidStore, ErrLoginExpired, ErrNotConfigured, isAuthError } from "./errors.js";

type EnvSource = "env" | "env_alias" | "env_oauth";
type CredentialSource = EnvSource | "file_json" | "file_legacy";

export const ENV_CREDENTIAL_VAR: Record<EnvSource, string> = {
  env: "HEYGEN_API_KEY",
  env_alias: "HYPERFRAMES_API_KEY",
  env_oauth: "HEYGEN_ACCESS_TOKEN",
};

export const envCredentialVar = (source: CredentialSource): string | undefined =>
  source in ENV_CREDENTIAL_VAR ? ENV_CREDENTIAL_VAR[source as EnvSource] : undefined;

interface ApiKeyCredential {
  type: "api_key";
  key: string;
  source: CredentialSource;
}

interface OAuthCredential {
  type: "oauth";
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  scope?: string;
  source: CredentialSource;
  /** True when the access_token is expired but a refresh_token exists. */
  refreshable: boolean;
}

export type ResolvedCredential = ApiKeyCredential | OAuthCredential;

const EXPIRY_SKEW_MS = 60 * 1000;

export interface ResolveOptions {
  now?: () => Date;
}

export async function resolveCredential(opts: ResolveOptions = {}): Promise<ResolvedCredential> {
  const now = (opts.now ?? (() => new Date()))();

  const heygenEnv = headerSafeEnv(ENV_CREDENTIAL_VAR.env);
  if (heygenEnv) {
    return { type: "api_key", key: heygenEnv, source: "env" };
  }

  const hfEnv = headerSafeEnv(ENV_CREDENTIAL_VAR.env_alias);
  if (hfEnv) {
    return { type: "api_key", key: hfEnv, source: "env_alias" };
  }

  const accessToken = headerSafeEnv(ENV_CREDENTIAL_VAR.env_oauth);
  if (accessToken) {
    return { type: "oauth", access_token: accessToken, source: "env_oauth", refreshable: false };
  }

  const { credentials, source } = await readStore();
  if (source === "absent") throw ErrNotConfigured();

  const fileSource: CredentialSource = source === "file_legacy" ? "file_legacy" : "file_json";

  const oauth = credentials.oauth ? pickOAuth(credentials.oauth, now, fileSource) : null;
  if (oauth) return oauth;
  if (credentials.api_key) {
    return { type: "api_key", key: credentials.api_key, source: fileSource };
  }
  throw credentials.oauth ? ErrLoginExpired() : ErrNotConfigured();
}

function headerSafeEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value && !isHeaderSafe(value)) {
    throw ErrInvalidStore(`${name} contains control characters`);
  }
  return value;
}

/** Like `resolveCredential` but returns `null` instead of throwing `NOT_CONFIGURED`. */
export async function tryResolveCredential(
  opts: ResolveOptions = {},
): Promise<ResolvedCredential | null> {
  try {
    return await resolveCredential(opts);
  } catch (err) {
    if (isAuthError(err) && err.code === "NOT_CONFIGURED") {
      return null;
    }
    throw err;
  }
}

function pickOAuth(
  tokens: NonNullable<Awaited<ReturnType<typeof readStore>>["credentials"]["oauth"]>,
  now: Date,
  source: CredentialSource,
): OAuthCredential | null {
  const expiresAt = parseDate(tokens.expires_at);
  const expired = isTokenExpired(expiresAt, now);

  if (expired && !tokens.refresh_token) return null;

  const out: OAuthCredential = {
    type: "oauth",
    access_token: tokens.access_token,
    source,
    refreshable: expired && tokens.refresh_token !== undefined,
  };
  if (tokens.refresh_token) out.refresh_token = tokens.refresh_token;
  if (expiresAt) out.expires_at = expiresAt;
  if (tokens.scope) out.scope = tokens.scope;
  return out;
}

export function isTokenExpired(expiresAt: Date | undefined, now: Date): boolean {
  return expiresAt !== undefined && expiresAt.getTime() - EXPIRY_SKEW_MS < now.getTime();
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
