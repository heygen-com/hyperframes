# THEME mode — composed visual constitutions

Theme mode is the third compiler (`scripts/make-theme.cjs`), beside Standard and
Cinematic. It exists because "mode" was a bundle of orthogonal axes pretending
to be one switch. A theme DNA composes its identity from registries implemented
ONCE in the compiler — **paradigms are the unit of code; DNAs are the unit of
identity**. A new look is a JSON file; only a genuinely new paradigm/setpiece
(rare) touches the compiler.

```
theme DNA = body PARADIGM   how the transcript surface lives
          × body LAYER      fg-alpha (rail.html channel) | bg-embed
          × hero SETPIECE   the climax choreography
          × front FX        flash / rings / sparks / scanband (fg, over subject)
          × PLATE budget    charge-dim (in-page) + punch/shake/grain (_postfx.sh)
          × LINKAGES        declarative theme interactions
```

Standard and Cinematic are, in retrospect, two fixed points of this space
(rail×embed-climax and column-flow×lockup). They remain separate compilers for
compatibility; do not re-implement them as themes yet.

## Unification roadmap (strangler fig — interface first, engines later)

The user-facing model is already unified (SKILL.md Step 0): one catalog of
LOOKS; classic looks pick a DELIVERY (rail | column), themed looks bind their
own. "Standard/Cinematic" are delivery/compiler names, not modes. Remaining
phases, each gated on need — never rewrite for tidiness alone:

- **Phase 2 — one authoring schema.** `lines`/`minors`/`hero` are already
  ~90% shared between standard.json and theme.json; a router that translates a
  single `caption.json` into the engine-specific file removes the last
  user-visible seam. cinematic.json's blocks/planes are the odd one — map the
  common fields, pass engine-specific ones through.
- **Phase 3 — engine convergence.** Port a classic delivery into make-theme
  ONLY when something forces it (e.g. a classic DNA wants a plate budget or a
  setpiece). Acceptance bar: blind A/B on the cap_multi regression scenes vs
  the old compiler — swap engines only when indistinguishable or better. Until
  then the old compilers are the reference implementation of 8 rounds of
  validated typography (lockup/orbit, multi-climax, ratio-lock, per-plane
  legibility, occlusion adjudication) — that machinery is the moat, not debt.

## Body paradigms (registry)

| paradigm   | surface                                                                                                  | layer | entrance verbs                                                                                                                                                                                                                               | exit verbs                                             |
| ---------- | -------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `rail`     | lower-third lines, replace                                                                               | fg    | `stamp` (1f hot appear→crush→recoil→cool), `flick` (tube double-flick), `bootflick` (corrupted-cyan boot 1–2f → settles to UI color; minors keep a cyan/red registration shadow). `stamp` minors cool to `palette.minorCool` (default amber) | `drop` (mass falls), `powercut` (bright→ghost→off)     |
| `panel`    | docked glass console, accumulate + typed                                                                 | fg    | `type` (width steps per word, $ prompt, caret blinks)                                                                                                                                                                                        | hold                                                   |
| `poem`     | open-space stanzas, accumulate; letters CONDENSE from seeded dust                                        | fg    | `condense`                                                                                                                                                                                                                                   | `drift` (stanza hand-off) + optional dispersal linkage |
| `takeover` | full-frame hard-cut cards, plate dimmed throughout                                                       | bg    | `cut` (+ tension `creep` before silences, auto-detected)                                                                                                                                                                                     | hard cut / blur dissolve                               |
| `lastpage` | manuscript rail (typed serif) + a seeded field of BLURRED apex-word instances haunting the room from t=0 | bg    | typed rail; field breathes imperceptibly                                                                                                                                                                                                     | rail fades; field resolves at apex (see `rackfocus`)   |

fg body uses the **rail.html alpha-webm channel** (true alpha — dark panels and
scrims work; never the screen-blend index_fg path, which can only add light).

## Hero setpieces (registry)

