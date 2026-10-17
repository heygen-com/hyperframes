// Sound effects from Openverse (https://api.openverse.org): free, no key.
// Anonymous use is rate limited (20 requests a minute, 200 a day); callers fall
// back to the bundled library when it is unavailable.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OPENVERSE_AUDIO_URL = "https://api.openverse.org/v1/audio/";
// The only licences media-use accepts: no NonCommercial, ShareAlike or NoDerivatives.
export const OPENVERSE_SFX_LICENSES = new Set(["cc0", "by"]);
const PLAYABLE_FILETYPES = new Set(["mp3", "wav", "ogg", "flac"]);
const MAX_SFX_MS = 15000;
const IDEAL_SFX_MS = 4000;
const BY_PENALTY = 2;
const SEARCH_TIMEOUT_MS = 10000;

// Openverse text lands in markdown and JSON: one line, no control characters, bounded.
const oneLine = (text) =>
  String(text ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, 300);
const httpsUrl = (url) =>
  typeof url === "string" && url.startsWith("https://") ? oneLine(url) : "";

/** Openverse could not answer (offline, rate limited, server error): stop asking it this run. */
export class OpenverseUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenverseUnavailableError";
  }
}

function usable(result) {
  return (
    OPENVERSE_SFX_LICENSES.has(result?.license) &&
    PLAYABLE_FILETYPES.has(result.filetype) &&
    typeof result.url === "string" &&
    result.url.startsWith("https://") &&
    Number.isFinite(result.duration) &&
    result.duration > 0 &&
    result.duration <= MAX_SFX_MS
  );
}

// Lower is better: relevance position, then seconds past a typical cue length, then CC0 over CC BY.
function penalty(result, position) {
  const longBy = Math.max(0, result.duration - IDEAL_SFX_MS) / 1000;
  return position + longBy + (result.license === "by" ? BY_PENALTY : 0);
}

/** Best usable sound in Openverse's relevance-ordered results, or null. */
export function pickOpenverseSfx(results) {
  let best = null;
  results.forEach((result, position) => {
    if (!usable(result)) return;
    const score = penalty(result, position);
    if (!best || score < best.score) best = { result, score };
  });
  if (!best) return null;
  const r = best.result;
  return {
    id: r.id,
    url: r.url,
    ext: `.${r.filetype}`,
    title: oneLine(r.title),
    creator: oneLine(r.creator),
    license: r.license,
    licenseUrl: httpsUrl(r.license_url),
    sourceUrl: httpsUrl(r.foreign_landing_url),
    credit: oneLine(r.attribution),
    durationS: Math.round(r.duration) / 1000,
  };
}

/** Best licensed sound effect for `query`, null on no match; throws OpenverseUnavailableError. */
export async function searchOpenverseSfx(query, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    q: query,
    page_size: "20",
    license: [...OPENVERSE_SFX_LICENSES].join(","),
  });
  let response;
  try {
    response = await fetchImpl(`${OPENVERSE_AUDIO_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OpenverseUnavailableError(`Openverse unreachable (${error.message})`);
  }
  if (response.status === 429)
    throw new OpenverseUnavailableError("Openverse rate limit reached (HTTP 429)");
  if (!response.ok) throw new OpenverseUnavailableError(`Openverse HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new OpenverseUnavailableError("Openverse returned non-JSON");
  }
  return pickOpenverseSfx(Array.isArray(body?.results) ? body.results : []);
}

/** Record a CC BY sound's credit for `file` in the project's credits file (one line per file). */
export function writeSfxCredit(creditsPath, file, sound) {
  if (sound.license !== "by") return;
  const source = sound.sourceUrl ? ` Source: ${sound.sourceUrl}` : "";
  const line = `- \`${file}\`: ${sound.credit}${source}`;
  let prior = "";
  try {
    prior = readFileSync(creditsPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const kept = prior
    .split("\n")
    .filter((l) => l.startsWith("- ") && !l.startsWith(`- \`${file}\`:`));
  const header =
    "# Sound effect credits\n\nThese sounds are licensed CC BY: credit them wherever the video is published.\n\n";
  mkdirSync(dirname(creditsPath), { recursive: true });
  writeFileSync(creditsPath, `${header}${[...kept, line].join("\n")}\n`);
}
