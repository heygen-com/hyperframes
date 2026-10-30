// Persistence for beat data: one JSON file per audio file, matched by the
// audio's project-relative path. Lives under `beats/` in the project so it
// survives the audio being removed and re-added.

import {
  decodeAuthoredAttribute,
  decodedUrlPath,
  scanHtmlOpeningTags,
  type HtmlOpeningTagSpan,
} from "@hyperframes/parsers";

interface BeatFileData {
  version: 1;
  audio: string;
  beats: { time: number; strength: number }[];
}

/** Project-relative path of the audio file behind a (possibly absolute) src URL. */
export function audioRelPathForSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  // blob:/data: URLs have no stable identity across sessions — not persistable.
  if (/^(blob:|data:)/i.test(src)) return null;
  // Studio preview URLs: /api/projects/<id>/preview[/comp]/<relpath>.
  // Parsed with indexOf/slice (not a regex) to avoid polynomial backtracking
  // on adversarial inputs (CodeQL js/polynomial-redos).
  let rel: string | null = null;
  const PREVIEW = "/preview/";
  const previewIdx = src.indexOf(PREVIEW);
  if (previewIdx !== -1) {
    let after = src.slice(previewIdx + PREVIEW.length);
    // Strip query/hash (single char class — linear, ReDoS-safe).
    const queryOrHash = after.search(/[?#]/);
    if (queryOrHash !== -1) after = after.slice(0, queryOrHash);
    if (after.startsWith("comp/")) after = after.slice("comp/".length);
    rel = after ? decodedUrlPath(after) : null;
  }
  if (!rel) {
    // Fall back to the FULL pathname (not just basename) so two files with the
    // same name in different folders don't collide on one beat file.
    try {
      rel = decodedUrlPath(new URL(src, "http://_").pathname);
    } catch {
      rel = decodedUrlPath(src);
    }
  }
  if (!rel) return null;
  rel = rel.replace(/^\/+/, "");
  return rel || null;
}

/** Path of the beat file for a given audio src, or null if it can't be derived. */
export function beatFilePathForSrc(src: string | null | undefined): string | null {
  const rel = audioRelPathForSrc(src);
  return rel ? `beats/${rel}.json` : null;
}

export function serializeBeats(times: number[], strengths: number[], audio: string): string {
  const beats = times.map((t, i) => ({
    time: Math.round(t * 1000) / 1000,
    strength: Math.round((strengths[i] ?? 0.5) * 1000) / 1000,
  }));
  const data: BeatFileData = { version: 1, audio, beats };
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseBeats(content: string): { times: number[]; strengths: number[] } | null {
  try {
    const data = JSON.parse(content) as BeatFileData;
    // Gate on the schema version so a future v2 file (with changed semantics)
    // isn't silently parsed as v1 — an unknown version is treated as absent.
    if (!data || data.version !== 1 || !Array.isArray(data.beats)) return null;
    const times: number[] = [];
    const strengths: number[] = [];
    for (const b of data.beats) {
      if (b && typeof b.time === "number" && Number.isFinite(b.time)) {
        times.push(b.time);
        // Clamp to [0,1] — a hand-edited file could carry an out-of-range or
        // non-finite strength, and the renderers feed it into Math.pow(s, 2.2)
        // (NaN for a negative base).
        const s = typeof b.strength === "number" && Number.isFinite(b.strength) ? b.strength : 0.5;
        strengths.push(Math.max(0, Math.min(1, s)));
      }
    }
    return { times, strengths };
  } catch {
    return null;
  }
}

const MUSIC_ID_RE = /\b(music|bgm|soundtrack|background[-_]?music)\b/i;

function attr(tag: HtmlOpeningTagSpan, name: string): string | null {
  const attribute = tag.attributes.find((value) => value.name === name);
  return attribute?.kind === "value" ? decodeAuthoredAttribute(attribute.value) : null;
}

function isSoundingVideoTag(tag: HtmlOpeningTagSpan): boolean {
  return (
    attr(tag, "data-has-audio") === "true" &&
    !tag.attributes.some((attribute) => attribute.name === "muted")
  );
}

function isMusicSourceTag(tag: HtmlOpeningTagSpan): boolean {
  return tag.closed && (tag.name === "audio" || (tag.name === "video" && isSoundingVideoTag(tag)));
}

/**
 * Find the music track's src in composition HTML, applying the SAME rules as the
 * Studio's `isMusicTrack` so the CLI and Studio agree on which clip is music:
 * the FIRST `<audio>`, or `<video data-has-audio="true">` without `muted` (in
 * document order) where data-timeline-role="music", or —
 * when no role is set — whose id matches the music regex. An explicit non-music
 * role excludes the element. Returns the decoded src attribute, or null.
 */
export function findMusicAudioSrc(html: string): string | null {
  for (const tag of scanHtmlOpeningTags(html)) {
    if (!isMusicSourceTag(tag)) continue;
    const src = attr(tag, "src");
    if (!src) continue;
    const role = attr(tag, "data-timeline-role");
    if (role) {
      if (role === "music") return src;
      continue; // explicit non-music role excludes
    }
    const id = attr(tag, "id");
    if (id && MUSIC_ID_RE.test(id)) return src;
  }
  return null;
}
