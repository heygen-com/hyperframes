/**
 * OAuth 2.0 + PKCE driver for the HeyGen public OAuth flow.
 *
 * Entry points:
 *   - `startAuthorizationCodeFlow()` — full interactive login (browser
 *     opens, loopback waits, code → tokens, persist).
 *   - `refreshTokens()` — POST <token-endpoint> with grant_type=refresh_token.
 *   - `revokeTokens()` — best-effort POST <revoke-endpoint>.
 *
 * Endpoints split across two hosts (verified live):
 *   - **Authorize** — GET https://app.heygen.com/oauth/authorize
 *     Renders the consent screen, has to live on the same origin as the
 *     user's web session (cookies). The Next.js SPA shell serves this.
 *   - **Token** — POST https://api2.heygen.com/v1/oauth/token
 *     Server-to-server JSON API. `app.heygen.com/oauth/token` returns
 *     the SPA HTML for direct POSTs — confirmed by curl; only the api2
 *     route returns JSON OAuth responses.
 *   - **Revoke** — POST https://api2.heygen.com/v1/oauth/revoke
 *     Same host/prefix as token.
 *
 * The `heygen-oauth-urls.ts` default in `hyperframes-internal/demo-next`
 * lists `app.heygen.com/oauth/token` as the default — that's either
 * proxied via a Next.js rewrite or set via `HEYGEN_OAUTH_TOKEN_URL` in
 * their prod env. A direct fetch to it returns the SPA shell, so we
 * use the api2 endpoint here.
 *
 * Overrides:
 *   - `HYPERFRAMES_OAUTH_AUTHORIZE_URL`
 *   - `HYPERFRAMES_OAUTH_TOKEN_URL`
 *   - `HYPERFRAMES_OAUTH_REVOKE_URL`
 *   - `HYPERFRAMES_OAUTH_CLIENT_ID`
 *
 * Public client — no `client_secret`.
 */

import { ErrApi, ErrOAuthNotConfigured, ErrRefreshFailed, isAuthError } from "./errors.js";
import { generatePkcePair, generateState } from "./pkce.js";
import { startLoopback } from "./loopback.js";
import { openBrowser } from "./browser.js";
import { scrubCredentials } from "./scrub.js";
import {
  isHeaderSafe,
  readStore,
  writeStore,
  type Credentials,
  type OAuthTokens,
} from "./store.js";
import { c } from "../ui/colors.js";

const REVOKE_TIMEOUT_MS = 5_000;
const MIN_EXPIRES_IN_SECONDS = 30;

/**
 * Default OAuth client_id baked at build time. Override with the
 * `HYPERFRAMES_OAUTH_CLIENT_ID` env var. Empty string means "not
 * configured" — `resolveClientId()` errors cleanly with a pointer
 * at `--api-key`.
 */
const DEFAULT_CLIENT_ID = "q2A2QRSke2LrFTPJhoDbHtXh";
const DEFAULT_SCOPES = "openid profile email";

// Endpoint defaults — see file-header comment for why these straddle two
// hosts. Each is independently overridable.
const DEFAULT_AUTHORIZE_URL = "https://app.heygen.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://api2.heygen.com/v1/oauth/token";
const DEFAULT_REVOKE_URL = "https://api2.heygen.com/v1/oauth/revoke";

function authorizeEndpoint(): string {
  return process.env["HYPERFRAMES_OAUTH_AUTHORIZE_URL"] || DEFAULT_AUTHORIZE_URL;
}
function tokenEndpoint(): string {
  return process.env["HYPERFRAMES_OAUTH_TOKEN_URL"] || DEFAULT_TOKEN_URL;
}
function revokeEndpoint(): string {
  return process.env["HYPERFRAMES_OAUTH_REVOKE_URL"] || DEFAULT_REVOKE_URL;
}

export interface AuthorizeFlowOptions {
  /** Override scopes (default `openid profile email`). */
  scope?: string;
  /** Inject a custom fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /** Override timeout in ms (default 120s). */
  timeoutMs?: number;
}

export interface AuthorizeFlowResult {
  tokens: OAuthTokens;
  /** Returned identity info for friendly post-login UX. */
  userInfo?: Record<string, unknown>;
}

export interface RefreshOptions {
  fetchImpl?: typeof fetch;
}

/** Read the client_id, throwing `ErrOAuthNotConfigured` when unset. */
export function resolveClientId(): string {
  const override = process.env["HYPERFRAMES_OAUTH_CLIENT_ID"];
  const id = override && override.length > 0 ? override : DEFAULT_CLIENT_ID;
  if (!id || id.length === 0) throw ErrOAuthNotConfigured();
  return id;
}