| setpiece     | what happens                                                                                                                                                                                                                                                                                                                                                                                                                                         | notes                                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detonation` | charge-dim → sheared stencil slices crush in hot → SNAP into register → squash → elastic settle → paint cools to bone → bars/ticks/designation-tag deploy → shear-apart exit                                                                                                                                                                                                                                                                         | pairs with fx flash/rings/sparks + plate punch/shake                                                                                                                                                                                                 |
| `decode`     | slot-machine glyph reels (steps() ease, seek-safe) lock left→right with RGB jitter → lock snap → CRT power-off exit                                                                                                                                                                                                                                                                                                                                  | pairs with `redact-until-hero`                                                                                                                                                                                                                       |
| `drawon`     | the word is WRITTEN stroke-by-stroke from a single-line font (Hershey) — per-stroke paths revealed sequentially at constant pen speed, nib rides `getPointAtLength`, hops at pen lifts; then hum + buzz dip                                                                                                                                                                                                                                          | any word, zero tuning: `gen-stroke-path.py` lays out glyph pen-paths at compile time                                                                                                                                                                 |
| `cpslam`     | acid-yellow stencil word slams in BEHIND the subject with REAL diagonal notch cuts (SVG mask = true transparency over footage), chromatic split that settles to a PERMANENT cyan/red registration error, seeded glitch ticks, katakana tag, glitch-out exit                                                                                                                                                                                          | bounded hold (~2.6s default, `params.hold` / `hero.exitAt` override) — a climax is an event, not wallpaper                                                                                                                                           |
| `coverword`  | the spoken apex word SET IN the replica typeface of the CP2077 cover mark (`assets/brand/CyberpunkReplica.ttf` — lowercase glyphs carry the logo's real brush chops, blade terminals and spikes; logo case = First-upper rest-lower). The setpiece adds only what the font lacks: solid cyan duplicate offset (-7,8), baseline streak merged with the glyph feet + cyan debris, circuit trace off the tail, tear-in slices / living print / tear-out | metric-exact layout from `cyberpunk-widths.json` (advance widths + ink bounds; `fontPx` = target INK height). No digits in the replica → compile ERROR with guidance. Replica font: personal-use license — samurai is already fan-kit non-commercial |
| `assembly`   | (inline, poem) apex word condenses BIG while star particles fly into it                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                      |
| `colorflip`  | (inline, takeover) accent-color crush card + dim kick + squash/settle + loom                                                                                                                                                                                                                                                                                                                                                                         | pairs with fx flash + plate punch/shake                                                                                                                                                                                                              |

Inline setpieces (`hero.inline: true`) live inside the body paradigm — the hero
word stays in `lines`. Embed setpieces own the word: leave it OUT of `lines`
(rail↔climax hand-off), except `panel` + `redact-until-hero`, where the words
appear in the log as `█████` until the decode locks.

A setpiece may additionally return `fgCss/fgHtml/fgJs` — those parts are merged
into the fg alpha page (rail.html), for furniture that must ride ABOVE the matte
(e.g. a verbatim chip that may never be occluded) while the setpiece scenery
stays embedded behind the subject.

## Linkages

- `redact-until-hero` — panel log shows hero words as blocks; un-redacts at lock
- `corrupt-on-last-word` — panel jitters + hue-shifts on the final word
- `disperse-on-last-word` — every visible poem letter scatters back to dust
- `field-is-the-apex` — (lastpage) the blurred future-field rack-focuses at the
  apex: every faint line was the apex word all along; the main instance holds,
  the rest re-blur and die

## Hard rules inherited (do not relax)

- determinism: paused GSAP on `window.__timelines["main"]`, seeded PRNG only,
  set-chains / keyframes, no Math.random/Date.now/CSS-keyframes
- 80 ms word sync (timings come from transcript.json via the strict matcher;
  any uncovered transcript word is a compile ERROR — verbatim completeness)
- apex owns the frame: fg furniture must avoid the setpiece rect or yield
  (`body.yield`) during the hero window
- plate punch/shake ALWAYS post-composite (`_postfx.sh`) so subject + text +
  plate move as one photographed frame (matte never desyncs)

## SVG gotchas (paid for, do not rediscover)

- dash patterns restart on EVERY subpath → sequential per-stroke paths, never
  one dashoffset across a multi-stroke word
- round linecap renders a DOT at dashoffset=len → hide each stroke until its turn
- inline-block trailing spaces collapse → word gaps via margin, not text spaces
- SVG-font glyph y is UP → flip when converting (gen-stroke-path.py does)
- NEVER gsap x/y/scale on raw SVG children: it runs `_parseTransform`/getBBox, and
  zero-area shapes (fan-kit slivers) trip GSAP's bbox hack → `appendChild` on a
  null docElement in injected-gsap contexts (preview-frames, renderer). Jitter
  SVG pieces via `attr:{transform:"translate(...)"}` only; scale/loom belongs on
  an HTML wrapper div. Nuance: a ROOT `<svg>` inside a div has null
  ownerSVGElement → GSAP classifies it as HTML (CSS transforms, no getBBox), so
  scale/skew on the svg root is safe — but copying that onto an inner `<g>`
  becomes the fatal class. attr transforms can't TWEEN — use frame-quantized
  step chains (identical on screen at 24fps)

## Timeline ownership rules (audit-derived, do not relax)

- ONE owner per (target, property) at any instant. A duration tween re-renders
  every tick until it ends — any set/tween on the same property inside that
  window gets visually overwritten a frame later (1-frame ghosts, flash-backs).
  Known shapes: yield dim vs line exit; yield restore vs powercut set-chain;
  per-word line-y bounces with word gaps < 0.22s. The rail emitter guards these
  (bounce ownership tracker, dim clamped ≥ line-in, restore only with ≥0.3s
  runway before exit — else the line exits dimmed, by design).
- Inverted clamps: `Math.max(lo, Math.min(hi, x))` with lo > hi silently pins to
  lo. When a lockup is wider than the frame, CENTER it (x = W/2) instead of
  clamping — decorative bleed must be symmetric.
- The overflow gate only measures elements with direct text nodes — SVG-painted
  setpieces (mask text + rects) are invisible to it. Do not read its "ok" as
  proof for svg lockups; judge those on the preview frames.

## theme.json — full schema

```json
{ "dna": "<themes/*.json name>",            // required
  "lines": [["word","word",...], ...],       // required — verbatim transcript tokens, in order,
                                             //   INCLUDING punctuation ("size.", "noise.")
  "minors": ["word", ...],                   // optional — theme's inline emphasis treatment
  "hero": { "match": "word or phrase",       // required — exact transcript tokens (case-insensitive,
                                             //   punctuation-stripped match); first occurrence wins
            "text": "DISPLAY FORM",          // optional display override
            "out": 5.9, "exitAt": 3.3 },     // optional window overrides (seconds)
  "width": 1280, "height": 720,              // optional, default 1280x720 (theme DNAs are tuned
                                             //   for 16:9; vertical needs a DNA variant)
  "fps": 24,                                 // optional — matte.fps is AUTHORITATIVE when present
  "panelHeader": "..." }                     // optional (panel paradigm)
