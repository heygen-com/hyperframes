/**
 * Read/write the shared `~/.heygen/credentials` file (JSON contents,
 * no `.json` extension — the path matches heygen-cli).
 *
 * Current format:
 *   {
 *     "api_key": "hg_...",
 *     "oauth": {
 *       "access_token": "...",
 *       "refresh_token": "...",
 *       "expires_at": "<ISO-8601 UTC>",
 *       "scope": "openid profile",
 *       "token_type": "Bearer"
 *     },
 *     "user": {
 *       "email": "...",
 *       "first_name": "...",
 *       "last_name": "...",
 *       "username": "..."
 *     }
 *   }
 *
 * Legacy: a single-line plaintext API key (the format heygen-cli has
 * written historically). If `JSON.parse` rejects the file, we treat the
 * trimmed contents as an API key; the next write upgrades to JSON.
 *
 * Writes go to a temp file + rename, 0600 mode, parent dir 0700.
 *
 * Cross-CLI forward compatibility: this file is SHARED with the Go
 * `heygen` CLI (and any future tool). Either CLI may write keys this
 * version doesn't model yet. To avoid one CLI silently clobbering the
 * other's data on round-trip, the reader stashes every unrecognized
 * top-level key (and every unrecognized key inside the `oauth` / `user`
 * sub-objects) into a hidden passthrough bag, and the writer re-emits
 * them verbatim. Known fields are still strictly validated; the
 * passthrough is purely additive and never feeds an HTTP header.
 *
 * The same contract binds the destructive paths (`clearOAuth`,
 * `clearUserInfo`, and the failed `auth login --api-key` rollback): when
 * removing a credential would leave the file with no known credential but
 * a surviving unknown/foreign top-level (or user-block) key, they write
 * the credential-less remnant rather than deleting the file — see
 * `hasPreservedUnknownData`. Deleting there would clobber exactly the
 * cross-CLI data this machinery exists to preserve.
 */

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { credentialPath } from "./paths.js";
import { ErrInvalidStore } from "./errors.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/**
 * Symbol-keyed slot holding the raw JSON of any keys this CLI version
 * doesn't model, captured at read time and re-emitted verbatim at write
 * time. A symbol (rather than a string key) keeps it off the typed
 * surface so callers can't accidentally read/write it, and `Object.keys`
 * / `JSON.stringify` skip it. See the module header for the rationale.
 */
const UNKNOWN = Symbol("hf.credentials.unknownFields");

/** Keys this CLI version models at the top level of the credentials file. */
const KNOWN_ROOT_KEYS = new Set(["api_key", "oauth", "user"]);
/** Keys this CLI version models inside the `oauth` sub-object. */
const KNOWN_OAUTH_KEYS = new Set([
  "access_token",
  "refresh_token",
  "expires_at",
  "scope",
  "token_type",
]);
/** Keys this CLI version models inside the `user` sub-object. */
const KNOWN_USER_KEYS = new Set(["email", "first_name", "last_name", "username"]);

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  /** ISO-8601 UTC. */
  expires_at?: string;
  scope?: string;
  token_type?: string;
  /** Unknown/future keys captured for cross-CLI round-trip. */
  [UNKNOWN]?: Record<string, unknown>;
}

/**
 * Friendly-display metadata captured at login time from `/v3/users/me`.
 * NOT a credential — additive identity info persisted alongside the
 * credential so `auth status` can show "Logged in as ..." without
 * re-hitting the API. All fields optional; a file with no `user` block
 * (a pre-this-change login) is fully backwards-compatible. Mirrors the
 * `user` block heygen-cli writes — see `internal/auth/user_store.go`.
 */
export interface StoredUserInfo {
  email?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  /** Unknown/future keys captured for cross-CLI round-trip. */
  [UNKNOWN]?: Record<string, unknown>;
}

export interface Credentials {
  api_key?: string;
  oauth?: OAuthTokens;
  user?: StoredUserInfo;
  /** Unknown/future top-level keys captured for cross-CLI round-trip. */
  [UNKNOWN]?: Record<string, unknown>;
}

