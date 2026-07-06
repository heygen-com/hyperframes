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
  saveUserInfo,
  startAuthorizationCodeFlow,
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
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const inlineKey = args["api-key"];
    if (inlineKey !== undefined) {
      await runApiKeyLogin(inlineKey);
      return;
    }
    await runOAuthLogin();
  },
});

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
    process.exit(1);
  }

  await reportIdentity();
}

// fallow-ignore-next-line complexity
async function reportIdentity(): Promise<void> {
  const { trackAuthLoginCompleted, trackAuthLoginFailed } =
    await import("../../telemetry/index.js");
  const credential = await tryResolveCredential();
  if (!credential) {
    trackAuthLoginFailed("oauth", "no_credential");
    console.error(c.warn("Sign-in completed but no credential was persisted."));
    process.exit(1);
  }
  // A resolvable credential IS the success signal: the tokens are on disk and
  // usable. The `/v3/users/me` probe below only fetches a display name, so its
  // outcome is cosmetic and does not gate completion.
  trackAuthLoginCompleted("oauth");
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
    const identity = userDisplayName(toStoredUserInfo(user)) ?? "(unknown user)";
    console.log(c.success(`✓ Signed in as ${identity}.`));
  } catch (err) {
    // Don't roll back — the OAuth tokens are valid on disk; this is a
    // transient verify-side issue. The identity probe failed, so any
    // stale user block from a prior login (possibly a DIFFERENT account)
    // is cleared so `auth status` can't surface the wrong identity.
    await clearUserInfoBestEffort();
    console.error(
      c.warn(`Signed in. Identity check failed (transient): ${(err as Error).message}`),
    );
  }
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
  const { trackAuthLoginStarted, trackAuthLoginCompleted, trackAuthLoginFailed } =
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
    process.exit(1);
  }
  if (!key) {
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error("No API key provided."));
    process.exit(1);
  }
  if (!isHeaderSafe(key)) {
    // CR/LF in the value would smuggle headers when the key is sent
    // via `x-api-key`. The backend handles "wrong key" itself, but
    // header-injection has to be caught here.
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error("API key must not contain newline or control characters."));
    process.exit(1);
  }
  if (key.length < MIN_KEY_LENGTH) {
    trackAuthLoginFailed("api_key", "invalid_input");
    console.error(c.error(`API key looks too short (got ${key.length} chars).`));
    process.exit(1);
  }

  const previous = await snapshotStore();
  const next: Credentials = { ...previous, api_key: key };
  await writeStore(next);

  const verifyOk = await verifyAndReport(key);
  if (!verifyOk) {
    trackAuthLoginFailed("api_key", "rejected");
    await rollback(previous);
    process.exit(1);
  }
  trackAuthLoginCompleted("api_key");
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

// fallow-ignore-next-line complexity
async function verifyAndReport(key: string): Promise<boolean> {
  const client = new AuthClient();
  try {
    const user = await client.getCurrentUser({ type: "api_key", key, source: "file_json" });
    // Persist the friendly-display block next to the now-verified api_key
    // so `auth status` can show a recognizable identity. Best-effort.
    await persistUserInfo(user);
    const identity = userDisplayName(toStoredUserInfo(user)) ?? "(unknown user)";
    console.log(c.success(`✓ API key saved. Authenticated as ${identity}.`));
    return true;
  } catch (err) {
    if (isAuthError(err) && err.code === "UNAUTHENTICATED") {
      console.error(
        `${c.warn("HeyGen rejected the API key.")}\n` +
          `  ${c.dim(err.message)}\n` +
          `Run ${c.accent("hyperframes auth login --api-key")} again with a valid key.`,
      );
      return false;
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
