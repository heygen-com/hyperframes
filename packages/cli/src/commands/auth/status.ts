import { failCommand, setCommandExitCode } from "../../utils/commandResult.js";
/**
 * `hyperframes auth status` — print the active credential's source,
 * type, and identity (verified against `GET /v3/users/me`).
 *
 * Exits non-zero when nothing is configured or the API rejects the
 * credential, so scripts can check "am I logged in?" with `$?`.
 *
 * When nothing is configured the output is onboarding-first: an
 * interactive session (a TTY, or a coding agent driving the CLI) gets
 * registration guidance led by `hyperframes auth login` — sign-in and
 * sign-up are the same OAuth step — while CI / non-interactive runs get
 * a terse note and continue on local fallbacks. This is the shared
 * preflight every TTS/BGM workflow relays, so the wording lives in one
 * place instead of each workflow improvising its own.
 */

import { defineCommand } from "citty";
import {
  AuthClient,
  isAuthError,
  loadUserInfo,
  refreshTokens,
  tryResolveCredential,
  userDisplayName,
  type ResolvedCredential,
  type StoredUserInfo,
  type UserInfo,
} from "../../auth/index.js";
import { getSystemMeta } from "../../telemetry/system.js";
import { c } from "../../ui/colors.js";
import { resolveMusic, resolveVoice } from "../../audio/providers.js";
import {
  buildUnconfiguredJson,
  buildUnconfiguredLines,
  type OfflineEngineLine,
  type UnconfiguredContext,
} from "./status-guidance.js";

interface VerifiedStatus {
  credential: ResolvedCredential;
  user: UserInfo | null;
  /**
   * The friendly-display block persisted at login time, when the active
   * credential is file-sourced and a block is on disk. `null` for
   * env-sourced credentials (the on-disk block could belong to a
   * different key) and for pre-this-change credentials files.
   */
  persistedUser: StoredUserInfo | null;
  apiError: string | null;
}

/** True for credentials resolved from the shared file (not env). */
function isFileSource(source: ResolvedCredential["source"]): boolean {
  return source === "file_json" || source === "file_legacy";
}

export default defineCommand({
  meta: { name: "status", description: "Show the active HeyGen credential" },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON",
      default: false,
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const asJson = Boolean(args.json);
    let credential;
    try {
      credential = await tryResolveCredential();
    } catch (err) {
      handleResolveError(err, asJson);
      return;
    }
    if (!credential) {
      handleUnconfigured(asJson);
      return;
    }

    const status = await verify(credential);
    if (asJson) printJsonStatus(status);
    else printHumanStatus(status);
    setCommandExitCode(status.apiError ? 1 : 0);
  },
});

/**
 * Decide whether to show full onboarding guidance or a terse note.
 * CI is never "interactive" even on a TTY; an agent runtime counts as
 * interactive because a human is watching its relayed output.
 */
function detectUnconfiguredContext(): UnconfiguredContext {
  const sys = getSystemMeta();
  return { interactive: !sys.is_ci && (sys.is_tty || sys.agent_runtime !== null) };
}

/**
 * Probe the local voice/music engines a workflow would fall back to.
 * `hasHeygen` is false here by construction — we only reach this when no
 * credential resolved — so this reports the offline engines and whether
 * their Python deps are installed.
 */
function collectOfflineEngines(): OfflineEngineLine[] {
  const voice = resolveVoice(false);
  const music = resolveMusic(false);
  return [
    { capability: "voice", label: voice.label, ready: voice.ready, ...hint(voice.setupHint) },
    { capability: "music", label: music.label, ready: music.ready, ...hint(music.setupHint) },
  ];
}

function hint(setupHint: string | undefined): { setupHint?: string } {
  return setupHint ? { setupHint } : {};
}

function handleUnconfigured(asJson: boolean): never {
  const ctx = detectUnconfiguredContext();
  // Probe engines for JSON (skills parse it) and interactive guidance; skip
  // the Python probes for terse non-interactive/CI output to stay fast.
  const engines = asJson || ctx.interactive ? collectOfflineEngines() : undefined;
  const output = asJson
    ? JSON.stringify(buildUnconfiguredJson(ctx, engines))
    : buildUnconfiguredLines(ctx, engines).join("\n");
  console.log(output);
  failCommand();
}

// fallow-ignore-next-line complexity
function handleResolveError(err: unknown, asJson: boolean): never {
  if (!isAuthError(err)) throw err;
  if (asJson) {
    console.log(JSON.stringify({ configured: false, error: err.message, hint: err.hint ?? null }));
  } else {
    console.error(c.error(err.message));
    if (err.hint) console.error(c.dim(err.hint));
  }
  failCommand();
}

