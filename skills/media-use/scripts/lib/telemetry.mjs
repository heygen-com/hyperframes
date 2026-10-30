// Usage tracking shares the CLI and Studio identity. Properties stay coarse and
// never carry intent text, file names, or paths.

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { withFileLock } from "./config-lock.mjs";
import { globalMediaDir } from "./media-home.mjs";

const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 1500;
let identifiedAccount = false;
let warnedNonDefaultHost = false;

function isTestOrCiContext() {
  return (
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development"
  );
}

function posthogHost() {
  const override = process.env.MEDIA_USE_TELEMETRY_HOST;
  if (override && !warnedNonDefaultHost && !isTestOrCiContext()) {
    warnedNonDefaultHost = true;
    console.error(
      `media-use: telemetry is redirected to a non-default host via MEDIA_USE_TELEMETRY_HOST (${override}) — unset it unless this is intentional.`,
    );
  }
  return override || POSTHOG_HOST;
}

/** True when telemetry must NOT be sent (opt-out envs, CI, dev, shared config). */
export function optedOut() {
  return (
    // `hyperframes telemetry disable` writes telemetryEnabled: false to the
    // shared config; one opt-out must cover the CLI and the media-use scripts.
    readSharedConfig().telemetryEnabled === false ||
    process.env.HYPERFRAMES_NO_TELEMETRY === "1" ||
    process.env.DO_NOT_TRACK === "1" ||
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.NODE_ENV === "development"
  );
}

// Read and write the shared config so media-use keeps one identity per install.
function sharedConfigPath() {
  return join(homedir(), ".hyperframes", "config.json");
}

function readSharedConfig() {
  try {
    const file = sharedConfigPath();
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // unreadable config → treat as empty; never throw
  }
  return {};
}

// Best effort: skipped when the lock cannot be taken or the file cannot be read, never written unlocked.
function updateSharedConfig(patch) {
  const file = sharedConfigPath();
  mkdirSync(dirname(file), { recursive: true });
  try {
    withFileLock(`${file}.lock`, fs, () => {
      let config = {};
      try {
        config = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") return;
      }
      if (!config || typeof config !== "object" || Array.isArray(config)) return;
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...config, ...patch }, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, file);
    });
  } catch {}
}

// Adopt a pre-existing media-use-only id (~/.media/anon-id from before this
// change) so upgraders keep their PostHog persona instead of resetting to a new
// one — otherwise cross-surface continuity would start over on upgrade.
function legacyMediaAnonId() {
  try {
    const file = join(globalMediaDir(), "anon-id");
    if (existsSync(file)) {
      const id = readFileSync(file, "utf8").trim();
      if (id) return id;
    }
  } catch {
    // ignore
  }
  return null;
}

// Stable per-machine id from the shared config; seeds it (adopting a legacy
// media-use id when present) if absent.
function anonymousId() {
  try {
    const config = readSharedConfig();
    if (typeof config.anonymousId === "string" && config.anonymousId.trim()) {
      return config.anonymousId.trim();
    }
    const id = legacyMediaAnonId() || randomUUID();
    updateSharedConfig({ anonymousId: id });
    return id;
  } catch {
    return "anon"; // best-effort; a shared bucket is fine if the fs is read-only
  }
}

// The HyperFrames user id for a HeyGen username: the same sha256-derived UUID
// the CLI (auth/telemetryIdentity.ts), web app and Desktop key PostHog on.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function heygenUserId(username) {
  if (UUID_PATTERN.test(username)) return username;
  const hash = createHash("sha256").update(username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// The signed-in HeyGen account, keyed like the CLI's own identify call: the
// username's user id, else the lowercased email (lowercased so different stored
// casing never splits one person). `heygen_username` is the cross-project join
// column for the Snowflake event table.
function heygenAccount() {
  const root = process.env.HYPERFRAMES_CONFIG_DIR || join(homedir(), ".hyperframes");
  const file = join(root, ...(process.env.HYPERFRAMES_ENV === "dev" ? ["dev"] : []), "credentials");
  try {
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8").trim();
    if (!raw.startsWith("{")) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!parsed.api_key && !parsed.oauth) return null;
    const user = parsed.user;
    if (!user || typeof user !== "object" || Array.isArray(user)) return null;
    const email =
      typeof user.email === "string" && user.email.trim() ? user.email.trim().toLowerCase() : null;
    const username =
      typeof user.username === "string" && user.username.trim() ? user.username : null;
    const traits = {};
    if (email) traits.email = email;
    if (username) traits.heygen_username = username;
    if (username) return { distinctId: heygenUserId(username), traits };
    if (email) return { distinctId: email, traits };
    return null;
  } catch {
    return null;
  }
}

function showTelemetryNotice() {
  if (optedOut()) return;
  try {
    const config = readSharedConfig();
    // Shared with the CLI (config.telemetryNoticeShown): shown once per person
    // across surfaces, not once per tool.
    if (config.telemetryNoticeShown === true) return;
    console.error(
      [
        "media-use sends usage telemetry: media type, resolution source, and provider; never intent text, file names, or paths.",
        "If you sign in to HeyGen, usage links to your account (email and username). Opt out with HYPERFRAMES_NO_TELEMETRY=1 or DO_NOT_TRACK=1.",
      ].join("\n"),
    );
    updateSharedConfig({ telemetryNoticeShown: true });
  } catch {
    // notice is best-effort; never surface into the command
  }
}

async function postBatch(batch) {
  try {
    await fetch(`${posthogHost()}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // telemetry is best-effort; never surface into the command
  }
}

async function postEvent(event, properties, distinctId) {
  await postBatch([
    {
      event,
      properties: { ...properties, surface: "media-use", $ip: null },
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
    },
  ]);
}

async function identifyAccount(anonId, account) {
  if (optedOut() || identifiedAccount || !account) return;
  identifiedAccount = true;
  await postEvent(
    "$identify",
    { $anon_distinct_id: anonId, $set: account.traits },
    account.distinctId,
  );
}

/**
 * Fire-and-forget a single event to PostHog. Best-effort: awaited with a short
 * timeout so a short-lived script flushes before exit, but any failure (offline,
 * opted out) is swallowed. `properties` must be non-PII (no intent/paths).
 */
export async function track(event, properties = {}) {
  if (optedOut()) return;
  showTelemetryNotice();
  const anonId = anonymousId();
  const account = heygenAccount();
  await identifyAccount(anonId, account);
  const username = account?.traits.heygen_username;
  if (!username) return postEvent(event, properties, anonId);
  await postEvent(event, { ...properties, heygen_username: username }, heygenUserId(username));
}

export function __anonymousIdForTest() {
  return anonymousId();
}

export function __resetTelemetryForTest() {
  identifiedAccount = false;
  warnedNonDefaultHost = false;
}
