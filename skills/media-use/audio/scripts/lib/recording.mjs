// recording.mjs — the person's own voice recording as a voice line: converted to the engine's wav,
// time-stretched by `speed` with the pitch kept, with word timings scaled to match.
import "../../../scripts/lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { projectPath } from "./project-path.mjs";

// ffmpeg's atempo takes 0.5..2 per stage; chain stages for the rest of the 0.1..3 speed range.
export function atempoChain(speed) {
  const stages = [];
  let left = speed;
  while (left > 2) {
    stages.push(2);
    left /= 2;
  }
  while (left < 0.5) {
    stages.push(0.5);
    left /= 0.5;
  }
  if (Math.abs(left - 1) > 1e-9 || stages.length === 0) stages.push(left);
  return stages.map((s) => `atempo=${Number(s.toFixed(6))}`).join(",");
}

/** The recording a request line names, as a path inside the project. Throws when it is absolute or leads outside. */
export function recordingSource(hyperframesDir, audio) {
  const src = projectPath(hyperframesDir, String(audio));
  if (src) return src;
  throw new Error(
    `recording ${JSON.stringify(String(audio))} is outside the project folder; copy it into the project and give its path there`,
  );
}

// Formats whose file is a list, playlist or script naming other media or programs, which ffmpeg would then
// open. A recording must be the audio itself, so these are refused.
const INDIRECT_FORMATS = new Set([
  "hls",
  "applehttp",
  "concat",
  "dash",
  "webm_dash_manifest",
  "imf",
  "sdp",
  "rtp",
  "rtsp",
  "ffmetadata",
  "image2",
  "avisynth",
  "vapoursynth",
]);

// The demuxer name for src, such as "mp3" or "mov,mp4,m4a,3gp,3g2,mj2"; null when it cannot tell. Some
// Windows installs ship ffmpeg without ffprobe, so ffmpeg's input banner is the fallback.
function probeFormat(src) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=format_name"].concat([
      "-of",
      "default=nw=1:nk=1",
      "--",
      src,
    ]),
    { encoding: "utf8" },
  );
  if (r.error?.code === "ENOENT") {
    const banner = spawnSync("ffmpeg", ["-hide_banner", "-protocol_whitelist", "file", "-i", src], {
      encoding: "utf8",
    });
    return /^Input #0, (.+?), from /m.exec(banner.stderr ?? "")?.[1] ?? null;
  }
  const name = r.status === 0 ? String(r.stdout).trim() : "";
  return name || null;
}

/** src -> 44.1k mono wav at wavAbs, played `speed` times faster. Returns { ok, error? }. */
export function stretchToWav(src, wavAbs, speed = 1) {
  const stat = statSync(src, { throwIfNoEntry: false });
  if (!stat) return { ok: false, error: `recording not found: ${src}` };
  if (!stat.isFile()) return { ok: false, error: `recording is not a file: ${src}` };
  const format = probeFormat(src);
  if (!format) return { ok: false, error: `ffmpeg cannot read ${src} as audio` };
  if (format.split(",").some((name) => INDIRECT_FORMATS.has(name))) {
    return {
      ok: false,
      error: `${src} is a ${format} list that points at other files; give the audio file itself`,
    };
  }
  mkdirSync(dirname(wavAbs), { recursive: true });
  const filter = speed === 1 ? [] : ["-af", atempoChain(speed)];
  // The probed format pins the input: ffmpeg opens only that one local file, with no nested inputs.
  const input = ["-format_whitelist", format, "-protocol_whitelist", "file", "-i", src];
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", ...input, ...filter, "-ar", "44100", "-ac", "1", wavAbs],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0 || !existsSync(wavAbs)) {
    return { ok: false, error: `ffmpeg could not convert ${src}: ${r.error?.message ?? r.stderr}` };
  }
  return { ok: true };
}

/** Caller-supplied word timings ({text|word, start, end}) as [{text,start,end}], or null when absent. */
export function parseWords(words) {
  if (!Array.isArray(words) || words.length === 0) return null;
  return words.map((w, i) => {
    const text = w?.text ?? w?.word;
    if (typeof text !== "string" || !Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      throw new Error(`words[${i}] needs text (or word), start and end in seconds`);
    }
    return { text, start: w.start, end: w.end };
  });
}

/** Words of a recording played `speed` times faster land at start/speed. */
export const scaleWords = (words, speed) =>
  words.map((w) => ({ ...w, start: w.start / speed, end: w.end / speed }));
