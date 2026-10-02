// Merge Parakeet-MLX token timestamps into word timestamps.
//
// parakeet-mlx JSON emits SUB-WORD tokens (" H", "ello", ...) with per-token
// start/end. Captions + transcript-cut need WORD timestamps, so join tokens
// into words on the space boundary: a token whose text starts with a space
// (or the very first token) begins a new word; the rest append. Output matches
// the { words: [{ text, start, end }] } shape the rest of media-use consumes
// (see words.mjs / cutlist.mjs).

export function mergeTokensToWords(parakeet) {
  const sentences = Array.isArray(parakeet?.sentences) ? parakeet.sentences : [];
  const words = [];
  for (const s of sentences) {
    for (const t of s.tokens ?? []) {
      const raw = typeof t.text === "string" ? t.text : "";
      const startsWord = raw.startsWith(" ") || words.length === 0;
      if (startsWord) {
        words.push({ text: raw.trim(), start: t.start, end: t.end });
      } else {
        const w = words[words.length - 1];
        w.text += raw;
        w.end = t.end;
      }
    }
  }
  return { text: (parakeet?.text ?? "").trim(), words: words.filter((w) => w.text.length > 0) };
}
