import { failCommand, failUsage } from "../../utils/commandResult.js";
/**
 * `hyperframes auth login` — sign in to HeyGen.
 *
 * Default: OAuth 2.0 + PKCE via a loopback callback. The CLI opens
 * the user's browser, captures the authorization code on an
 * ephemeral 127.0.0.1 port, exchanges it for tokens, and persists
 * them to `~/.heygen/credentials`.
 *
 * `--api-key`: opts into the legacy long-lived API-key path.
 *
 * Write semantics:
 *   - Snapshot existing credentials first; merge so a new OAuth session
 *     preserves an existing API key (and vice versa).
 *   - Sanity-check that the input is non-empty and header-safe (no
 *     CR/LF) before touching disk. The backend's `/v3/users/me` is the
 *     source of truth for whether the key is actually valid — we do
 *     NOT shape-check the prefix (real keys come in multiple formats:
 *     `sk_V2_…`, `hg_…`, partner keys, etc.).
 *   - Verify via `GET /v3/users/me`. On 401, roll back to the previous
 *     state. Network/5xx errors keep the new credential in place per
 *     the transient-blip rationale.
 */

import { defineCommand } from "citty";
import { stdin as input } from "node:process";
import {
  AuthClient,
  assertOAuthConfiguredOrExit,
  clearUserInfo,
  deleteStore,
  hasPreservedUnknownData,
  isAuthError,
  isHeaderSafe,
  isUserInfoEmpty,
  readStore,
  refreshTokens,
  revokeTokens,
  saveUserInfo,
  persistVerifiedOAuthSession,
  startAuthorizationCodeFlow,
  startDeviceAuthorizationFlow,
  tryResolveCredential,
  userDisplayName,
  writeStore,
  type Credentials,
  type StoredUserInfo,
  type UserInfo,
} from "../../auth/index.js";
import { c } from "../../ui/colors.js";

const STDIN_TIMEOUT_MS = 30_000;
// Smallest plausible length for a real API key. We don't validate the
// prefix or character set — the backend's /v3/users/me is the source
// of truth and rolls back on rejection. The only must-check is
// header-safety (CR/LF), which `isHeaderSafe` covers.
const MIN_KEY_LENGTH = 8;

export default defineCommand({
  meta: {
    name: "login",
    description: "Sign in to HeyGen (OAuth by default; --api-key for long-lived keys)",
  },
  args: {
    "api-key": {
      type: "string",
      description: "API key value, or pass `--api-key` with no value to read from stdin / prompt.",
    },
    device: {
      type: "boolean",
      description: "Use an attended device code (for SSH/headless terminals; never for CI).",
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const inlineKey = args["api-key"];
    if (inlineKey !== undefined && args.device) {
      console.error(c.error("Choose either --device or --api-key, not both."));
      failUsage();
    }
    if (inlineKey !== undefined) {
      await runApiKeyLogin(inlineKey);
      return;
    }
    if (args.device) {
      await runDeviceLogin();
      return;
    }
    if (isRemoteOrHeadless()) {
      console.error(
        c.error(
          "Browser callback login is unavailable in this remote/headless terminal. Run `hyperframes auth login --device`.",
        ),
      );
      failUsage();
    }
    await runOAuthLogin();
  },
});

function isRemoteOrHeadless(): boolean {
  const remoteEnvironment = [
    "CODESPACES",
    "GITHUB_CODESPACES",
    "REMOTE_CONTAINERS",
    "GITPOD_WORKSPACE_ID",
    "container",
  ].some(envFlagEnabled);
  return Boolean(
    process.env["SSH_CONNECTION"] ||
    process.env["SSH_CLIENT"] ||
    process.env["SSH_TTY"] ||
    process.env["BROWSER"] === "none" ||
    process.env["HF_NO_BROWSER"] === "1" ||
    remoteEnvironment ||
    process.stdout.isTTY !== true,
  );
}

function envFlagEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return Boolean(value && value !== "0" && value !== "false" && value !== "no");
}

function assertAttendedDeviceFlow(): void {
  if (envFlagEnabled("CI") || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    console.error(
      c.error(
        "`--device` requires an attended terminal and is disabled in CI. Use an API key or workload credential for automation.",
      ),
    );
    failUsage();
  }
}