```

Scene awareness (inherited from the existing typography system): when
`safe-zones.json` is present the compiler re-anchors the hero setpiece to the
measured occlusion bands (`heroBands.profile`, 18–55% occlusion, closest to the
setpiece's preferred height) and `heroAnchor.centerXPct`, width-fits the hero
font to the actual word, and docks panel/poem furniture on
`subject.clearerSide`. Explicit `theme.json` values > scene auto > DNA fallback.

Expected (benign) log noise: `[Browser:REQUESTFAILED] GET source.mp4
net::ERR_ABORTED` during the fg-layer page load, reel-glyph overflow lint
lines, and `media_missing_data_start` — all cosmetic; the render is good if
render-theme.sh exits 0 and prints the gates summary.

## Authoring a project (this is ALL a user writes)

`<project>/theme.json`:

```json
{
  "dna": "ordnance",
  "lines": [
    ["The", "stars", "were", "only", "limited"],
    ["by", "the", "pixel", "size."],
    ["It's"],
    ["what", "you", "can", "actually"],
    ["recover", "from", "the", "noise."]
  ],
  "minors": ["stars"],
  "hero": { "match": "remarkable" }
}
```

- `lines` follow the transcript verbatim, in order (compile error otherwise);
  every transcript word must be covered by `lines` ∪ `hero.match` — the example
  above omits "remarkable" from `lines` precisely because `hero.match` covers it
  (it slots between `["It's"]` and `["what",...]`)
- leave the hero word(s) out of `lines` for embed setpieces; keep them for
  inline setpieces and for panel+redact
- `takeover`: each line is one CARD — group by beat (1–2 words), not subtitle
  length; `panel` scrolls automatically past ~5 lines (terminal scroll)
- the ordnance "charge" is an edge vignette + rail yield (the center stays
  clean by design) — judge it at the frame corners, not the center
- `minors`: words that get the theme's inline emphasis treatment
- preview first: `node scripts/make-theme.cjs <project>` then
  `node scripts/preview-frames.cjs <project> <t1> <t2> ...` (Visual QA)
- then: `bash scripts/render-theme.sh <project>` → **`final_fx.mp4`** (the
  deliverable; `final.mp4` is pre-plate-reaction)

Prereqs identical to other modes — `prepare.sh` outputs: transcript.json,
frames_fg/, matte.fps, safe-zones.json (scene awareness), source.mp4.
frames_bg/ is only needed by preview-frames.cjs, not by the render.

## Adding a theme DNA

Copy a `themes/*.json`, change identity fields. You may ONLY combine existing
paradigm/setpiece/linkage names — if the look you want needs a new mechanism,
that is a registry contribution (this file + make-theme.cjs), reviewed like an
engine change. A DNA that needs per-word visual tuning to ship is rejected:
**any input, zero hand-fixing** is the acceptance bar (the draw-on lesson).
