import { fetchMedia } from "../../../scripts/lib/media-fetch.mjs";
// heygen.mjs — vendored HeyGen REST helpers (auth + transport) for the audio
// pipeline. The credential resolver matches the hyperframes CLI auth: first
// usable source wins — a host gateway ($HEYGEN_API_BASE with its own
// $HEYGEN_API_KEY) → a host-injected OAuth $HEYGEN_ACCESS_TOKEN (Bearer) →
// $HEYGEN_API_KEY / $HYPERFRAMES_API_KEY → a nearby .env → ~/.heygen/
// credentials (oauth → Bearer, else api_key → X-Api-Key; $HEYGEN_CONFIG_DIR
// overrides the dir). $HEYGEN_API_BASE moves every request to that host, as it
// does for the heygen CLI; plain HTTP needs $HEYGEN_ALLOW_HTTP=1, as there.
// Vendored so the skill ships standalone. Pure node.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HEYGEN_BASE = "https://api.heygen.com/v3";

// The v3 base every request goes to: $HEYGEN_API_BASE when a host app names its own gateway (HyperFrames Desktop
// forwards it to HeyGen with the API key saved in its Settings), else HeyGen's public API. Plain HTTP carries the key
// in the clear, so it needs $HEYGEN_ALLOW_HTTP=1, the heygen CLI's own rule.
export function heygenBase() {
  const host = process.env.HEYGEN_API_BASE?.trim().replace(/\/+$/, "");
  if (!host) return HEYGEN_BASE;
  if (host.startsWith("http://") && process.env.HEYGEN_ALLOW_HTTP !== "1")
    throw new Error(
      `HEYGEN_API_BASE (${host}) uses HTTP, which sends the key in plaintext. Set HEYGEN_ALLOW_HTTP=1 to allow it.`,
    );
  return `${host}/v3`;
}

// No base override, or one on HeyGen's own hosts (a canary or dev API).
function heygenOwnBase() {
  const host = process.env.HEYGEN_API_BASE?.trim();
  if (!host) return true;
  try {
    const name = new URL(host).hostname;
    return name === "heygen.com" || name.endsWith(".heygen.com");
  } catch {
    return false;
  }
}

// A host gateway: the host named its own API base and the key that base accepts. It pays for every call, so it wins
// over any other credential the environment carries.
const hostGatewayKey = () =>
  process.env.HEYGEN_API_BASE?.trim() && process.env.HEYGEN_API_KEY
    ? process.env.HEYGEN_API_KEY
    : null;
export const HEYGEN_CLI_SOURCE_HEADERS = { "X-HeyGen-Source": "cli" };
// Tool-attribution sent on EVERY media-use HeyGen call regardless of auth type, so
// the backend can isolate media-use consumption from other free TTS / avatar video.
// Unconditional — a paying user's media-use call is still media-use — unlike the
// OAuth-only cli-source header above, which also gates the free allowance.
export const HEYGEN_CLIENT_SOURCE_HEADERS = { "X-HeyGen-Client-Source": "media-use" };

// A missing `.env`, or a `.env` folder (some home dirs have one), is no env file: null. Read without checking first,
// so the file cannot change between a check and the read.
function envFileText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) return null;
    throw error;
  }
}

// A host app sets these in the environment it spawns, never in a project file: a project's .env naming its own base
// would send the person's shell HEYGEN_API_KEY to that host.
const HOST_ONLY = new Set(["HEYGEN_API_BASE", "HEYGEN_ALLOW_HTTP"]);