async function runDeviceLogin(): Promise<void> {
  assertAttendedDeviceFlow();
  assertOAuthConfiguredOrExit();
  const { trackAuthLoginStarted, trackAuthLoginCompleted, trackAuthLoginFailed, identifyUser } =
    await import("../../telemetry/index.js");
  trackAuthLoginStarted("device");

  let tokens;
  try {
    tokens = await startDeviceAuthorizationFlow({
      onChallenge: ({ verificationUri, verificationUriComplete, userCode }) => {
        console.log(`Open ${c.accent(verificationUriComplete ?? verificationUri)} in a browser.`);
        if (!verificationUriComplete) console.log(`Enter code ${c.bold(userCode)}.`);
        console.log(c.dim("Waiting for approval…"));
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Device authorization failed.";
    trackAuthLoginFailed("device", /expired/i.test(message) ? "flow_timeout" : "flow_error");
    console.error(c.error(message));
    failCommand();
  }

  const credential = {
    type: "oauth" as const,
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    source: "file_json" as const,
    refreshable: false,
  };
  let user: UserInfo;
  try {
    user = await new AuthClient().getCurrentUser(credential);
  } catch (err) {
    await revokeDeviceTokens(tokens);
    trackAuthLoginFailed("device", "rejected");
    console.error(
      c.error(
        `HeyGen could not verify the approved device session; no credential was saved. ${(err as Error).message}`,
      ),
    );
    failCommand();
  }

  try {
    await persistVerifiedOAuthSession(tokens, toStoredUserInfo(user));
  } catch (err) {
    await revokeDeviceTokens(tokens);
    trackAuthLoginFailed("device", "flow_error");
    console.error(
      c.error(
        `Could not save the verified device session; it was revoked. ${(err as Error).message}`,
      ),
    );
    failCommand();
  }

  const id = identityKey(user);
  if (id) identifyUser(id);
  trackAuthLoginCompleted("device", id);
  const identity = userDisplayName(toStoredUserInfo(user)) ?? "(unknown user)";
  console.log(c.success(`✓ Signed in as ${identity}.`));
}

async function revokeDeviceTokens(tokens: {
  access_token: string;
  refresh_token?: string;
}): Promise<void> {
  await revokeTokens(tokens.access_token, { token_type_hint: "access_token" });
  if (tokens.refresh_token) {
    await revokeTokens(tokens.refresh_token, {
      token_type_hint: "refresh_token",
    });
  }
}

// fallow-ignore-next-line complexity
async function runOAuthLogin(): Promise<void> {
  assertOAuthConfiguredOrExit();

  const { trackAuthLoginStarted, trackAuthLoginFailed } = await import("../../telemetry/index.js");
  trackAuthLoginStarted("oauth");

  try {
    await startAuthorizationCodeFlow();
  } catch (err) {
    const message = (err as Error).message ?? "";
    // The loopback server rejects with "OAuth callback timed out after …" when
    // the user never completes the browser step (closed the tab / walked away).
    // That is the dominant non-error dropout, so split it from real failures
    // (IdP misconfig, network) instead of lumping everything as flow_error.
    trackAuthLoginFailed("oauth", /timed out/i.test(message) ? "flow_timeout" : "flow_error");
    console.error(c.error(`Sign-in failed: ${message}`));
    failCommand();
  }

  await reportIdentity();
}

// fallow-ignore-next-line complexity
async function reportIdentity(): Promise<void> {
  const { trackAuthLoginCompleted, trackAuthLoginFailed, identifyUser } =
    await import("../../telemetry/index.js");
  const credential = await tryResolveCredential();
  if (!credential) {
    trackAuthLoginFailed("oauth", "no_credential");
    console.error(c.warn("Sign-in completed but no credential was persisted."));
    failCommand();
  }
  // Wire the refresh hook here too — a freshly-minted token shouldn't
  // need it, but a fast IdP-side rotation (or a misconfigured short
  // TTL) shouldn't punish the user with a hard failure when the
  // refresh_token would have transparently fixed it.
  const client = new AuthClient({
    onUnauthenticatedRefresh: async (rt) => await refreshTokens(rt),
  });
  try {
    const user = await client.getCurrentUser(credential);
    // Persist the friendly-display block alongside the OAuth tokens so
    // `auth status` can show "Logged in as ..." without re-hitting
    // /v3/users/me. Best-effort — a persist failure never fails the login.
    await persistUserInfo(user);
    // Attribute this install to the signed-in account (and stitch its prior
    // anonymous usage) before recording completion, so the completed event
    // carries the identity. Both no-op under the telemetry opt-out.
    const id = identityKey(user);
    if (id) identifyUser(id);
    trackAuthLoginCompleted("oauth", id);
    const identity = userDisplayName(toStoredUserInfo(user)) ?? "(unknown user)";
    console.log(c.success(`✓ Signed in as ${identity}.`));
  } catch (err) {
    // Don't roll back — the OAuth tokens are valid on disk; this is a
    // transient verify-side issue. The credential is persisted and usable, so
    // the sign-in still COMPLETED; we just have no resolved identity to
    // attribute it to. The stale user block from a prior login (possibly a
    // DIFFERENT account) is cleared so `auth status` can't surface it.
    await clearUserInfoBestEffort();
    trackAuthLoginCompleted("oauth");
    console.error(
      c.warn(`Signed in. Identity check failed (transient): ${(err as Error).message}`),
    );
  }
}

/**
 * The stable key we associate this install with in telemetry after sign-in.
 * `/v3/users/me` exposes no opaque user_id, so we key on the HeyGen account
 * EMAIL — the canonical account identifier and the reliable join key back to
 * billing — falling back to username only when the account exposes no email.
 * (Username is NOT a privacy win — HeyGen usernames are frequently email-shaped
 * — it is purely a fallback so an emailless account is still attributable.)
 * The privacy notice (showTelemetryNotice) and docs/packages/cli.mdx disclose
 * both, so keep them in sync with whatever this returns.
 */
function identityKey(user: UserInfo): string | undefined {
  return user.email ?? user.username;
}

/** Project the API `/v3/users/me` view onto the on-disk identity block. */
function toStoredUserInfo(user: UserInfo): StoredUserInfo {
  const out: StoredUserInfo = {};
  if (user.email) out.email = user.email;
  if (user.first_name) out.first_name = user.first_name;
  if (user.last_name) out.last_name = user.last_name;
  if (user.username) out.username = user.username;
  return out;
}

/**
 * Persist the friendly-display block (best-effort). A non-empty block is
 * saved; an empty one (the API returned no identity fields) clears any
 * stale block so a wrong account can't surface in `auth status`. A
 * persist/clear failure is warned, never fatal — the credential is valid
 * on disk and that's what matters.
 */
async function persistUserInfo(user: UserInfo): Promise<void> {
  const stored = toStoredUserInfo(user);
  try {
    if (isUserInfoEmpty(stored)) {
      await clearUserInfo();
    } else {
      await saveUserInfo(stored);
    }
  } catch (err) {
    console.error(c.dim(`(warning: could not persist user info: ${(err as Error).message})`));
  }
}

/** Drop any stale user block; best-effort, never fatal. */
async function clearUserInfoBestEffort(): Promise<void> {
  try {
    await clearUserInfo();
  } catch (err) {
    console.error(c.dim(`(warning: could not clear stale user info: ${(err as Error).message})`));
  }
}

// fallow-ignore-next-line complexity
async function runApiKeyLogin(inlineKey: string): Promise<void> {
  const { trackAuthLoginStarted, trackAuthLoginCompleted, trackAuthLoginFailed, identifyUser } =
    await import("../../telemetry/index.js");
  trackAuthLoginStarted("api_key");

  // collectApiKey throws when the user cancels the interactive prompt (Ctrl-C)
  // or when no key arrives on stdin before the timeout — both are "user walked
  // away", the abandonment signal we most want. Record it before the error
  // propagates so `started` still reconciles to `completed + failed`.
  let key: string;
  try {
    key = await collectApiKey(inlineKey);
  } catch (err) {
    trackAuthLoginFailed("api_key", "aborted");
    console.error(c.error((err as Error).message || "Sign-in aborted."));
    failCommand();
  }
  if (!key) {
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error("No API key provided."));
    failCommand();
  }
  if (!isHeaderSafe(key)) {
    // CR/LF in the value would smuggle headers when the key is sent
    // via `x-api-key`. The backend handles "wrong key" itself, but
    // header-injection has to be caught here.
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error("API key must not contain newline or control characters."));
    failCommand();
  }
  if (key.length < MIN_KEY_LENGTH) {
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error(`API key looks too short (got ${key.length} chars).`));
    failCommand();
  }

  const previous = await snapshotStore();
  const next: Credentials = { ...previous, api_key: key };
  await writeStore(next);

  const user = await verifyAndReport(key);
  if (!user) {
    trackAuthLoginFailed("api_key", "rejected");
    await rollback(previous);
    failCommand();
  }
  const id = identityKey(user);
  if (id) identifyUser(id);
  trackAuthLoginCompleted("api_key", id);
}

