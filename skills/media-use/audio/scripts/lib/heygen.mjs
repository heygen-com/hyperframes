// heygen.mjs — vendored HeyGen REST helpers (auth + transport) for the audio
// pipeline. The credential resolver matches the hyperframes CLI auth: first
// usable source wins — $HEYGEN_API_KEY / $HYPERFRAMES_API_KEY → a nearby .env → ~/.heygen/
// credentials (oauth → Bearer, else api_key → X-Api-Key; $HEYGEN_CONFIG_DIR
// overrides the dir). Vendored so the skill ships standalone. Pure node.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HEYGEN_BASE = "https://api.heygen.com/v3";
const HEYGEN_OAUTH_TOKEN_URL =
  process.env.HYPERFRAMES_OAUTH_TOKEN_URL || "https://api2.heygen.com/v1/oauth/token";
const HEYGEN_OAUTH_CLIENT_ID =
  process.env.HYPERFRAMES_OAUTH_CLIENT_ID || "q2A2QRSke2LrFTPJhoDbHtXh";
export const HEYGEN_CLI_SOURCE_HEADERS = { "X-HeyGen-Source": "cli" };
// Tool-attribution sent on EVERY media-use HeyGen call regardless of auth type, so
// the backend can isolate media-use consumption from other free TTS / avatar video.
// Unconditional — a paying user's media-use call is still media-use — unlike the
// OAuth-only cli-source header above, which also gates the free allowance.
export const HEYGEN_CLIENT_SOURCE_HEADERS = { "X-HeyGen-Client-Source": "media-use" };

// Walk up ≤5 dirs from startDir; load the first .env (shell env always wins).
export function loadEnvFromDir(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      for (const raw of readFileSync(envPath, "utf8").split("\n")) {
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
        if (!(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

// → { headers } | { expired: true } | { refreshable: true, ... } | null. Never throws.
export function heygenCredential() {
  const envKey = process.env.HEYGEN_API_KEY || process.env.HYPERFRAMES_API_KEY;
  if (envKey) return { headers: { "X-Api-Key": envKey } };

  const file = join(process.env.HEYGEN_CONFIG_DIR || join(homedir(), ".heygen"), "credentials");
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return null;
  if (!raw.startsWith("{")) return { headers: { "X-Api-Key": raw } };

  // A malformed credentials file (partial write / wrong shape) must degrade to
  // "no credential", not crash the engine at startup — this function never throws.
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
    if (oauth.refresh_token) return { expired: true, refreshable: true, file, credentials: cred };
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
  const cred = heygenCredential();
  if (cred?.headers) {
    // Only tag OAuth (Bearer) traffic as cli-source — the backend uses it to
    // grant the free allowance for OAuth requests and ignores it for API-key
    // (X-Api-Key) traffic, where it's dead metadata.
    const isOauth = "Authorization" in cred.headers;
    return isOauth
      ? { ...cred.headers, ...HEYGEN_CLI_SOURCE_HEADERS, ...HEYGEN_CLIENT_SOURCE_HEADERS }
      : { ...cred.headers, ...HEYGEN_CLIENT_SOURCE_HEADERS };
  }
  if (cred?.expired)
    throw new Error(
      "HeyGen OAuth token expired — run `npx hyperframes auth refresh` (or `npx hyperframes auth login`)",
    );
  throw new Error(
    "no HeyGen credentials — set $HEYGEN_API_KEY, or run `npx hyperframes auth login` (writes ~/.heygen/credentials)",
  );
}

// Resolve auth for a network request, silently renewing an expired OAuth token
// when the persisted credential includes a refresh token. Access tokens remain
// short-lived; the refresh token provides the no-prompt UX without weakening
// OAuth's revocation and expiry guarantees.
export async function heygenAuthHeadersWithRefresh(fetchImpl = fetch) {
  const cred = heygenCredential();
  if (!cred?.refreshable) return heygenAuthHeaders();

  const oauth = cred.credentials.oauth;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: oauth.refresh_token,
    client_id: HEYGEN_OAUTH_CLIENT_ID,
  });
  const res = await fetchImpl(HEYGEN_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `HeyGen OAuth refresh failed (HTTP ${res.status}) — run \`npx hyperframes auth login\``,
    );
  }
  const payload = await res.json().catch(() => null);
  const accessToken = payload?.access_token;
  if (typeof accessToken !== "string" || !accessToken || /[\r\n\0]/.test(accessToken)) {
    throw new Error(
      "HeyGen OAuth refresh returned an invalid access token — run `npx hyperframes auth login`",
    );
  }

  const expiresIn = Number(payload.expires_in);
  const renewed = {
    ...oauth,
    access_token: accessToken,
    refresh_token: payload.refresh_token || oauth.refresh_token,
  };
  if (typeof payload.token_type === "string" && payload.token_type) {
    renewed.token_type = payload.token_type;
  }
  if (typeof payload.scope === "string" && payload.scope) renewed.scope = payload.scope;
  if (Number.isFinite(expiresIn)) {
    renewed.expires_at = new Date(Date.now() + Math.max(expiresIn, 30) * 1000).toISOString();
  } else {
    delete renewed.expires_at;
  }
  const saved = { ...cred.credentials, oauth: renewed };
  writeFileSync(cred.file, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  return {
    Authorization: `Bearer ${accessToken}`,
    ...HEYGEN_CLI_SOURCE_HEADERS,
    ...HEYGEN_CLIENT_SOURCE_HEADERS,
  };
}

// Authed JSON request against the v3 API; throws on a non-OK status.
export async function heygenJSON(path, { method = "GET", headers = {}, body } = {}) {
  const opts = { method, headers: { ...HEYGEN_CLIENT_SOURCE_HEADERS, ...headers } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${HEYGEN_BASE}${path}`, opts);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `HeyGen ${method} ${path} → HTTP ${res.status}${detail ? `\n${detail.slice(0, 300)}` : ""}`,
    );
  }
  return res.json();
}

// Download a (presigned) URL to destPath; returns byte length.
export async function downloadTo(url, destPath) {
  const res = await fetch(url);
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