async function verify(credential: ResolvedCredential): Promise<VerifiedStatus> {
  const client = new AuthClient({
    // Return the full new token set so the retry's credential carries
    // a rotated refresh_token forward (defends against IdPs that
    // invalidate the old RT on every refresh).
    onUnauthenticatedRefresh: async (rt) => await refreshTokens(rt),
  });
  const persistedUser = await loadPersistedUser(credential);
  try {
    const user = await client.getCurrentUser(credential);
    return { credential, user, persistedUser, apiError: null };
  } catch (err) {
    if (!isAuthError(err)) throw err;
    return {
      credential,
      user: null,
      persistedUser,
      apiError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load the persisted friendly-display block, but only for file-sourced
 * credentials. An env credential (`HEYGEN_API_KEY` / `HYPERFRAMES_API_KEY`)
 * could belong to a different key than the on-disk block, so surfacing
 * that block would mislabel the active account. A read error is swallowed
 * — the block is purely cosmetic and must never break `auth status`.
 */
async function loadPersistedUser(credential: ResolvedCredential): Promise<StoredUserInfo | null> {
  if (!isFileSource(credential.source)) return null;
  try {
    return await loadUserInfo();
  } catch {
    return null;
  }
}

function printJsonStatus(s: VerifiedStatus): void {
  const payload: Record<string, unknown> = {
    configured: true,
    source: s.credential.source,
    type: s.credential.type,
    user: s.user,
    // The friendly-display block persisted at login (file-sourced creds
    // only). Strictly additive — the live `user` field above is
    // unchanged. Lets callers read identity offline / on an API blip.
    persisted_user: persistedUserJson(s.persistedUser),
    api_error: s.apiError,
  };
  if (s.credential.type === "oauth") {
    payload["expires_at"] = s.credential.expires_at?.toISOString() ?? null;
    payload["refreshable"] = s.credential.refreshable;
    payload["scope"] = s.credential.scope ?? null;
  }
  console.log(JSON.stringify(payload, null, 2));
}

/**
 * Shape the persisted block for JSON: the four optional fields plus the
 * resolved `display_name` (email > "first last" > username). Returns
 * `null` when nothing is persisted so the field is an explicit null
 * rather than an empty object.
 */
function persistedUserJson(u: StoredUserInfo | null): Record<string, unknown> | null {
  if (!u) return null;
  const display = userDisplayName(u);
  return {
    email: u.email ?? null,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    username: u.username ?? null,
    display_name: display ?? null,
  };
}

function printHumanStatus(s: VerifiedStatus): void {
  const rows = collectStatusRows(s);
  for (const [label, value] of rows) console.log(`${c.bold(label)} ${value}`);
}

// fallow-ignore-next-line complexity
function collectStatusRows(s: VerifiedStatus): [string, string][] {
  const rows: [string, string][] = [
    ["Source:", describeSource(s.credential.source)],
    ["Type:  ", s.credential.type === "oauth" ? "oauth" : "api_key"],
  ];
  if (s.credential.type === "oauth") rows.push(...oauthRows(s.credential));
  if (s.apiError) {
    rows.push([c.error("API check failed:"), s.apiError]);
    // Fall back to the persisted identity so the user still sees who
    // they're logged in as when the live probe is unreachable.
    const cached = s.persistedUser && userDisplayName(s.persistedUser);
    if (cached) rows.push(["Account:", `${cached} ${c.dim("(cached)")}`]);
    return rows;
  }
  if (s.user) rows.push(...identityRows(s.user));
  return rows;
}

// fallow-ignore-next-line complexity
function oauthRows(credential: Extract<ResolvedCredential, { type: "oauth" }>): [string, string][] {
  const rows: [string, string][] = [];
  if (credential.expires_at) {
    const fresh = credential.expires_at.getTime() > Date.now();
    const tag = fresh ? c.success("(valid)") : c.warn("(expired)");
    const refresh = credential.refreshable ? c.dim(" · refreshable") : "";
    rows.push(["Expires:", `${credential.expires_at.toISOString()} ${tag}${refresh}`]);
  }
  if (credential.scope) rows.push(["Scope: ", credential.scope]);
  return rows;
}

function identityRows(user: UserInfo): [string, string][] {
  const identity = user.email ?? user.username ?? "(unknown user)";
  return [["Account:", identity], ...billingRows(user)];
}

const SOURCE_LABELS: Record<ResolvedCredential["source"], string> = {
  env: "env (HEYGEN_API_KEY)",
  env_alias: "env (HYPERFRAMES_API_KEY)",
  file_legacy: "file (~/.heygen/credentials — legacy plaintext)",
  file_json: "file (~/.heygen/credentials)",
};

function describeSource(source: ResolvedCredential["source"]): string {
  return SOURCE_LABELS[source];
}

function billingRows(user: UserInfo): [string, string][] {
  const rows: [string, string][] = [];
  if (user.billing_type) rows.push(["Billing:", user.billing_type]);
  pushWalletRow(rows, user);
  pushSubscriptionRows(rows, user);
  pushUsageRow(rows, user);
  return rows;
}

// fallow-ignore-next-line complexity
function pushWalletRow(rows: [string, string][], user: UserInfo): void {
  const balance = user.wallet?.remaining_balance;
  if (balance === undefined) return;
  const currency = user.wallet?.currency ? ` ${user.wallet.currency}` : "";
  rows.push(["Wallet: ", `${balance}${currency}`]);
}

// fallow-ignore-next-line complexity
function pushSubscriptionRows(rows: [string, string][], user: UserInfo): void {
  if (user.subscription?.plan) rows.push(["Plan:   ", user.subscription.plan]);
  pushCreditRow(rows, "Premium credits:", user.subscription?.credits?.premium_credits);
  pushCreditRow(rows, "Add-on credits: ", user.subscription?.credits?.add_on_credits);
}

// fallow-ignore-next-line complexity
function pushCreditRow(
  rows: [string, string][],
  label: string,
  credit: { remaining?: number; resets_at?: string } | undefined,
): void {
  if (!credit || credit.remaining === undefined) return;
  const resets = credit.resets_at ? ` (resets ${credit.resets_at.slice(0, 10)})` : "";
  rows.push([label, `${credit.remaining}${resets}`]);
}

// fallow-ignore-next-line complexity
function pushUsageRow(rows: [string, string][], user: UserInfo): void {
  const current = user.usage_based?.spending_current_usd;
  if (current === undefined) return;
  const cap = user.usage_based?.spending_cap_usd;
  const capPart = cap !== undefined ? ` / $${cap}` : "";
  rows.push(["Usage:  ", `$${current}${capPart}`]);
}
