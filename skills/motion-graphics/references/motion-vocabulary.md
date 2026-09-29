# text module · motion vocabulary (primitive → GSAP)

<!-- registry-items: allow= -->

**The live search is the source of truth for what the registry has.** The table(s) below are a hand-maintained sample and under-cover by design: run `npx hyperframes catalog --query "<what you want>" --json` — it needs nothing installed — before concluding the registry lacks something. Item names here are checked against `registry/registry.json` by `bun run lint:skills`.

Named primitives the Director references in `motion` strings and the Builder implements. `code_hint`s are framework-neutral physics; the GSAP recipe is the HF implementation. Prefer an HF **registry component** (bottom) when one fits — don't reinvent.

## Entry

| primitive                     | GSAP recipe (into CSS end-state)                               | suits                     |
| ----------------------------- | -------------------------------------------------------------- | ------------------------- |
| `slide_bottom/top/left/right` | `from({ y:±150 / x:±200, opacity:0, ease:"power4.out" })`      | calm, build, professional |
| `scale_grow`                  | `from({ scale:0, opacity:0, duration:.6, ease:"power2.out" })` | calm, gentle              |
| `scale_punch`                 | `from({ scale:.6, opacity:0, ease:"back.out(2.2)" })`          | impact, energetic         |
| `fade_in`                     | `from({ opacity:0, duration:.4 })`                             | subtle                    |
| `fade_blur`                   | `from({ opacity:0, filter:"blur(14px)" })`                     | cinematic, dreamy         |
| `typewriter`                  | reveal via clip/`SplitText` width step                         | technical, narrative      |
| `word_reveal`                 | per-word `from({opacity:0,y:..}, stagger:.1)`                  | storytelling              |
| `wave`                        | per-letter `from({y:..}, stagger:{each:.04})`                  | flowing, musical          |
| `bounce_in`                   | `from({y:-120}, ease:"bounce.out")`                            | playful                   |
| `slam`                        | `from({ y:-300, ease:"power4.out" })` + shake on land          | impact, heavy             |

## Emphasis (in place, often on a beat)

| primitive     | GSAP recipe                                                          | suits              |
| ------------- | -------------------------------------------------------------------- | ------------------ |
| `scale_pulse` | `to({ scale:1.12, yoyo:true, repeat:1, ease:"sine.inOut" })` at beat | rhythmic, peak     |
| `shake`       | `to({ keyframes:[{x:-9},{x:9},{x:0}], ease:"none" })`                | urgent, intense    |
| `glow`        | `to({ textShadow:"0 0 46px <ink/accent>", yoyo:true, repeat:1 })`    | important, magical |
| `color_shift` | `to({ color:"<accent>" })` (or accent on the word in CSS)            | dynamic            |

## Exit

| primitive   | GSAP recipe                                        | suits      |
| ----------- | -------------------------------------------------- | ---------- |
| `fade_out`  | `to({ opacity:0, duration:.4, ease:"power2.in" })` | ending     |
| `slide_out` | `to({ y/x: off, opacity:0, ease:"power2.in" })`    | transition |
| `scale_out` | `to({ scale:1.06, opacity:0, ease:"power2.in" })`  | transition |

## Accent graphics (not text)

`underline_sweep` `fromTo({scaleX:0},{scaleX:1}, transformOrigin:"left center")` · `bar_wipe` · `hold_breath` `to({scale:1.015, ease:"sine.inOut"})`.

## Prefer HF registry components when they fit

`caption-kinetic-slam` · `caption-editorial-emphasis` · `caption-neon-glow` · `caption-glitch-rgb` · `caption-particle-burst` · `caption-weight-shift` · `caption-matrix-decode` · `caption-pill-karaoke` · `shimmer-sweep`. These are pre-built, in-ecosystem, and already render-tested — the Builder should reach for them before hand-rolling an equivalent.
