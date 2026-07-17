# Script + Voice: the two-layer contract

The script is the single source of truth for BOTH the VO and the captions,
written as token lines. The VO reads the `spoken` layer; captions render the
`display` layer. This is a hard quality gate: a caption showing "jay-sawn" or
a VO saying "juh-son" ("JSON" read literally) are both build failures.

## Register (how it should sound)

- Conversational, not release-notes. "The big one this week —" beats
  "Theme 1:". Contractions welcome. Second person allowed ("your clips").
- Informational, never salesy; no superlatives the changelog doesn't earn.
- One breath per beat: sentences ≤ ~14 words; let punctuation pace the read.
- Numbers with meaning stay ("fifteen releases"); commit hashes, PR numbers,
  and version micro-detail are never spoken.
- Open with the week + the marquee, close with the digest pointer
  ("See everything at hyperframes dot heygen dot com").
- **Teach the simple command.** When a feature has a one-line invocation (a
  slash command, a CLI one-liner), the script says it verbatim ("start your
  prompt with /figma…") and the mock shows it being typed — the command is
  the visible CAUSE of the result. Slash commands speak as "slash <name>",
  caption as `/name`.

## Token-line format (`script-tokens.json`)

```json
{
  "lines": [
    {
      "id": "l1",
      "tokens": ["This", "week", "at", "HyperFrames,", { "display": "JSON", "spoken": "jay-sawn" }]
    }
  ]
}
```

- A bare string = display and spoken identical.
- An object = the layers diverge. `display` keeps standard spelling AND the
  punctuation captions should show; `spoken` is what the TTS reads.
- One line = one caption phrase (≤ ~40 chars of display text). Line grouping
  is an authoring decision made here, not downstream.
- Build `vo-spoken.txt` by joining every token's spoken form with spaces,
  lines joined into sentences/paragraphs as punctuated.

## Phonetics rules (ElevenLabs-style best practices, plain-text)

HeyGen TTS takes plain text (no SSML), so pronunciation is controlled by
spelling, hyphens, and spacing:

1. **Initialisms** (each letter said): space or hyphen the letters —
   `CLI → "C L I"`, `CDP → "C D P"`, `API → "A P I"`.
2. **Acronyms said as words**: respell phonetically —
   `JSON → "jay-sawn"`, `GSAP → "jee-sap"`.
3. **Mixed / pronounceable compounds**: hyphenated LOWERCASE phonetics, one
   fluid run — `ffmpeg → "ff-mpeg"` (ear-tested; the TTS reads "ff" as a
   fluid "eff-eff"), `WebM → "web em"`, `OAuth → "oh-auth"`. Never spaced
   capitals here: the TTS reads spaced caps as isolated letter names with
   hard stops ("F F em-peg" comes out "eff… eff… em-peg"). Reserve spaced
   capitals for TRUE initialisms (CLI, API) where a deliberate
   letter-by-letter read is the goal. When candidates are close, generate
   A/B takes of the real sentence and let the user pick by ear.
4. **Versions/numbers**: expand — `v0.7.36 → "version zero point seven
point thirty-six"` (usually: don't speak versions at all),
   `1080×1080 → "ten-eighty by ten-eighty"`.
5. **URLs**: `hyperframes.heygen.com → "hyperframes dot hey-jen dot com"`.
6. **Filenames/extensions**: `.mp4 → "dot em pee four"` — or rephrase so the
   extension isn't spoken.
7. **Emphasis/pauses**: commas and em-dashes, never caps. Ellipses are
   unreliable in TTS — use an em-dash.

The shared vocabulary lives in `references/lexicon.json`
(`display → spoken`). Consult it for EVERY technical term; if a term is
missing, ask the user for the pronunciation and add the entry — never guess,
never ship unheard. New entries: listen to that line in the generated VO
before accepting.

## Alignment (spoken timestamps → display captions)

`heygen-tts.mjs --words` returns word timestamps of the SPOKEN text.
`scripts/align-captions.mjs` walks the spoken stream against the token lines
(one display token may cover several spoken words — "C L I" is three) and
emits `captions.json`:

```json
{
  "lines": [
    {
      "end": 3.1,
      "w": [
        ["This", 0.22],
        ["week", 0.4],
        ["JSON", 1.1]
      ]
    }
  ]
}
```

Each display word carries the start time of its FIRST spoken word; a line's
`end` = the next line's start (last line: last word end + 0.6). The aligner
warns `MISMATCH` when the heard word doesn't fuzzy-match the expected spoken
form — every warning must be resolved (fix the lexicon spelling or the
transcript) before the captions are trusted.

## Caption rail (rendering)

Per `captions-overlay`: a quiet OVERLAY, never a reserved band. One line,
bottom-center (top: 1002px on 1080-square), TT Norms Pro 500 25px,
ink .92, soft dark text-shadow, words fading in (0.12s) on their timestamps,
phrase swaps as sets. Keep critical small text out of the bottom ~80px
center span; everything else may run under the rail.
