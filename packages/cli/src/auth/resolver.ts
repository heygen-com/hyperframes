/**
 * Chain resolver for HeyGen credentials.
 *
 * Priority — first non-empty wins:
 *   1. `HEYGEN_API_KEY` env (matches heygen-cli)
 *   2. `HYPERFRAMES_API_KEY` env (alias for parity with other tools)
 *   3. `~/.heygen/credentials` (JSON) — unexpired OAuth, else api_key
 *
 * Absent sources fall through. A broken file (parse error, bad shape)
 * surfaces immediately as `ErrInvalidStore` — silently falling back
 * would mask user config bugs.
 *
 * Expiry policy: an OAuth access_token whose `expires_at` is in the
 * past (60s skew) is considered expired. If a `refresh_token` is also
 * present, callers can still use it via `refreshable: true`. Otherwise
 * the api_key (if any) wins.
 */

import { isHeaderSafe, readStore } from "./store.js";
import { ErrInvalidStore, ErrNotConfigured, isAuthError } from "./errors.js";

type CredentialSource = "env" | "env_alias" | "file_json" | "file_legacy";

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

  const heygenEnv = process.env["HEYGEN_API_KEY"];
  if (heygenEnv && heygenEnv.length > 0) {
    if (!isHeaderSafe(heygenEnv)) {
      throw ErrInvalidStore("HEYGEN_API_KEY contains control characters");
    }
    return { type: "api_key", key: heygenEnv, source: "env" };
  }

  const hfEnv = process.env["HYPERFRAMES_API_KEY"];
  if (hfEnv && hfEnv.length > 0) {
    if (!isHeaderSafe(hfEnv)) {
      throw ErrInvalidStore("HYPERFRAMES_API_KEY contains control characters");
    }
    return { type: "api_key", key: hfEnv, source: "env_alias" };
  }

  const { credentials, source } = await readStore();
  if (source === "absent") throw ErrNotConfigured();

  const fileSource: CredentialSource = source === "file_legacy" ? "file_legacy" : "file_json";

  if (credentials.oauth) {
    const oauth = pickOAuth(credentials.oauth, now, fileSource);
    if (oauth) return oauth;
  }
  if (credentials.api_key) {
    return { type: "api_key", key: credentials.api_key, source: fileSource };
  }
  throw ErrNotConfigured();
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

/** Resolve only a HeyGen OAuth session, ignoring generic API-key sources. */
export async function tryResolveOAuthCredential(
  opts: ResolveOptions = {},
): Promise<OAuthCredential | null> {
  const now = (opts.now ?? (() => new Date()))();
  const { credentials, source } = await readStore();
  if (source === "absent" || !credentials.oauth) return null;
  const fileSource: CredentialSource = source === "file_legacy" ? "file_legacy" : "file_json";
  return pickOAuth(credentials.oauth, now, fileSource);
}

function pickOAuth(
  tokens: NonNullable<Awaited<ReturnType<typeof readStore>>["credentials"]["oauth"]>,
  now: Date,
  source: CredentialSource,
): OAuthCredential | null {
  const expiresAt = parseDate(tokens.expires_at);
  const expired = expiresAt !== undefined && expiresAt.getTime() - EXPIRY_SKEW_MS < now.getTime();

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

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