// Walk up ≤5 dirs from startDir; load the first .env (shell env always wins).
export function loadEnvFromDir(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    const text = envFileText(join(dir, ".env"));
    if (text != null) {
      for (const raw of text.split("\n")) {
        let line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("export ")) line = line.slice(7).trim();
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (val.startsWith('"') || val.startsWith("'")) {
          const q = val[0];
          const end = val.indexOf(q, 1);
          val = end > 0 ? val.slice(1, end) : val.slice(1);
        }
        if (!HOST_ONLY.has(key) && !(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

// → { headers } | { expired: true } | null. Never throws.
export function heygenCredential() {
  const cred = resolveCredential();
  return cred?.unreadable ? null : cred;
}

// heygenCredential's answer, or { unreadable: { file, code } } when the credentials path exists but cannot be read
// (a folder, a locked ~/.heygen), so heygenAuthHeaders can say to fix that path: logging in again would fail there too.
// Read without checking first, so the file cannot change between a check and the read.
function resolveCredential() {
  const gatewayKey = hostGatewayKey();
  if (gatewayKey) return { headers: { "X-Api-Key": gatewayKey } };
  // Every other credential belongs to HeyGen: a base on any other host gets none of them.
  if (!heygenOwnBase()) return null;
  const accessToken = process.env.HEYGEN_ACCESS_TOKEN;
  if (accessToken) return { headers: { Authorization: `Bearer ${accessToken}` } };
  const envKey = process.env.HEYGEN_API_KEY || process.env.HYPERFRAMES_API_KEY;
  if (envKey) return { headers: { "X-Api-Key": envKey } };

  const file = join(process.env.HEYGEN_CONFIG_DIR || join(homedir(), ".heygen"), "credentials");
  let raw;
  try {
    raw = readFileSync(file, "utf8").trim();
  } catch (error) {
    return error.code === "ENOENT" ? null : { unreadable: { file, code: error.code } };
  }
  if (!raw) return null;
  if (!raw.startsWith("{")) return { headers: { "X-Api-Key": raw } };

  // A malformed credentials file (partial write / wrong shape) must degrade to
  // "no credential", not crash the engine at startup.
  let cred;
  try {
    cred = JSON.parse(raw);
  } catch {
    return null;
  }
  const oauth = cred.oauth;
  if (oauth?.access_token) {
    const expired = oauth.expires_at && new Date(oauth.expires_at).getTime() - 60_000 < Date.now();
    if (!expired) return { headers: { Authorization: `Bearer ${oauth.access_token}` } };
    if (!cred.api_key) return { expired: true };
  }
  if (cred.api_key) return { headers: { "X-Api-Key": cred.api_key } };
  return null;
}

// → "oauth" | "api_key" | null. Same oauth-vs-api-key check heygenAuthHeaders()
// makes internally, exposed on its own so callers that only need to *tag* the
// auth path (telemetry) don't have to parse headers back apart. Never throws:
// no credential (or an expired one) is just `null`, same as a fresh resolve
// with nothing to tag.
export function heygenAuthMethod() {
  const cred = heygenCredential();
  if (!cred?.headers) return null;
  return "Authorization" in cred.headers ? "oauth" : "api_key";
}

// → auth headers object, or throw with a fix hint.
export function heygenAuthHeaders() {
  const cred = resolveCredential();
  if (cred?.headers) {
    // Only tag OAuth (Bearer) traffic as cli-source — the backend uses it to
    // grant the free allowance for OAuth requests and ignores it for API-key
    // (X-Api-Key) traffic, where it's dead metadata.
    const isOauth = "Authorization" in cred.headers;
    return isOauth
      ? { ...cred.headers, ...HEYGEN_CLI_SOURCE_HEADERS, ...HEYGEN_CLIENT_SOURCE_HEADERS }
      : { ...cred.headers, ...HEYGEN_CLIENT_SOURCE_HEADERS };
  }
  if (cred?.unreadable)
    throw new Error(
      `HeyGen credentials at ${cred.unreadable.file} can't be read (${cred.unreadable.code}) — fix or remove that path, then run \`npx hyperframes auth login\``,
    );
  if (cred?.expired)
    throw new Error(
      "HeyGen OAuth token expired — run `npx hyperframes auth refresh` (or `npx hyperframes auth login`)",
    );
  throw new Error(
    "no HeyGen credentials — set $HEYGEN_API_KEY, or run `npx hyperframes auth login` (writes ~/.heygen/credentials)",
  );
}

// Authed JSON request against the v3 API; throws on a non-OK status.
export async function heygenJSON(path, { method = "GET", headers = {}, body } = {}) {
  const opts = { method, headers: { ...HEYGEN_CLIENT_SOURCE_HEADERS, ...headers } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${heygenBase()}${path}`, opts);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = `HeyGen ${method} ${path} → HTTP ${res.status}${detail ? `\n${detail.slice(0, 300)}` : ""}`;
    throw Object.assign(new Error(message), { status: res.status, body: detail });
  }
  // A DELETE may answer 204 with no body.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// HeyGen's own words for a failed call: its {"error":{"message"}}, else the raw body, else the error's message.
export function heygenMessage(e) {
  if (!e?.body) return e?.message ? String(e.message) : String(e);
  try {
    return JSON.parse(e.body).error?.message ?? e.body;
  } catch {
    return e.body;
  }
}

// Download a (presigned) URL to destPath; returns byte length.
export async function downloadTo(url, destPath) {
  const res = await fetchMedia(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}: ${String(url).slice(0, 80)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes);
  return bytes.length;
}

// Retrieval search over HeyGen's audio catalog (NOT generation). type =
// "music" | "sound_effects". Returns the ranked results array (best first); each
// item has a presigned `audio_url` (+ `duration`, `description`, `name`, `score`).
// `query` is required (≥1 char, empty → HTTP 400) and `limit` is capped at 50.
// `minScore`: omit to use the server default (0.7). That default is TOO HIGH for
// sound_effects — good SFX hits score ~0.5–0.67, so callers wanting SFX should
// pass a lower floor (~0.4); music scores high and is fine at the default.
export async function searchSounds(query, type, headers, { limit = 5, minScore } = {}) {
  const params = new URLSearchParams({ query, type, limit: String(limit) });
  if (minScore != null) params.set("min_score", String(minScore));
  const payload = await heygenJSON(`/audio/sounds?${params.toString()}`, { headers });
  // `data` comes back as a ranked array (best first). Older responses keyed it by
  // numeric index ("0","1",…); normalize both shapes to an array (empty → []).
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data);
  throw new Error(
    `unexpected /audio/sounds shape — top keys: ${Object.keys(payload ?? {}).join(", ")}`,
  );
}
