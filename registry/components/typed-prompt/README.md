# typed-prompt

A prompt line types itself in chunked human cadence behind a deterministic blinking caret, on a token-styled mono surface. Optionally the final word is first mistyped, backspaced, and retyped (correction mode). Product demo family, authored at 4s with an elastic HOLD.

## Mechanic

Every visible frame is read from one lookup table of text-at-time rows, built synchronously (fixed-seed LCG, no `Date.now`, no `Math.random`) before the timeline registers. A single `ease: "none"` driver reads `textAt(time)` from the table, so seeking forward, backward, or repeatedly to the same time always shows the same string; there is no incremental typing state. The caret runs an integer number of sine cycles across exactly the typing window, then is pinned solid for the hold.

## Variables

| Variable       | Type   | Default                           | Notes                                                                                        |
| -------------- | ------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `text`         | string | `Generate a product launch video` | The prompt that gets typed. The resting text always equals `text`.                            |
| `prompt_glyph` | string | `>`                               | Leading glyph. Empty string hides it.                                                         |
| `cadence`      | enum   | `human`                           | `uniform` = one character per fixed step; `human` = seeded 1-3 character chunks, varied gaps. |
| `caret`        | enum   | `blink`                           | `blink` = integer sine cycles during typing, then solid; `solid` never blinks.                |
| `correction`   | string | `""`                              | The mistyped word: typed in place of the final word, backspaced, then the true word retypes.  |
| `cues`         | string | `""`                              | Comma-separated seconds from mount start; cue N anchors the start of word N. Empty = authored rhythm. |
| `accent`       | enum   | `green`                           | `green` -> `--brand`, `blue` -> `--accent`, `violet` -> `--accent-2` (glyph + caret).         |
| `exit`         | enum   | `none`                            | `none` holds the end frame (frame roots own transitions), `fade`, or `up`.                    |

## Envelope

Panel settles over 0.5s; typing starts at 0.35s and runs at its natural cadence, compressed proportionally only if it would overflow `duration - OUT`. All extra duration becomes HOLD (solid caret, barely-there drift ending in stillness). OUT (0.45s) exists only when `exit` is not `none`. The timeline is never time-scaled.

## Usage

```html
<div
  class="clip"
  data-start="0"
  data-duration="4"
  data-composition-src="components/typed-prompt.html"
  data-composition-variables='{ "text": "Summarize this contract", "correction": "contarct", "accent": "blue" }'
></div>
```

The root is elastic (no fixed dimensions) and reads correctly in any host box. Timeline registers under the literal key `typed-prompt`.
