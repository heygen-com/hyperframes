#!/usr/bin/env node
// align-captions.mjs — map SPOKEN-layer word timestamps back onto DISPLAY tokens.
//
//   node align-captions.mjs --tokens script-tokens.json --words vo-words.json \
//        --out captions.json [--tail 0.6]
//
// tokens: { lines: [{ id, tokens: [ "word" | {display, spoken} ] }] }
// words:  [ { text, start, end } ] — timestamps of the spoken text (heygen-tts --words)
// out:    { lines: [{ id, end, w: [[display, start], ...] }] } — caption-rail input
//
// Each display token consumes the spoken words of its `spoken` form (one display
// token may be several spoken words: "C L I" = 3). The display word's time = its
// FIRST spoken word's start. Line end = next line's first word start (last line:
// last spoken end + tail). Fuzzy matching absorbs TTS/timestamp quirks; anything
// it can't absorb prints MISMATCH — resolve every one before trusting captions.

import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 ? argv[i + 1] : d;
};
const die = (m) => {
  console.error("align-captions:", m);
  process.exit(2);
};

const tokensFile = flag("tokens", null) ?? die("--tokens required");
const wordsFile = flag("words", null) ?? die("--words required");
const outFile = flag("out", "captions.json");
const tail = parseFloat(flag("tail", "0.6"));

const script = JSON.parse(readFileSync(tokensFile, "utf8"));
const stream = JSON.parse(readFileSync(wordsFile, "utf8"));
if (!script.lines?.length) die("tokens file has no lines[]");
if (!stream.length) die("words file is empty");

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const lev = (a, b) => {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};
const close = (a, b) => {
  if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  return lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 3));
};

let si = 0; // stream cursor
let mismatches = 0;
const outLines = [];

// Greedily consume stream words from `from` whose concatenated norm builds the
// token's full spoken norm ("hey-jen" may arrive as one word or several; "C L I"
// as three). Returns { start, next } or null.
function consume(from, spokenNorm) {
  let acc = "",
    start = null,
    k = from;
  while (k < stream.length) {
    const wn = norm(stream[k].text);
    if (!wn) {
      k++;
      continue;
    }
    const cand = acc + wn;
    if (spokenNorm.startsWith(cand) || close(cand, spokenNorm)) {
      if (start === null) start = stream[k].start;
      acc = cand;
      k++;
      if (close(acc, spokenNorm)) return { start, next: k };
      continue;
    }
    break;
  }
  return acc && close(acc, spokenNorm) ? { start, next: k } : null;
}

for (const line of script.lines) {
  const w = [];
  for (const tok of line.tokens) {
    const display = typeof tok === "string" ? tok : tok.display;
    const spoken = typeof tok === "string" ? tok : tok.spoken;
    const spokenNorm = norm(spoken);
    if (!spokenNorm) {
      w.push([display, si < stream.length ? stream[si].start : 0]);
      continue;
    }
    // try at the cursor, then resync up to 4 words ahead
    let hit = null;
    for (let off = 0; off <= 4 && !hit; off++) hit = consume(si + off, spokenNorm);
    if (!hit) {
      console.error(
        `MISMATCH line=${line.id} display="${display}" expected~"${spoken}" heard="${stream[si]?.text ?? "<eof>"}" @${stream[si]?.start?.toFixed(2) ?? "?"}s`,
      );
      mismatches++;
      w.push([display, si < stream.length ? stream[si].start : stream.at(-1).end]);
      continue;
    }
    si = hit.next;
    w.push([display, +hit.start.toFixed(2)]);
  }
  outLines.push({ id: line.id, w });
}

for (let i = 0; i < outLines.length; i++) {
  outLines[i].end =
    i + 1 < outLines.length ? outLines[i + 1].w[0][1] : +(stream.at(-1).end + tail).toFixed(2);
}

writeFileSync(outFile, JSON.stringify({ lines: outLines }, null, 1));
const status = mismatches ? `${mismatches} MISMATCH(ES) — resolve before building` : "clean";
console.log(
  `aligned ${outLines.length} lines / ${stream.length} spoken words → ${outFile} (${status})`,
);
process.exit(mismatches ? 1 : 0);
