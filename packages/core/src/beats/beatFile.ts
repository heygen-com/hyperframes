// Persistence for beat data: one JSON file per audio file, matched by the
// audio's project-relative path. Lives under `beats/` in the project so it
// survives the audio being removed and re-added.

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
  // Studio preview URLs: /api/projects/<id>/preview[/comp]/<relpath>
  const previewMatch = src.match(/\/preview\/(?:comp\/)?(.+?)(?:[?#].*)?$/);
  let rel: string | null = previewMatch ? decodeURIComponent(previewMatch[1]!) : null;
  if (!rel) {
    // Fall back to the FULL pathname (not just basename) so two files with the
    // same name in different folders don't collide on one beat file.
    try {
      rel = decodeURIComponent(new URL(src, "http://_").pathname);
    } catch {
      rel = src;
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
    if (!data || !Array.isArray(data.beats)) return null;
    const times: number[] = [];
    const strengths: number[] = [];
    for (const b of data.beats) {
      if (b && typeof b.time === "number") {
        times.push(b.time);
        strengths.push(typeof b.strength === "number" ? b.strength : 0.5);
      }
    }
    return { times, strengths };
  } catch {
    return null;
  }
}

const MUSIC_ID_RE = /\b(music|bgm|soundtrack|background[-_]?music)\b/i;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1]! : null;
}

/**
 * Find the music track's src in composition HTML, applying the SAME rules as the
 * Studio's `isMusicTrack` so the CLI and Studio agree on which `<audio>` is music:
 * the FIRST `<audio>` (in document order) where data-timeline-role="music", or —
 * when no role is set — whose id matches the music regex. An explicit non-music
 * role excludes the element. Returns the raw src attribute, or null.
 */
export function findMusicAudioSrc(html: string): string | null {
  // `[^>]*` spans newlines (it's a negated class, not `.`), so multi-line opening
  // tags are handled. HyperFrames authors src as an attribute on <audio>.
  const tags = html.match(/<audio\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
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
