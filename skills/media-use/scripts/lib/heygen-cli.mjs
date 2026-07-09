// v0.3.0 is the first CLI that can use an OAuth session; v0.1.x/0.2.x reject it
// ("heygen-cli can't use OAuth yet"), and OAuth is what the free-usage path
// needs — so anything below this can't authenticate for free usage at all.
export const HEYGEN_MIN_VERSION = "0.3.0";
// Free-usage path is OAuth (`--oauth` → subscription/free credits); `--api-key`
// bills API credits, so the onboarding steers to OAuth.
export const HEYGEN_INSTALL_COMMAND =
  "curl -fsSL https://static.heygen.ai/cli/install.sh | bash && heygen auth login --oauth";
export const HEYGEN_AUTH_COMMAND = "heygen auth login --oauth";
export const HEYGEN_UPDATE_COMMAND = "heygen update";

export const HEYGEN_NOT_FOUND_MESSAGE = `media-use: heygen CLI not found — it's the free path for bgm/image/voice/avatar-video. Install: ${HEYGEN_INSTALL_COMMAND}`;
export const HEYGEN_NOT_AUTHENTICATED_MESSAGE = `media-use: heygen CLI not authenticated (free usage) — run: ${HEYGEN_AUTH_COMMAND}`;
export const HEYGEN_OUTDATED_MESSAGE = `media-use: heygen CLI is outdated — run: ${HEYGEN_UPDATE_COMMAND}  (need >= v${HEYGEN_MIN_VERSION})`;

const ACTIONABLE_MESSAGES = new Set([
  HEYGEN_NOT_FOUND_MESSAGE,
  HEYGEN_NOT_AUTHENTICATED_MESSAGE,
  HEYGEN_OUTDATED_MESSAGE,
]);

export function classifyHeygenError(err) {
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
    return HEYGEN_NOT_FOUND_MESSAGE;
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
    return HEYGEN_NOT_AUTHENTICATED_MESSAGE;
  }

  const version = firstSemver(text);
  if (version && versionLessThan(version, HEYGEN_MIN_VERSION)) {
    return HEYGEN_OUTDATED_MESSAGE;
  }

  return detail;
}

export function reportHeygenFailure(err, context) {
  const message = classifyHeygenError(err);
  if (ACTIONABLE_MESSAGES.has(message)) {
    console.error(message);
  } else {
    console.error(`media-use: \`${context}\` failed: ${message}`);
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
