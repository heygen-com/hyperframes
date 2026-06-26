/**
 * Persistence + display helpers for the friendly-display `user` block in
 * the shared `~/.heygen/credentials` file.
 *
 * The `user` block is additive METADATA captured at login time from
 * `GET /v3/users/me` — NOT a credential. It lets `auth status` (and the
 * post-login "Logged in as ..." line) show a recognizable identity
 * without re-hitting the API on every invocation, and keeps working when
 * the API is unreachable.
 *
 * This file is SHARED with the Go `heygen` CLI, which writes the same
 * `user` block (see `heygen-cli/internal/auth/user_store.go`). Persisting
 * here goes through `readStore` / `writeStore`, which round-trip every
 * unrecognized key — so saving our user block never clobbers a key the
 * other CLI wrote.
 */

import { credentialPath } from "./paths.js";
import {
  readStore,
  writeStore,
  deleteStore,
  hasPreservedUnknownData,
  type StoredUserInfo,
} from "./store.js";

export type { StoredUserInfo } from "./store.js";

/** True when `u` carries no friendly fields worth surfacing. */
export function isUserInfoEmpty(u: StoredUserInfo): boolean {
  return !u.email && !u.first_name && !u.last_name && !u.username;
}

/**
 * Most friendly name available, in priority order:
 *   email > "first last" > first-only > last-only > username > undefined.
 * The "first-only" / "last-only" intermediates come from `combineName`,
 * which returns `first || last || ""` when only one of the two is present
 * (so a user with just a first name still resolves to that first name,
 * not straight to username). The caller falls back to its own marker
 * (e.g. "(unknown user)") on `undefined`. Mirrors `UserInfo.DisplayName()`
 * in heygen-cli.
 */
export function userDisplayName(u: StoredUserInfo): string | undefined {
  if (u.email) return u.email;
  const name = combineName(u.first_name, u.last_name);
  if (name) return name;
  return u.username || undefined;
}

/**
 * `"first last"` when both are present; otherwise `first || last || ""`
 * (one-sided fall-through), and `""` when neither is set. The empty-string
 * return is treated as falsy by `userDisplayName`, so it falls through to
 * `username`.
 */
function combineName(first?: string, last?: string): string {
  if (first && last) return `${first} ${last}`;
  return first || last || "";
}

/**
 * Persist the friendly-display block, preserving any co-located api_key /
 * oauth blocks and unknown/foreign keys. An all-empty `StoredUserInfo`
 * is a no-op (the caller should typically gate on `isUserInfoEmpty`
 * before calling, but we guard here too so a failed probe can't blank an
 * existing block by accident).
 *
 * A broken pre-existing file surfaces as a thrown `ErrInvalidStore` from
 * `readStore` — callers treat persistence as best-effort and warn rather
 * than fail the login.
 */
export async function saveUserInfo(info: StoredUserInfo, path = credentialPath()): Promise<void> {
  if (isUserInfoEmpty(info)) return;
  // readStore preserves co-located api_key / oauth blocks and any
  // unknown/foreign keys (captured on a hidden slot), so writing back
  // only attaches the user block. A legacy single-line plaintext file
  // parses into { api_key }, so this upgrades it to JSON in passing.
  const { credentials } = await readStore(path);
  credentials.user = { ...info };
  await writeStore(credentials, path);
}

/**
 * Read the friendly-display block. Returns `null` when the file is absent
 * or carries no `user` block (a pre-this-change login). Genuine parse
 * errors propagate so the caller can warn rather than silently pretend
 * the file is clean.
 */
export async function loadUserInfo(path = credentialPath()): Promise<StoredUserInfo | null> {
  const { credentials, source } = await readStore(path);
  if (source === "absent") return null;
  if (!credentials.user || isUserInfoEmpty(credentials.user)) return null;
  return credentials.user;
}

/**
 * Remove the friendly-display block, leaving any co-located credential
 * (and unknown/foreign keys) intact. When neither a known credential NOR
 * any preserved unknown/foreign data survives, the orphaned-metadata file
 * is removed entirely. A surviving unknown top-level key (a future
 * credential another CLI owns) keeps the file — deleting it would clobber
 * exactly the cross-CLI data the store machinery exists to preserve. A
 * no-op when there is nothing to clear.
 */
export async function clearUserInfo(path = credentialPath()): Promise<void> {
  const { credentials, source } = await readStore(path);
  if (source === "absent" || !credentials.user) return;
  delete credentials.user;
  if (!credentials.api_key && !credentials.oauth && !hasPreservedUnknownData(credentials)) {
    await deleteStore(path);
    return;
  }
  await writeStore(credentials, path);
}