export type StoreSource = "file_json" | "file_legacy" | "absent";

export interface ReadResult {
  credentials: Credentials;
  source: StoreSource;
}

export async function readStore(path = credentialPath()): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { credentials: {}, source: "absent" };
    }
    throw ErrInvalidStore(`unable to read ${path}: ${(err as Error).message}`);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { credentials: {}, source: "absent" };

  if (trimmed.startsWith("{")) {
    return { credentials: parseJsonStore(trimmed), source: "file_json" };
  }

  if (looksLikeApiKey(trimmed)) {
    return { credentials: { api_key: trimmed }, source: "file_legacy" };
  }

  throw ErrInvalidStore("file is not JSON and does not look like a plain API key");
}

export async function writeStore(credentials: Credentials, path = credentialPath()): Promise<void> {
  await ensureDir(dirname(path));
  const body = JSON.stringify(serializeCredentials(credentials), null, 2);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${body}\n`, { mode: FILE_MODE, encoding: "utf8" });
  // `mode` on `writeFile` is masked by umask and only applies on file
  // creation — explicit chmod is the only reliable way to land on 0600.
  // `rename` moves the (already-0600) tmp inode over the destination,
  // so the final file carries the tmp's mode; no post-rename chmod
  // needed even when overwriting a looser-permissioned file.
  await fs.chmod(tmp, FILE_MODE);
  await fs.rename(tmp, path);
}

export async function deleteStore(path = credentialPath()): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

/**
 * True when `credentials` carries any unrecognized/foreign data captured
 * on a hidden passthrough slot — either a top-level unknown key, or an
 * unknown key inside the `oauth` / `user` sub-objects.
 *
 * The cleanup / rollback paths (`clearOAuth`, `clearUserInfo`, the failed
 * `auth login --api-key` rollback) use this to decide between deleting the
 * file and writing a credential-less remnant. When no known credential
 * survives BUT foreign data does, that data may be a future credential or
 * metadata key another CLI owns — deleting the file would clobber exactly
 * what the cross-CLI forward-compatibility contract promises to preserve.
 * So those paths write the remaining record (carrying the unknown bag)
 * instead of deleting. Only when nothing worth preserving remains do they
 * delete.
 */
export function hasPreservedUnknownData(credentials: Credentials): boolean {
  if (hasUnknownBag(credentials[UNKNOWN])) return true;
  if (hasUnknownBag(credentials.oauth?.[UNKNOWN])) return true;
  if (hasUnknownBag(credentials.user?.[UNKNOWN])) return true;
  return false;
}

function hasUnknownBag(bag: Record<string, unknown> | undefined): boolean {
  return bag !== undefined && Object.keys(bag).length > 0;
}

/** Remove only the `oauth` block. Used by `auth logout --keep-api-key`. */
export async function clearOAuth(path = credentialPath()): Promise<void> {
  const { credentials, source } = await readStore(path);
  if (source === "absent" || !credentials.oauth) return;
  // Drop oauth, keep everything else (api_key, the friendly-display
  // user block, and any unknown/foreign keys) so a logout that only
  // clears the OAuth session doesn't silently wipe co-located data.
  const next: Credentials = { ...credentials };
  delete next.oauth;
  if (!next.api_key && !hasPreservedUnknownData(next)) {
    // Nothing worth preserving survives. The leftover user block had no
    // friendly fields and there's no foreign/unknown data to round-trip,
    // so this is orphaned metadata with no credential to attach to — drop
    // the file. (A surviving top-level / user-block unknown key, by
    // contrast, may be a future credential another CLI owns, so we keep
    // the file in that case.)
    await deleteStore(path);
    return;
  }
  await writeStore(next, path);
}

async function ensureDir(dir: string): Promise<void> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw ErrInvalidStore(`${dir} exists and is not a directory`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
  }
  try {
    await fs.chmod(dir, DIR_MODE);
  } catch {
    /* perm-less filesystems are fine */
  }
}

function parseJsonStore(text: string): Credentials {
  const obj = parseJsonObject(text, "credential file root");
  const out: Credentials = {};
  const apiKey = pickRequiredStringOrAbsent(obj, "api_key", "api_key");
  if (apiKey !== undefined) {
    if (!isHeaderSafe(apiKey)) {
      throw ErrInvalidStore("api_key must not contain control characters");
    }
    out.api_key = apiKey;
  }
  if (obj["oauth"] !== undefined && obj["oauth"] !== null) {
    out.oauth = parseOAuth(obj["oauth"]);
  }
  if (obj["user"] !== undefined && obj["user"] !== null) {
    out.user = parseUser(obj["user"]);
  }
  // Capture any top-level keys this CLI version doesn't model so the
  // next write round-trips them instead of dropping another CLI's data.
  const unknownRoot = collectUnknown(obj, KNOWN_ROOT_KEYS);
  if (unknownRoot) out[UNKNOWN] = unknownRoot;
  return out;
}

/** Optional-field picker variants used by the data-driven parsers. */
type FieldPicker = "header_safe" | "non_empty";

const PICKERS: Record<
  FieldPicker,
  (obj: Record<string, unknown>, key: string) => string | undefined
> = {
  header_safe: pickHeaderSafeString,
  non_empty: pickNonEmptyString,
};

/**
 * Copy each `[field, picker]` from `obj` onto `out` when the picker
 * yields a value. Data-driven so the optional-field handling stays a
 * single loop instead of a long if-chain per parser. `out` is written
 * through an index cast — the `spec` field names are the contract that
 * keeps the assignments type-correct at the call site.
 */
function assignOptionalStrings(
  out: object,
  obj: Record<string, unknown>,
  spec: readonly [string, FieldPicker][],
): void {
  const target = out as Record<string, unknown>;
  for (const [field, picker] of spec) {
    const v = PICKERS[picker](obj, field);
    if (v) target[field] = v;
  }
}

const OAUTH_OPTIONAL: readonly [string, FieldPicker][] = [
  ["refresh_token", "header_safe"],
  ["expires_at", "non_empty"],
  ["scope", "non_empty"],
  ["token_type", "non_empty"],
];

function parseOAuth(raw: unknown): OAuthTokens {
  const obj = asJsonObject(raw, "oauth");
  const accessToken = pickHeaderSafeString(obj, "access_token");
  if (!accessToken) {
    throw ErrInvalidStore("oauth.access_token must be a non-empty string with no control chars");
  }
  const out: OAuthTokens = { access_token: accessToken };
  assignOptionalStrings(out, obj, OAUTH_OPTIONAL);
  const unknownOAuth = collectUnknown(obj, KNOWN_OAUTH_KEYS);
  if (unknownOAuth) out[UNKNOWN] = unknownOAuth;
  return out;
}

const USER_OPTIONAL: readonly [string, FieldPicker][] = [
  ["email", "non_empty"],
  ["first_name", "non_empty"],
  ["last_name", "non_empty"],
  ["username", "non_empty"],
];

/**
 * Parse the friendly-display `user` block. Every field is optional and
 * lenient — a wrong-typed or empty value is simply skipped rather than
 * rejected, because this is additive METADATA, not a credential, and a
 * malformed sub-field must never block resolving a perfectly good
 * api_key / oauth token. (Contrast with `parseOAuth`, where a missing
 * access_token is a hard error.) Unknown keys round-trip.
 */
function parseUser(raw: unknown): StoredUserInfo {
  const obj = asJsonObject(raw, "user");
  const out: StoredUserInfo = {};
  assignOptionalStrings(out, obj, USER_OPTIONAL);
  const unknownUser = collectUnknown(obj, KNOWN_USER_KEYS);
  if (unknownUser) out[UNKNOWN] = unknownUser;
  return out;
}

/** Narrow `raw` to a plain JSON object or throw a labelled error. */
function asJsonObject(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw ErrInvalidStore(`${label} must be a JSON object`);
  }
  return raw as Record<string, unknown>;
}

/**
 * Return a shallow copy of every entry in `obj` whose key is not in
 * `known`, or `undefined` when there are none. Used to capture
 * unrecognized JSON for verbatim re-emission on the next write.
 */
function collectUnknown(
  obj: Record<string, unknown>,
  known: Set<string>,
): Record<string, unknown> | undefined {
  let bag: Record<string, unknown> | undefined;
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;
    (bag ??= {})[key] = obj[key];
  }
  return bag;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw ErrInvalidStore(`invalid JSON: ${(err as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw ErrInvalidStore(`${label} must be a JSON object`);
  }
  return raw as Record<string, unknown>;
}

function pickNonEmptyString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Like `pickNonEmptyString` but rejects values containing control chars. */
function pickHeaderSafeString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = pickNonEmptyString(obj, key);
  return v !== undefined && isHeaderSafe(v) ? v : undefined;
}

