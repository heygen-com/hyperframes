/**
 * Minimal typed HTTP client for HeyGen endpoints needed by the auth
 * commands. Hand-written rather than codegen'd because the surface is
 * one endpoint (`/v3/users/me`) and pulling in an OpenAPI pipeline is
 * disproportionate.
 *
 * Reads `HEYGEN_API_URL` (default `https://api.heygen.com`) so dev
 * testing is one env var away.
 *
 * Auth header selection:
 *   - OAuth → `Authorization: Bearer <token>`
 *   - API key → `x-api-key: <key>`
 *
 * The backend `/v3/users/me` accepts both. See
 * `movio/api_service/app/controller/user_v3.py`.
 */

import { ErrApi, ErrUnauthenticated, isAuthError } from "./errors.js";
import type { ResolvedCredential } from "./resolver.js";
import { scrubCredentials } from "./scrub.js";
import type { OAuthTokens } from "./store.js";

const DEFAULT_BASE_URL = "https://api.heygen.com";
export const HEYGEN_CLI_SOURCE_HEADER = "X-HeyGen-Source";
export const HEYGEN_CLI_SOURCE = "cli";

export function apiBaseUrl(): string {
  const override = process.env["HEYGEN_API_URL"];
  return override && override.length > 0 ? override.replace(/\/+$/, "") : DEFAULT_BASE_URL;
}

export type BillingType = "wallet" | "subscription" | "usage_based" | string;

export interface WalletInfo {
  currency?: string;
  remaining_balance?: number;
  auto_reload?: boolean;
}

/**
 * The API returns `credits.{premium,add_on}_credits` as nested objects
 * (`{ remaining, resets_at? }`), not bare numbers — discovered live
 * against api.heygen.com. Modelling them as nested objects so the row
 * formatter can render them properly instead of `[object Object]`.
 */
export interface CreditBalance {
  remaining?: number;
  resets_at?: string;
}

export interface SubscriptionInfo {
  plan?: string;
  credits?: {
    premium_credits?: CreditBalance;
    add_on_credits?: CreditBalance;
  };
}

export interface UsageBasedInfo {
  spending_current_usd?: number;
  spending_cap_usd?: number;
}

/** Subset of the backend response we surface to users today. */
export interface UserInfo {
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  billing_type?: BillingType;
  wallet?: WalletInfo;
  subscription?: SubscriptionInfo;
  usage_based?: UsageBasedInfo;
}

export interface AuthClientOptions {
  /** Override base URL (otherwise `HEYGEN_API_URL` / default). */
  baseUrl?: string;
  /** Inject a custom fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /**
   * Hook for refreshing an OAuth credential on 401. The hook should
   * exchange the supplied refresh_token for new tokens, persist them,
   * and return the FULL new token set — at minimum a fresh
   * `access_token`, plus a fresh `refresh_token` if the IdP rotated it.
   * Returning the full set lets the retry's credential carry the new
   * refresh_token, so any subsequent refresh on the same in-memory
   * credential doesn't re-use a now-invalidated rotated RT.
   * Wired in by the auth commands; injectable for tests.
   */
  onUnauthenticatedRefresh?: (refresh_token: string) => Promise<OAuthTokens>;
}

export class AuthClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onRefresh?: (refresh_token: string) => Promise<OAuthTokens>;

  constructor(opts: AuthClientOptions = {}) {
    this.base = (opts.baseUrl ?? apiBaseUrl()).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onRefresh = opts.onUnauthenticatedRefresh;
  }

  /**
   * `GET /v3/users/me`. Throws `ErrUnauthenticated` on 401, `ErrApi`
   * on any other non-2xx or non-JSON body.
   *
   * On OAuth 401 with a refresh hook configured, the request is
   * retried once after refreshing the access token. The retry's
   * outcome is what the caller sees — if the refresh itself fails
   * (REFRESH_FAILED) or the retry still 401s, the user lands on a
   * "please log in again" path upstream.
   */
  async getCurrentUser(credential: ResolvedCredential): Promise<UserInfo> {
    const url = `${this.base}/v3/users/me`;
    return await this.fetchUser(url, credential, true);
  }

  // fallow-ignore-next-line complexity
  private async fetchUser(
    url: string,
    credential: ResolvedCredential,
    allowRefresh: boolean,
  ): Promise<UserInfo> {
    const headers = buildAuthHeaders(credential);
    const res = await this.fetchImpl(url, { method: "GET", headers });

    if (res.status === 401) {
      if (
        allowRefresh &&
        credential.type === "oauth" &&
        credential.refresh_token &&
        this.onRefresh
      ) {
        const refreshed = await this.tryRefresh(credential.refresh_token);
        if (refreshed) {
          // Carry the new refresh_token forward too — for IdPs that
          // rotate RTs on every refresh, a future retry on this
          // in-memory credential would otherwise re-send the old
          // (now-invalidated) one.
          const next: ResolvedCredential = {
            ...credential,
            access_token: refreshed.access_token,
            ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
          };
          return await this.fetchUser(url, next, false);
        }
      }
      const detail = await safeText(res);
      throw ErrUnauthenticated(detail || `${res.status} ${res.statusText}`);
    }
    if (!res.ok) {
      throw ErrApi(res.status, (await safeText(res)) || res.statusText);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      throw ErrApi(res.status, `non-JSON body: ${(err as Error).message}`);
    }
    return extractUserInfo(payload);
  }

  private async tryRefresh(refresh_token: string): Promise<OAuthTokens | null> {
    if (!this.onRefresh) return null;
    try {
      return await this.onRefresh(refresh_token);
    } catch (err) {
      // Refresh failure should be surfaced upstream by the caller via
      // the retry's 401, not by throwing here — so callers consistently
      // see "please log in again" rather than mixed error types.
      if (isAuthError(err) && err.code === "REFRESH_FAILED") return null;
      throw err;
    }
  }
}

export function buildAuthHeaders(credential: ResolvedCredential): Record<string, string> {
  if (credential.type === "oauth") {
    return {
      authorization: `Bearer ${credential.access_token}`,
      [HEYGEN_CLI_SOURCE_HEADER]: HEYGEN_CLI_SOURCE,
    };
  }
  // API-key traffic keeps the normal billing path; the backend ignores the
  // cli-source header for it, so we don't send it (avoids a contradictory
  // "cli-source claim on an API-key request").
  return { "x-api-key": credential.key };
}

async function safeText(res: Response): Promise<string> {
  try {
    const body = (await res.text()).slice(0, 500);
    return scrubCredentials(body);
  } catch {
    return "";
  }
}

/**
 * The backend wraps responses in `{code, message, data: {...}}` for some
 * endpoints and returns raw fields directly for others. Handle both.
 */
function extractUserInfo(payload: unknown): UserInfo {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const obj = payload as Record<string, unknown>;
  const wrapped = obj["data"];
  const data =
    wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? (wrapped as Record<string, unknown>)
      : obj;
  return {
    username: pickString(data, "username"),
    email: pickString(data, "email"),
    first_name: pickString(data, "first_name"),
    last_name: pickString(data, "last_name"),
    billing_type: pickString(data, "billing_type"),
    wallet: pickObject(data, "wallet") as WalletInfo | undefined,
    subscription: pickObject(data, "subscription") as SubscriptionInfo | undefined,
    usage_based: pickObject(data, "usage_based") as UsageBasedInfo | undefined,
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function pickObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj[key];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
