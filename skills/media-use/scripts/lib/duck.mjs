import { wordListsFromMediaMeta } from "./words.mjs";

/**
 * Speech spans from word timestamps.
 *
 * audio_meta.json word times are relative to EACH LINE'S OWN FILE, not to the
 * composition. Without placement info, multiple lines would overlap at t=0 and
 * merge into one bogus span. Placement options:
 *   offsets:    { [voiceId]: startSeconds } explicit composition placement
 *   sequential: stack lines back to back (plus `gap` seconds between lines)
 * A single word list (bare transcript) needs neither.
 */
export function speechSpans(meta, { mergeGap = 0.6, offsets, sequential = false, gap = 0 } = {}) {
  const merge = Number(mergeGap);
  const lists = wordListsFromMediaMeta(meta);
  const voices = Array.isArray(meta?.voices) ? meta.voices : [];
  if (lists.length > 1 && !offsets && !sequential) {
    throw new Error(
      "audio_meta has multiple voice lines with file-relative times; pass --sequential or --offsets so spans land at composition time",
    );
  }
  const intervals = [];
  let cursor = 0;
  for (let i = 0; i < lists.length; i++) {
    const voice = voices[i];
    let offset = 0;
    if (offsets) {
      const id = voice?.id ?? String(i);
      if (!(id in offsets)) throw new Error(`--offsets is missing voice "${id}"`);
      offset = Number(offsets[id]) || 0;
    } else if (sequential) {
      offset = cursor;
      const lineDuration = Number(voice?.duration_s) || Math.max(...lists[i].map((w) => w.end), 0);
      cursor += lineDuration + (Number(gap) || 0);
    }
    for (const word of lists[i]) {
      if (word.end > word.start)
        intervals.push({ start: word.start + offset, end: word.end + offset });
    }
  }
  return mergeIntervals(intervals, Number.isFinite(merge) && merge >= 0 ? merge : 0.6);
}

export function duckKeyframes(
  spans,
  { duck = 0.25, attack = 0.15, release = 0.4, baseVolume = 1 } = {},
) {
  const base = finiteOr(baseVolume, 1);
  const ducked = round3(base * finiteOr(duck, 0.25));
  const keyframes = [];
  for (const span of spans) {
    keyframes.push({
      time: round3(Math.max(0, finiteOr(span.start, 0))),
      volume: ducked,
      duration: round3(finiteOr(attack, 0.15)),
    });
    keyframes.push({
      time: round3(Math.max(0, finiteOr(span.end, 0))),
      volume: round3(base),
      duration: round3(finiteOr(release, 0.4)),
    });
  }
  return keyframes.sort((a, b) => a.time - b.time);
}

function mergeIntervals(intervals, mergeGap) {
  const sorted = intervals
    .map((range) => ({ start: round3(range.start), end: round3(range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const prev = merged.at(-1);
    if (prev && (range.start <= prev.end || range.start - prev.end < mergeGap)) {
      prev.end = Math.max(prev.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}
