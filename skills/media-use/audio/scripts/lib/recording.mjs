// recording.mjs — the person's own voice recording as a voice line: converted to the engine's wav,
// time-stretched by `speed` with the pitch kept, with word timings scaled to match.
import "../../../scripts/lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

/** src -> 44.1k mono wav at wavAbs, played `speed` times faster. Returns { ok, error? }. */
export function stretchToWav(src, wavAbs, speed = 1) {
  if (!existsSync(src)) return { ok: false, error: `recording not found: ${src}` };
  mkdirSync(dirname(wavAbs), { recursive: true });
  const filter = speed === 1 ? [] : ["-af", atempoChain(speed)];
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", src, ...filter, "-ar", "44100", "-ac", "1", wavAbs],
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
