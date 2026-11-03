/**
 * Chain resolver for HyperFrames credentials. First usable source wins:
 *   1. `HEYGEN_ACCESS_TOKEN` env (an OAuth token a host app injects)
 *   2. The stored login: fresh, or expired with a refresh token
 *   3. `HEYGEN_API_KEY` env, then `HYPERFRAMES_API_KEY`
 *   4. The API key saved in `~/.hyperframes/credentials`
 *
 * The env key goes first for a host app's gateway, and once HeyGen refused to refresh the login.
 * A broken store gives way to an env key, else surfaces `ErrInvalidStore`. A saved API key
 * never replaces an expired login (60s skew).
 */

import { isHeaderSafe, readStore } from "./store.js";
import { ErrInvalidStore, ErrLoginExpired, ErrNotConfigured, isAuthError } from "./errors.js";
import { assertOAuthIdentity } from "./config.js";
import { apiBaseUrl } from "./client.js";

type EnvSource = "env" | "env_alias" | "env_oauth";
type CredentialSource = EnvSource | "file_json" | "file_legacy";

export const ENV_CREDENTIAL_VAR: Record<EnvSource, string> = {
  env: "HEYGEN_API_KEY",
  env_alias: "HYPERFRAMES_API_KEY",
  env_oauth: "HEYGEN_ACCESS_TOKEN",
};

export const envCredentialVar = (source: CredentialSource): string | undefined =>
  source in ENV_CREDENTIAL_VAR ? ENV_CREDENTIAL_VAR[source as EnvSource] : undefined;

export interface ApiKeyCredential {
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

  const envKey = envApiKey();
  // A gateway takes the key its host app set and must never receive an OAuth token.
  if (envKey && !heygenApiHost()) return envKey;

  const accessToken = headerSafeEnv(ENV_CREDENTIAL_VAR.env_oauth);
  if (accessToken) {
    return { type: "oauth", access_token: accessToken, source: "env_oauth", refreshable: false };
  }
  if (envKey && loginRefreshFailed) return envKey;
  return await fromStore(now, envKey);
}

/** The stored login, else the env key, else the stored API key. */
async function fromStore(
  now: Date,
  envKey: ApiKeyCredential | undefined,
): Promise<ResolvedCredential> {
  const store = await readStore().catch((err: unknown) => {
    if (envKey) return null;
    throw err;
  });
  if (!store || store.source === "absent") {
    if (envKey) return envKey;
    throw ErrNotConfigured();
  }
  const { credentials, source } = store;
  const fileSource: CredentialSource = source === "file_legacy" ? "file_legacy" : "file_json";
  const login =
    credentials.oauth && boundToThisClient(credentials.oauth)
      ? pickOAuth(credentials.oauth, now, fileSource)
      : null;
  return login ?? envKey ?? storedApiKey(credentials, fileSource);
}

function storedApiKey(
  credentials: Awaited<ReturnType<typeof readStore>>["credentials"],
  source: CredentialSource,
): ApiKeyCredential {
  if (credentials.oauth) {
    assertOAuthIdentity(credentials.oauth);
    throw ErrLoginExpired();
  }
  if (credentials.api_key) return { type: "api_key", key: credentials.api_key, source };
  throw ErrNotConfigured();
}

function envApiKey(): ApiKeyCredential | undefined {
  const heygenEnv = headerSafeEnv(ENV_CREDENTIAL_VAR.env);
  if (heygenEnv) return { type: "api_key", key: heygenEnv, source: "env" };
  const hfEnv = headerSafeEnv(ENV_CREDENTIAL_VAR.env_alias);
  if (hfEnv) return { type: "api_key", key: hfEnv, source: "env_alias" };
  return undefined;
}

/** False when `HEYGEN_API_URL` or `HEYGEN_API_BASE` names a host app's gateway, not HeyGen. */
function heygenApiHost(): boolean {
  const mediaBase = process.env["HEYGEN_API_BASE"]?.trim();
  return [apiBaseUrl(), ...(mediaBase ? [mediaBase] : [])].every((base) => {
    try {
      const host = new URL(base).hostname;
      return host === "heygen.com" || host.endsWith(".heygen.com");
    } catch {
      return false;
    }
  });
}

function boundToThisClient(tokens: Parameters<typeof assertOAuthIdentity>[0]): boolean {
  try {
    assertOAuthIdentity(tokens);
    return true;
  } catch {
    return false;
  }
}

let loginRefreshFailed = false;

/**
 * After refreshing `refreshToken` failed: a login another process stored since, else the env key when HeyGen refused
 * the grant (it then replaces the login for this process), else the error. A network or server error, or a reply the
 * CLI couldn't read, throws: the login may still work, and the next call refreshes again.
 */
export async function afterRefreshFailure(
  err: unknown,
  refreshToken: string | undefined,
): Promise<ResolvedCredential> {
  if (!isAuthError(err)) throw err;
  if (err.code === "LOGIN_CHANGED" || err.code === "REFRESH_FAILED") {
    const stored = await readStore().catch(() => null);
    const current = stored?.credentials.oauth?.refresh_token;
    if (current && current !== refreshToken) {
      const next = await resolveCredential();
      if (next.type !== "oauth" || !next.refreshable) return next;
    }
  }
  if (!err.refused && err.code !== "LOGIN_EXPIRED") throw err;
  const key = envApiKey();
  if (!key) throw err;
  loginRefreshFailed = true;
  return key;
}

export function _resetLoginRefreshFailureForTests(): void {
  loginRefreshFailed = false;
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
