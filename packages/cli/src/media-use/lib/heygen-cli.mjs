import { execFileSync } from "node:child_process";
import { track } from "./telemetry.mjs";

// v0.3.0 is the first CLI that can use an OAuth session; v0.1.x/0.2.x reject it
// ("heygen-cli can't use OAuth yet"), and OAuth is what the free-usage path
// needs — so anything below this can't authenticate for free usage at all.
export const HEYGEN_MIN_VERSION = "0.3.0";
// Free-usage path is OAuth (`--oauth` → subscription/free credits); `--api-key`
// bills API credits, so the onboarding steers to OAuth. Keep pipe-to-shell
// installer text out of the runtime module; the docs are the safer source of
// truth for platform-specific setup.
export const HEYGEN_INSTALL_COMMAND =
  "Install the CLI from https://developers.heygen.com/cli, then run: heygen auth login --oauth";
export const HEYGEN_AUTH_COMMAND = "heygen auth login --oauth";
export const HEYGEN_UPDATE_COMMAND = "heygen update";
export const HEYGEN_CLIENT_SOURCE_ARGV = ["--headers", "X-HeyGen-Client-Source: media-use"];

export const HEYGEN_NOT_FOUND_MESSAGE = `media-use: heygen CLI not found — it's the free path for bgm/image/voice/avatar-video. ${HEYGEN_INSTALL_COMMAND}`;
export const HEYGEN_NOT_AUTHENTICATED_MESSAGE = `media-use: heygen CLI not authenticated (free usage) — run: ${HEYGEN_AUTH_COMMAND}`;
export const HEYGEN_OUTDATED_MESSAGE = `media-use: heygen CLI is outdated — run: ${HEYGEN_UPDATE_COMMAND}  (need >= v${HEYGEN_MIN_VERSION})`;

const ACTIONABLE_MESSAGES = new Set([
  HEYGEN_NOT_FOUND_MESSAGE,
  HEYGEN_NOT_AUTHENTICATED_MESSAGE,
  HEYGEN_OUTDATED_MESSAGE,
]);

export function classifyHeygenError(err) {
  return classifyHeygenErrorResult(err).message;
}

export function classifyHeygenErrorCode(err) {
  return classifyHeygenErrorResult(err).code;
}

function classifyHeygenErrorResult(err) {
  const detail = heygenErrorDetail(err);
  const text = [err?.stderr, err?.stdout, err?.message, detail]
    .map((value) => textOf(value))
    .filter(Boolean)
    .join("\n");
  const lower = text.toLowerCase();

  // Only ENOENT (spawn of a missing binary) or a shell's "command not found"
  // mean the CLI itself is absent. A bare "not found" would misfire on the CLI's
  // own resource errors (e.g. a stale voiceId → "voice not found"), whose message
  // embeds the `heygen ...` command line — sending users to reinstall a CLI they
  // just ran successfully. Keep this narrow.
  if (err?.code === "ENOENT" || lower.includes("command not found")) {
    return { code: "not_found", message: HEYGEN_NOT_FOUND_MESSAGE };
  }

  if (
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    // \b401\b, not a bare "401" substring — otherwise request IDs (req-401abc),
    // URLs, and retry-after headers would misclassify as an auth failure.
    /\b401\b/.test(lower) ||
    lower.includes("not logged in") ||
    lower.includes("no api key") ||
    lower.includes("missing api key") ||
    lower.includes("invalid api key") ||
    lower.includes("login required") ||
    lower.includes("auth required") ||
    lower.includes("authentication required")
  ) {
    return { code: "not_authenticated", message: HEYGEN_NOT_AUTHENTICATED_MESSAGE };
  }

  const version = firstSemver(text);
  if (version && versionLessThan(version, HEYGEN_MIN_VERSION)) {
    return { code: "outdated", message: HEYGEN_OUTDATED_MESSAGE };
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("insufficient credit") ||
    lower.includes("too many requests") ||
    lower.includes("throttled") ||
    /\b429\b/.test(lower)
  ) {
    return { code: "rate_limited", message: detail };
  }

  return { code: "other", message: detail };
}

// reportHeygenFailure's callers (voice-provider.mjs, heygen-search.mjs) are
// synchronous and several layers below the CLI's process.exit() calls, so
// they can't await this tracking call themselves. Stash each attempt's
// promise here so a caller closer to exit (resolve.mjs) can join it first —
// same "awaited so a short-lived run flushes it" discipline telemetry.mjs's
// track() already documents, just reachable from a sync call site.
const pendingFailureTracking = new Set();
// resolve.mjs is a single-shot CLI (one resolve per process), so one shared
// consume-once slot is sufficient. If resolve becomes an in-process/concurrent
// API, move this state into a per-resolve context before reusing that path.
let pendingRemediation = null;

export function consumeHeygenRemediation() {
  const remediation = pendingRemediation;
  pendingRemediation = null;
  return remediation;
}

export function reportHeygenFailure(err, context, trackEvent = track) {
  const { code, message } = classifyHeygenErrorResult(err);
  if (code === "not_found" || code === "outdated") {
    pendingRemediation = { code, message };
  }
  if (ACTIONABLE_MESSAGES.has(message)) {
    console.error(message);
  } else {
    console.error(`media-use: \`${context}\` failed: ${message}`);
  }
  try {
    const tracked = Promise.resolve(
      trackEvent("media_use_provider_error", { provider: "heygen", reason: code }),
    ).catch(() => {});
    pendingFailureTracking.add(tracked);
    void tracked.finally(() => pendingFailureTracking.delete(tracked));
    return tracked;
  } catch {
    // Telemetry must never affect the provider failure path.
    return Promise.resolve();
  }
}

// Awaits every provider-error track fired since the last flush, so a caller
// about to process.exit() doesn't orphan one mid-request (both are separate,
// non-keepalive HTTP connections with no ordering guarantee otherwise).
// Never rejects: each tracked promise already swallows its own failure.
export async function flushHeygenFailureTracking() {
  if (pendingFailureTracking.size === 0) return;
  await Promise.all(pendingFailureTracking);
}

// Shared discovery/generation helper for the CLI-shelling providers (voice,
// avatar-video): run a heygen JSON subcommand, report+classify on failure,
// and hand the caller the classified reason via onError (used by callers that
// need to distinguish e.g. not_authenticated from other failures).
export function runHeygenJson(bin, argv, label, onError) {
  let out;
  try {
    out = execFileSync(bin, argv, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    reportHeygenFailure(err, `${bin} ${label}`);
    onError?.(classifyHeygenErrorCode(err));
    return null;
  }
  try {
    return JSON.parse(out);
  } catch {
    console.error(`media-use: \`${bin} ${label}\` returned non-JSON output`);
    return null;
  }
}

export function firstSemver(text) {
  const match = String(text || "").match(/\bv?(\d+)\.(\d+)\.(\d+)\b/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function versionLessThan(version, minimum) {
  const left = versionParts(version);
  const right = versionParts(minimum);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return true;
    if (left[i] > right[i]) return false;
  }
  return false;
}

function heygenErrorDetail(err) {
  return textOf(err?.stderr) || textOf(err?.stdout) || err?.message || String(err);
}

function textOf(value) {
  return value == null ? "" : String(value).trim();
}

function versionParts(version) {
  const match = String(version || "").match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
}