/**
 * For command-entry points: throw the standard `ErrOAuthNotConfigured`
 * via `resolveClientId()`; on a real misconfig, print a friendly hint
 * and exit with status 1 rather than dumping a stack. Throws non-auth
 * errors so callers can surface programmer bugs.
 */
export function assertOAuthConfiguredOrExit(): void {
  try {
    resolveClientId();
  } catch (err) {
    if (isAuthError(err) && err.code === "OAUTH_NOT_CONFIGURED") {
      console.error(`Error: ${err.message}`);
      if (err.hint) console.error(err.hint);
      process.exit(1);
    }
    throw err;
  }
}

export async function startAuthorizationCodeFlow(
  opts: AuthorizeFlowOptions = {},
): Promise<AuthorizeFlowResult> {
  const clientId = resolveClientId();
  const scope = opts.scope ?? DEFAULT_SCOPES;
  const pkce = generatePkcePair();
  const state = generateState();

  const loopback = await startLoopback({ state, timeoutMs: opts.timeoutMs });
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri: loopback.redirectUri,
    scope,
    state,
    challenge: pkce.challenge,
  });

  // Print the host+path only (no state / code_challenge) so live
  // values can't leak into scrollback / CI logs during the 120s window.
  console.log(`Opening browser to ${c.dim(authorizeHost(authorizeUrl))} ...`);
  const { opened } = await openBrowser(authorizeUrl);
  if (!opened) {
    // openBrowser already printed the manual URL; surface it as the
    // last on-screen instruction so it isn't buried above "Waiting…".
    console.log(c.dim("(open the URL above to continue)"));
  }
  console.log(`Waiting for callback on ${c.accent(loopback.redirectUri)} ...`);

  let codeResult;
  try {
    codeResult = await loopback.result;
  } catch (err) {
    await loopback.close().catch(() => {});
    throw err;
  }

  const tokens = await exchangeCodeForTokens({
    clientId,
    code: codeResult.code,
    redirectUri: codeResult.redirectUri,
    verifier: pkce.verifier,
    fetchImpl: opts.fetchImpl,
  });

  // Fresh login → clean OAuth block (no inherited refresh_token).
  await persistOAuth(tokens, { preserveMissing: false });
  return { tokens };
}

export async function refreshTokens(
  refresh_token: string,
  opts: RefreshOptions = {},
): Promise<OAuthTokens> {
  const clientId = resolveClientId();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: clientId,
  });

  const res = await fetchImpl(tokenEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (res.status === 400 || res.status === 401) {
    throw ErrRefreshFailed(await safeText(res));
  }
  if (!res.ok) {
    throw ErrApi(res.status, (await safeText(res)) || res.statusText);
  }

  const payload = await readJsonOrThrow(res);
  const tokens = parseTokenResponse(payload);
  // Refresh grant → preserve a refresh_token the server didn't rotate.
  await persistOAuth(tokens, { preserveMissing: true });
  return tokens;
}

export interface RevokeOptions extends RefreshOptions {
  /** Hint to the server about which token we're sending (RFC 7009). */
  token_type_hint?: "access_token" | "refresh_token";
  /** Abort the revoke after this many ms (default 5s). */
  timeoutMs?: number;
}

/**
 * RFC 7009 revoke. Best-effort: never throws. A hung IdP or unset
 * client_id MUST NOT block local logout — both are caught here so the
 * caller can wipe local state immediately afterward regardless.
 */
export async function revokeTokens(token: string, opts: RevokeOptions = {}): Promise<void> {
  let clientId: string;
  try {
    clientId = resolveClientId();
  } catch {
    // OAuth not configured — nothing to revoke server-side.
    return;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const params: Record<string, string> = { token, client_id: clientId };
  if (opts.token_type_hint) params["token_type_hint"] = opts.token_type_hint;
  const body = new URLSearchParams(params);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REVOKE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(revokeEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        c.dim(`Note: token revoke returned HTTP ${res.status}; local credentials cleared anyway.`),
      );
    }
  } catch {
    /* timeout or network error — silent, this is best-effort */
  } finally {
    clearTimeout(timer);
  }
}

function authorizeHost(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return fullUrl.split("?")[0] ?? fullUrl;
  }
}

function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: args.scope,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

