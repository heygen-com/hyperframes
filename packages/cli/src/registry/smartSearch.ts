/**
 * Smart catalog search: rank the full catalog remotely instead of substring
 * matching the bundled one.
 *
 * Two rules shape this module.
 *
 * A query is user content, so it never leaves the machine without a recorded
 * yes. Consent is asked once and remembered, rather than demanded on every
 * invocation: a flag only power users discover would leave everyone else on the
 * weaker path, which is the opposite of protecting them.
 *
 * Degradation is always visible. Every outcome is named and surfaced to the
 * caller so the command can say which search actually ran. A quietly worse
 * result that looks identical is the failure mode worth engineering against.
 */

import { apiBaseUrl, buildAuthHeaders } from "../auth/client.js";
import { tryResolveCredential } from "../auth/resolver.js";
import { readConfig, writeConfig } from "../telemetry/config.js";

/**
 * How the server actually ranked. Mirrors `RetrievalMode` in
 * `astral_agents/functions/video_primitive_catalog/retrieval.py`; the two must
 * be changed together. A mode the server can emit but this list omits is
 * rejected as a bad response, which silently costs every user the ranking they
 * just asked for.
 */
export const SMART_SEARCH_MODES = ["semantic", "hybrid", "lexical_fallback"] as const;
export type SmartSearchMode = (typeof SMART_SEARCH_MODES)[number];

export interface SmartSearchMatch {
  name: string;
  description: string;
}

export interface SmartSearchResult {
  mode: SmartSearchMode;
  catalogVersion: string;
  /** Similarity of the closest move. Reported, never used as a gate: see the server note. */
  topScore?: number;
  matches: SmartSearchMatch[];
}

/** Every way the remote path can end. The caller reports whichever it gets. */
export type SmartSearchOutcome =
  | { status: "ok"; result: SmartSearchResult }
  | { status: "declined" }
  | { status: "unauthenticated" }
  | { status: "unavailable"; reason: string };

const SEARCH_PATH = "/v3/hyperframes/catalog/search";
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Has the user agreed to send queries remotely?
 *
 * `undefined` means never asked. In a non-interactive context that resolves to
 * no, because silence is not consent.
 */
export function smartSearchConsent(): boolean | undefined {
  return readConfig().smartSearchEnabled;
}

export function recordSmartSearchConsent(enabled: boolean): void {
  const config = readConfig();
  writeConfig({ ...config, smartSearchEnabled: enabled });
}

export async function smartSearch(
  query: string,
  options: { limit?: number; consented: boolean },
): Promise<SmartSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { status: "unavailable", reason: "empty query" };
  // Consent has one owner: the caller resolves stored preference, prompt and
  // per-run overrides, then states the decision here. Re-deriving it locally
  // made an explicit --smart unable to override a never-asked preference.
  if (!options.consented) return { status: "declined" };

  const credential = await tryResolveCredential();
  if (!credential) return { status: "unauthenticated" };

  const url = new URL(`${apiBaseUrl()}${SEARCH_PATH}`);
  url.searchParams.set("query", trimmed);
  if (options.limit) url.searchParams.set("limit", String(options.limit));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", ...buildAuthHeaders(credential) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure costs ranking quality, never the command.
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "request failed",
    };
  }

  if (response.status === 401 || response.status === 403) return { status: "unauthenticated" };
  if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };

  try {
    return { status: "ok", result: parseSearchResponse(await response.json()) };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "bad response",
    };
  }
}

/**
 * Read the response envelope.
 *
 * Tolerates the payload sitting at the top level or under `data`, because the
 * standard envelope wraps it and a bare handler would not. The mode is required
 * and never defaulted: inventing "hybrid" would report a ranking that did not
 * happen.
 */
export function parseSearchResponse(body: unknown): SmartSearchResult {
  const root = body as Record<string, unknown> | null;
  const payload = (root?.["data"] ?? root) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") throw new Error("response has no payload");

  const mode = payload["mode"];
  if (!SMART_SEARCH_MODES.includes(mode as SmartSearchMode)) {
    throw new Error(`response has no usable mode (got ${JSON.stringify(mode)})`);
  }

  const rawResults = Array.isArray(payload["results"]) ? payload["results"] : [];
  const matches = rawResults
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry?.["name"] === "string")
    .map((entry) => ({
      name: entry["name"] as string,
      description: typeof entry["description"] === "string" ? (entry["description"] as string) : "",
    }));

  const topScore = payload["top_score"];
  return {
    ...(typeof topScore === "number" ? { topScore } : {}),
    mode: mode as SmartSearchMode,
    catalogVersion:
      typeof payload["catalog_version"] === "string" ? (payload["catalog_version"] as string) : "",
    matches,
  };
}

/** One line describing what actually ran, so a fallback is never mistaken for a full search. */
export function describeOutcome(outcome: SmartSearchOutcome): string {
  switch (outcome.status) {
    case "ok":
      switch (outcome.result.mode) {
        // Semantic alone is the strongest arm, not a degraded one. Reporting it
        // as a fallback would understate the result the user actually got.
        case "semantic":
          return "smart search (meaning)";
        case "hybrid":
          return "smart search (meaning + words)";
        case "lexical_fallback":
          return "smart search degraded to words only";
      }
    case "declined":
      return "local word match (smart search off)";
    case "unauthenticated":
      return "local word match (sign in for smart search)";
    case "unavailable":
      return `local word match (smart search unavailable: ${outcome.reason})`;
  }
}