async function snapshotStore(): Promise<Credentials> {
  try {
    const { credentials } = await readStore();
    return { ...credentials };
  } catch {
    return {};
  }
}

async function rollback(previous: Credentials): Promise<void> {
  try {
    if (previous.api_key || previous.oauth || hasPreservedUnknownData(previous)) {
      // Restore the prior state. This branch also covers the case where
      // the only prior content was an unknown/foreign top-level key (a
      // future credential another CLI owns): writing `previous` back
      // re-emits that key, so the rollback doesn't clobber cross-CLI data
      // the file had before this login attempt.
      await writeStore(previous);
      console.error(c.dim("Rolled back to the previous credential."));
    } else {
      // No prior credential and nothing worth preserving — restore true
      // absence. Leaving the rejected key on disk would make the next
      // `auth status` / command silently resolve a known-bad key.
      await deleteStore();
      console.error(c.dim("Removed the rejected credential."));
    }
  } catch (err) {
    console.error(c.error(`Failed to roll back: ${(err as Error).message}`));
  }
}

// Returns the verified user on success (so the caller can attribute the
// completed sign-in to that identity), or null when the backend rejects the
// key. Other errors propagate.
// fallow-ignore-next-line complexity
async function verifyAndReport(key: string): Promise<UserInfo | null> {
  const client = new AuthClient();
  try {
    const user = await client.getCurrentUser({
      type: "api_key",
      key,
      source: "file_json",
    });
    // Persist the friendly-display block next to the now-verified api_key
    // so `auth status` can show a recognizable identity. Best-effort.
    await persistUserInfo(user);
    const identity = userDisplayName(toStoredUserInfo(user)) ?? "(unknown user)";
    console.log(c.success(`✓ API key saved. Authenticated as ${identity}.`));
    return user;
  } catch (err) {
    if (isAuthError(err) && err.code === "UNAUTHENTICATED") {
      console.error(
        `${c.warn("HeyGen rejected the API key.")}\n` +
          `  ${c.dim(err.message)}\n` +
          `Run ${c.accent("hyperframes auth login --api-key")} again with a valid key.`,
      );
      return null;
    }
    throw err;
  }
}

async function collectApiKey(inline: string): Promise<string> {
  if (inline.length > 0) return inline.trim();
  if (!input.isTTY) {
    return (await readAllWithTimeout(input, STDIN_TIMEOUT_MS)).trim();
  }
  return await promptForKey();
}

async function readAllWithTimeout(
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for stdin (${timeoutMs}ms). Pipe the key explicitly.`));
    }, timeoutMs);
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function promptForKey(): Promise<string> {
  const clack = await import("@clack/prompts");
  const value = await clack.password({
    message: "Enter HeyGen API key",
    validate: (v) => {
      if (!v || v.length < MIN_KEY_LENGTH) return "API key looks too short";
      if (!isHeaderSafe(v)) return "API key must not contain newline or control characters";
      return undefined;
    },
  });
  if (clack.isCancel(value)) {
    // Throw rather than exit here so the single catch in runApiKeyLogin records
    // the abandonment (auth_login_failed: aborted) and then exits.
    throw new Error("Aborted.");
  }
  return value.trim();
}
