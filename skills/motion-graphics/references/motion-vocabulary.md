# text module · motion vocabulary (primitive -> anime.js)

Named primitives the Director references in `motion` strings and the Builder implements. `code_hint`s are framework-neutral physics; the anime.js params are the HF default implementation. Prefer an HF **registry component** (bottom) when one fits, don't reinvent.

## Entry

| primitive                     | anime.js params (into CSS end-state)                                          | suits                     |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| `slide_bottom/top/left/right` | `{ translateY:[150,0] / translateX:[200,0], opacity:[0,1], ease:"outQuint" }` | calm, build, professional |
| `scale_grow`                  | `{ scale:[0,1], opacity:[0,1], duration:600, ease:"outCubic" }`               | calm, gentle              |
| `scale_punch`                 | `{ scale:[.6,1], opacity:[0,1], ease:"outBack(2.2)" }`                        | impact, energetic         |
| `fade_in`                     | `{ opacity:[0,1], duration:400 }`                                             | subtle                    |
| `fade_blur`                   | `{ opacity:[0,1], filter:["blur(14px)","blur(0px)"] }`                        | cinematic, dreamy         |
| `typewriter`                  | reveal via clip/`SplitText` width step                                        | technical, narrative      |
| `word_reveal`                 | per-word `{ opacity:[0,1], translateY:[N,0], delay:anime.stagger(100) }`      | storytelling              |
| `wave`                        | per-letter `{ translateY:[N,0], delay:anime.stagger(40) }`                    | flowing, musical          |
| `bounce_in`                   | `{ translateY:[-120,0], ease:"outBounce" }`                                   | playful                   |
| `slam`                        | `{ translateY:[-300,0], ease:"outQuint" }` + shake on land                    | impact, heavy             |

## Emphasis (in place, often on a beat)

| primitive     | anime.js params                                                          | suits              |
| ------------- | ------------------------------------------------------------------------ | ------------------ |
| `scale_pulse` | `{ scale:[1,1.12,1], duration:360, ease:"inOutSine" }` at beat           | rhythmic, peak     |
| `shake`       | `{ translateX:[0,-9,9,0], duration:260, ease:"linear" }`                 | urgent, intense    |
| `glow`        | `{ textShadow:["0 0 0 <accent>","0 0 46px <accent>","0 0 0 <accent>"] }` | important, magical |
| `color_shift` | `{ color:"<accent>" }` (or accent on the word in CSS)                    | dynamic            |

## Exit

| primitive   | anime.js params                                    | suits      |
| ----------- | -------------------------------------------------- | ---------- |
| `fade_out`  | `{ opacity:0, duration:400, ease:"inCubic" }`      | ending     |
| `slide_out` | `{ translateY/X: off, opacity:0, ease:"inCubic" }` | transition |
| `scale_out` | `{ scale:1.06, opacity:0, ease:"inCubic" }`        | transition |

## Accent graphics (not text)

`underline_sweep` `{ scaleX:[0,1], transformOrigin:"left center" }` · `bar_wipe` · `hold_breath` `{ scale:1.015, ease:"inOutSine" }`.

## Prefer HF registry components when they fit

`caption-kinetic-slam` · `caption-editorial-emphasis` · `caption-neon-glow` · `caption-glitch-rgb` · `caption-particle-burst` · `caption-weight-shift` · `caption-matrix-decode` · `caption-pill-karaoke` · `shimmer-sweep`. These are pre-built, in-ecosystem, and already render-tested, the Builder should reach for them before hand-rolling an equivalent.