/**
 * Header-safety check for credential strings: reject any string with
 * CR, LF, NUL, or other C0 control characters. Without this, a
 * malicious credentials.json could smuggle extra request headers via
 * `Authorization` / `x-api-key` (RFC 7230 header injection).
 */
export function isHeaderSafe(s: string): boolean {
  // Reject U+0000-U+001F (C0 controls) and U+007F (DEL) — bytes that
  // aren't allowed in HTTP header values. Using charCodeAt avoids
  // embedding control characters in regex source (lint requirement).
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/**
 * Strict variant: returns the string when present and non-empty,
 * `undefined` when the key is absent or null, and throws when the
 * field is present-but-invalid (wrong type or empty string).
 */
function pickRequiredStringOrAbsent(
  obj: Record<string, unknown>,
  key: string,
  errorLabel: string,
): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) {
    throw ErrInvalidStore(`${errorLabel} must be a non-empty string`);
  }
  return v;
}

function serializeCredentials(c: Credentials): Record<string, unknown> {
  // Re-emit unrecognized top-level keys first so the known fields below
  // are authoritative (collectUnknown already excludes known keys, so
  // there's no real collision — this is belt-and-suspenders).
  const out: Record<string, unknown> = { ...(c[UNKNOWN] ?? {}) };
  if (c.api_key) out["api_key"] = c.api_key;
  if (c.oauth) out["oauth"] = serializeOAuth(c.oauth);
  if (c.user) {
    const user = serializeUser(c.user);
    // Omit an all-empty user block entirely (no empty `"user": {}` litter).
    if (Object.keys(user).length > 0) out["user"] = user;
  }
  return out;
}

