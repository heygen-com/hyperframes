import { normalizeWords } from "./words.mjs";

const MIN_SEGMENT_SECONDS = 0.2;
const SILENCE_PAD_SECONDS = 0.15;

export function compileCutList(transcript, opts = {}) {
  const words = normalizeWords(transcript);
  if (opts.keep != null && hasRemovalSource(opts)) {
    throw new Error("--keep is mutually exclusive with removal options");
  }

  if (opts.keep != null) {
    const duration = durationFrom(words, opts);
    const ranges = parseTimeRanges(opts.keep);
    return finalizeKept(duration != null ? clampRanges(ranges, duration) : ranges);
  }

  const duration = durationFrom(words, opts);
  if (!duration) return [];

  const removals = [
    ...parseTimeRanges(opts.remove),
    ...wordIndexRanges(words, opts.removeWords),
    ...fillerRanges(words, opts.removeFillers),
    ...silenceRanges(words, opts.cutSilence),
  ];
  const mergedRemovals = mergeRanges(clampRanges(removals, duration));
  return finalizeKept(invertRanges(mergedRemovals, duration));
}

function hasRemovalSource(opts) {
  return (
    opts.remove != null ||
    opts.removeWords != null ||
    opts.removeFillers != null ||
    opts.cutSilence != null
  );
}

function durationFrom(words, opts) {
  const explicit = Number(opts.duration ?? opts.totalDuration);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const last = words.at(-1);
  return last && Number.isFinite(last.end) && last.end > 0 ? last.end : null;
}

function parseTimeRanges(value) {
  if (value == null || value === false || value === "") return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parseRangeString);
  }
  if (!Array.isArray(value)) throw new Error("range list must be a string or array");
  return value.map((range) => {
    if (Array.isArray(range)) return cleanRange(Number(range[0]), Number(range[1]));
    return cleanRange(Number(range?.start), Number(range?.end));
  });
}

function parseRangeString(value) {
  const match = value.match(/^([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)$/);
  if (!match) throw new Error(`invalid range: ${value}`);
  return cleanRange(Number(match[1]), Number(match[2]));
}

function cleanRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("range start/end must be finite numbers");
  }
  if (end < start) throw new Error(`range end ${end} is before start ${start}`);
  return { start, end };
}

function wordIndexRanges(words, value) {
  if (value == null || value === false || value === "") return [];
  const ranges = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(ranges)) throw new Error("--remove-words must be a string or array");
  return ranges
    .map((range) => (typeof range === "string" ? range.trim() : range))
    .filter(Boolean)
    .map((range) => {
      const [first, last = first] =
        typeof range === "string" ? range.split("-").map((n) => n.trim()) : range;
      const startIndex = Number(first);
      const endIndex = Number(last);
      if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
        throw new Error(`invalid word range: ${range}`);
      }
      if (startIndex < 0 || endIndex < startIndex || endIndex >= words.length) {
        throw new Error(`word range out of bounds: ${range}`);
      }
      return { start: words[startIndex].start, end: words[endIndex].end };
    });
}

function fillerRanges(words, value) {
  if (value == null || value === false || value === "") return [];
  const fillers = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((s) => s.trim());
  const set = new Set(fillers.filter(Boolean).map(bareToken));
  if (set.size === 0) return [];
  // Whisper emits words with attached punctuation and arbitrary case
  // ("UM," / "Um."), so compare bare tokens.
  return words
    .filter((word) => set.has(bareToken(word.text)))
    .map((word) => ({ start: word.start, end: word.end }));
}

function bareToken(text) {
  return String(text)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function silenceRanges(words, value) {
  if (value == null || value === false || value === "") return [];
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("--cut-silence must be a positive number");
  }
  const ranges = [];
  for (let i = 0; i < words.length - 1; i++) {
    const current = words[i];
    const next = words[i + 1];
    const gap = next.start - current.end;
    if (gap <= threshold) continue;
    const start = current.end + SILENCE_PAD_SECONDS;
    const end = next.start - SILENCE_PAD_SECONDS;
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

function clampRanges(ranges, duration) {
  return ranges
    .map((range) => ({
      start: Math.max(0, Math.min(duration, range.start)),
      end: Math.max(0, Math.min(duration, range.end)),
    }))
    .filter((range) => range.end > range.start);
}

function mergeRanges(ranges) {
  const sorted = ranges
    .map((range) => ({ start: round3(range.start), end: round3(range.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const prev = merged.at(-1);
    if (prev && range.start <= prev.end) {
      prev.end = Math.max(prev.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function invertRanges(removals, duration) {
  const kept = [];
  let cursor = 0;
  for (const range of removals) {
    if (range.start > cursor) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration });
  return kept;
}

function finalizeKept(ranges) {
  return mergeRanges(ranges)
    .map((range) => ({ start: round3(range.start), end: round3(range.end) }))
    .filter((range) => round3(range.end - range.start) >= MIN_SEGMENT_SECONDS);
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}