async function exchangeCodeForTokens(args: {
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokens> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.verifier,
  });
  const res = await fetchImpl(tokenEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  if (res.status === 400 || res.status === 401) {
    // The authorization code is single-use and short-lived. A 400/401
    // here almost always means it expired during the loopback wait or
    // was already redeemed — surface an actionable message instead of
    // a bare "HeyGen API error (400)".
    const detail = (await safeText(res)) || res.statusText;
    throw ErrRefreshFailed(
      `authorization code rejected (${detail}); please run \`auth login\` again`,
    );
  }
  if (!res.ok) {
    throw ErrApi(res.status, (await safeText(res)) || res.statusText);
  }
  return parseTokenResponse(await readJsonOrThrow(res));
}

/**
 * Parse the RFC 6749 token response. Backend may also include
 * `id_token` (OIDC) but we ignore that today.
 *
 * Throws `ErrInvalidTokenResponse` (an AuthError carrying
 * REFRESH_FAILED code, so callers using `tryRefresh` consistently
 * route the user to "log in again" instead of a generic API error)
 * on shape failures.
 */
// fallow-ignore-next-line complexity
export function parseTokenResponse(payload: unknown): OAuthTokens {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw ErrRefreshFailed("token endpoint returned a non-object payload");
  }
  const obj = payload as Record<string, unknown>;
  const accessToken = stringField(obj, "access_token");
  if (!accessToken) {
    throw ErrRefreshFailed("token endpoint did not return an access_token");
  }
  if (!isHeaderSafe(accessToken)) {
    throw ErrRefreshFailed("access_token contains control characters");
  }

  const out: OAuthTokens = { access_token: accessToken };
  const refreshToken = stringField(obj, "refresh_token");
  if (refreshToken) {
    if (!isHeaderSafe(refreshToken)) {
      throw ErrRefreshFailed("refresh_token contains control characters");
    }
    out.refresh_token = refreshToken;
  }
  const tokenType = stringField(obj, "token_type");
  if (tokenType) out.token_type = tokenType;
  const scope = stringField(obj, "scope");
  if (scope) out.scope = scope;

  const expiresIn = numericField(obj, "expires_in");
  if (expiresIn !== undefined) {
    // Clamp to a sensible minimum so a misbehaving / clock-skewed
    // server returning 0 or a negative value doesn't put expires_at in
    // the past and cause the 401-refresh path to loop.
    const clamped = Math.max(expiresIn, MIN_EXPIRES_IN_SECONDS);
    out.expires_at = new Date(Date.now() + clamped * 1000).toISOString();
  }
  return out;
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numericField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Persist a new OAuth token set, always preserving a co-located
 * `api_key`.
 *
 * `preserveMissing` controls how the new tokens combine with whatever
 * OAuth block is already on disk:
 *   - `false` (fresh authorization-code login): overwrite the OAuth
 *     block entirely. A new interactive login is a clean session — it
 *     must NOT inherit the previous session's refresh_token, or a
 *     response that omits one would pair a new access token with a
 *     stale refresh token and break/misroute the next refresh.
 *   - `true` (refresh grant): keep the prior refresh_token / scope /
 *     token_type when the response omits them. RFC 6749 §6 lets the
 *     token endpoint skip refresh_token on a no-rotation refresh, and
 *     dropping it would brick future refreshes.
 */
async function persistOAuth(
  tokens: OAuthTokens,
  opts: { preserveMissing: boolean },
): Promise<void> {
  let existing: Credentials = {};
  try {
    const { credentials } = await readStore();
    existing = credentials;
  } catch {
    // Treat unreadable existing file as empty — we're about to
    // overwrite the OAuth block anyway.
    existing = {};
  }

  const oauth: OAuthTokens = opts.preserveMissing
    ? { ...existing.oauth, ...tokens }
    : { ...tokens };
  // Start from the existing record so co-located data survives: the
  // api_key, the friendly-display `user` block, AND any unknown/foreign
  // keys another CLI wrote (carried on a hidden symbol slot by spread).
  // Only the `oauth` block is overwritten here.
  await writeStore({ ...existing, oauth });
}

async function readJsonOrThrow(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    throw ErrApi(res.status, `non-JSON body: ${(err as Error).message}`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    // Token/revoke requests carry refresh_token, authorization code, and
    // code_verifier in the form body; a server/proxy error page can echo
    // request data back. Scrub before the text reaches any error message.
    return scrubCredentials((await res.text()).slice(0, 500));
  } catch {
    return "";
  }
}