function serializeOAuth(o: OAuthTokens): Record<string, unknown> {
  const oauth: Record<string, unknown> = { ...(o[UNKNOWN] ?? {}) };
  oauth["access_token"] = o.access_token;
  if (o.refresh_token) oauth["refresh_token"] = o.refresh_token;
  if (o.expires_at) oauth["expires_at"] = o.expires_at;
  if (o.scope) oauth["scope"] = o.scope;
  if (o.token_type) oauth["token_type"] = o.token_type;
  return oauth;
}

function serializeUser(u: StoredUserInfo): Record<string, unknown> {
  const user: Record<string, unknown> = { ...(u[UNKNOWN] ?? {}) };
  if (u.email) user["email"] = u.email;
  if (u.first_name) user["first_name"] = u.first_name;
  if (u.last_name) user["last_name"] = u.last_name;
  if (u.username) user["username"] = u.username;
  return user;
}

/**
 * Legacy-plaintext heuristic. HeyGen API keys come in multiple formats
 * (`sk_V2_…`, historic `hg_…`, partner keys, etc.) and the CLI should
 * NOT shape-check them — the backend's `/v3/users/me` is the source of
 * truth and the existing `auth login` rollback handles bad keys cleanly.
 * We only require: a single line, printable, of reasonable length, and
 * header-safe (no CR/LF). JSON files are detected separately by the
 * leading `{`, so this path can't swallow a JSON fragment.
 */
function looksLikeApiKey(s: string): boolean {
  if (s.length < 8) return false;
  if (!isHeaderSafe(s)) return false;
  // Single line of printable ASCII (excluding space, since real keys
  // don't contain spaces — a space-bearing blob is almost certainly
  // not a credential).
  return /^[!-~]+$/.test(s);
}
