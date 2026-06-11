---
name: embedded-captions
description: Add captions to a talking-head video. ONE catalog of 17 visual identities (CATALOG.md), three engines behind it: rail-surface identities (verbatim lower-third RAIL + one EMBED climax behind the subject — the default for explainer/voiceover), column-flow identities (every caption composited INTO the scene — matte occlusion + mix-blend; cream/ink/editorial/keynote/documentary/loud/neon/glitch/chrome/velocity), and themed constitutions (ordnance/terminal/neonsign/stardust/stomp — e.g. console-log captions with a glyph-decode climax, or a neon sign WRITTEN stroke-by-stroke). Route by identity, never by mode. Trigger on "captions/subtitles", "embed/cinematic captions", "VFX captions", a named identity, or VFX-grade caption asks ("炸/特效/酷炫字幕", "像 AE 做的"). Embedding every word is wrong for most talking-head content. Use when the user asks for "captions / subtitles", "embed/embedded/cinematic captions", "embed captions into the scene", "captions behind the subject", or similar. Pipeline: transcription → PP-MattingV2 matting → hyperframes HTML render → ffmpeg overlay. Requires hyperframes (github.com/heygen-com/hyperframes) and a single-subject clip. NOT for designed graphic overlays / lower-thirds / data callouts layered on footage (→ graphic-overlays) or building a video from scratch (→ the creation workflows); unsure captions-vs-overlays → /hyperframes-read-first.
metadata:
  tags: captions, embedded-captions, occlusion, matting, talking-head, pp-matting, whisper, ffmpeg, cinematic
---

# Embedded Captions

> **Confirm the route before you build.** This skill adds **captions / subtitles** to an existing single-subject talking-head clip; the footage plays **untouched** (Theme mode's register-gated plate beats are the one sanctioned exception). For designed **graphic overlays / lower-thirds / data callouts** layered on footage → `/graphic-overlays`; building a video **from scratch** → the creation workflows. Routed here on a vague ask, or unsure captions-vs-overlays? **Read `/hyperframes-read-first` first.**

**One catalog, picked up front** ([CATALOG.md](CATALOG.md) — 17 identities; the three engines behind it are backend detail). **Standard** (default) builds a clean verbatim **rail** (lower-third subtitle carrying most text) + an **embed** climax composited _into_ the scene behind the subject at the peak. **Cinematic** is pure embed — no rail, every caption composited behind the subject (hero typography, accumulation, occlusion as the effect). **Theme** is a complete themed constitution — body paradigm × hero setpiece × front fx × plate reaction, composed from registries ([themes/README.md](themes/README.md)): `ordnance` `terminal` `neonsign` `stardust` `stomp`. Most explainer / voiceover is **Standard**; **embed is the scarce, earned peak** — embedding every word is the common mistake; Theme is for VFX-grade asks ("炸", "特效", "像 AE 做的").

---

## Operational flow (TL;DR)

The craft prose below is long; the **pipeline itself is short** — and everything
deterministic is computed or compiled, never hand-written:

1. **Decision gate** (refuse bad clips) → **pick ONE identity from [CATALOG.md](CATALOG.md)** (17 identities; engine/compiler derived by lookup — never surface a mode/category question)
2. `hyperframes init` → **`bash scripts/prepare.sh <project>`** (matte ∥ transcribe ∥ audio-envelope in parallel, then safe-zones v2 with scene palette/optics/lighting — one command, nothing forgotten)
3. **author a small JSON of creative choices** (read `safe-zones.json` first):
   Standard → `standard.json` → **`make-standard.cjs`** compiles index.html + rail.html (timings from the transcript, rail pre-emption, the rail↔climax hand-off, canvas=source length — all generated, correct by construction);
   Cinematic → `plan.json` → `fill-timings.cjs` → `fit-fonts.cjs` → `make-composition.cjs`
4. **Visual QA**: `node scripts/preview-frames.cjs <project>` → faithful composite previews in ~2s/frame (no render). Check § Visual QA before paying for a render.
5. `render-and-composite.sh` → gates (timing / occlusion+hero / overflow / hand-off) → `final.mp4`

Load-bearing rules people miss:

- **rail (default) + embed (promotion).** `drop` (filler, not shown) / `rail` (verbatim lower-third subtitle, in front, carries most text) / `embed` (a peak word composited behind the subject). **Standard mode does both**, embedding only the peak(s). See **§ Caption model**.
- **The video is delivered UNTOUCHED (Standard/Cinematic; **Theme mode's PLATE budget is the one sanctioned exception** — register-gated reaction beats (charge-dim, punch, shake, grain) defined per theme DNA and applied AFTER the matte composite so subject+text+plate move as one frame)** — captions are the only thing added; the matte just lets the subject occlude the embed track. Never grade/recolor/scanline the footage.
- Scripts auto-resolve `source.mp4` and the source's **native fps**; transcription prefers **WhisperX** (wav2vec2 forced alignment — word timings tight enough for the 80ms gate; via `uvx`, auto-falls back to hyperframes' whisper.cpp when unavailable; measured on the test clip: whisper.cpp placed words up to **1.3s early into pauses**, WhisperX matched the RMS energy onsets within ~0.1s).
- Two rulebooks: **rail → [references/rail.md](references/rail.md)** (thin), **embed craft → [references/composition-craft.md](references/composition-craft.md)** (rich, embed-only). Skim by need.

---

## Caption model — rail + embed

Every spoken phrase is one of three things:

|           | What                                             | How it's shown                                                                                                                                                    |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **drop**  | filler — um/uh, stutters, self-corrections       | not shown                                                                                                                                                         |
| **rail**  | the default — ordinary spoken content (verbatim) | clean lower-third subtitle, **in front**, readable. A punch word can get an inline `emphasis` highlight (accent colour / active-word pop) — it stays on the rail. |
| **embed** | a promoted peak — the headline beat              | one big word composited **behind the subject** (matte occlusion), designed entrance + exit                                                                        |

**The rail carries most of the text; embed is the scarce, earned peak.** Scarcity is **per beat/block, not per clip**: ≤1 hero per block (thought), never two co-visible, ≥ a beat of air between hero windows (the compiler warns under 0.6s). A short clip → usually 1–2; a long explainer → ~one per section. Among multiple heroes, the **largest authored one is the APEX** (it alone gets the full lockup embed + width-fit raise); smaller ones are **MINOR peaks** that ride their column as oversized emphasis lines (fg, damped motion) — not every beat needs the matte showcase, which is exactly what keeps the apex an event. Embedding every word is still the common mistake.

Rail-surface identities build exactly this (rail = `rail.html`, embed = the climax in `index.html`). Column-flow identities drop the rail and make everything embed-style — recommend them only for mood-over-verbatim asks, never for explainer / voiceover where the words must read (CATALOG.md encodes this per identity).

---

## Step 0 — pick ONE identity from the CATALOG

**One front-end, three engines behind.** The user picks an IDENTITY from
[CATALOG.md](CATALOG.md) (17 entries: 12 classic + 5 themed); the engine,
compiler and authoring file are derived by lookup from the catalog row.
**Never surface "Standard vs Cinematic vs Theme" as a question** — those are
backend names (a product has one UX even with several engines). The catalog
encodes everything routing needs: reading surface, voice, recommend-for, scene
needs, adjacency notes for the genuinely-close pairs (loud↔ordnance,
neon↔neonsign, cream↔stardust).

Procedure: probe the clip → shortlist 2–3 identities from the catalog →
recommend ONE with a one-line why → **the user picks** → author that identity's
file. Identities are engine-locked (no cross combos; opening one is a
validation event — see dna/README.md).

**Always present your recommendation and let the user pick before you author.** Don't silently default.

(The full identity table lives in [CATALOG.md](CATALOG.md) — single source of truth for routing. The engine docs below describe each backend's authoring contract.)

**Recommendation heuristic**: use the "Shortlisting heuristics" in [CATALOG.md](CATALOG.md) — they are identity-level (e.g. "炸" shortlists ordnance/stomp/terminal/loud and picks by WHAT should explode), never category-level. Unsure → `keynote · rail`.

- rail-surface identities → read [modes/standard/PIPELINE.md](modes/standard/PIPELINE.md) (the contract), author `standard.json` with the validated DNA from your catalog pick (legacy 54-template path still exists but is not the recommended route).
- **Cinematic** → write `plan.json` for a locked template, compiled by `make-composition.cjs`.
- **Theme** → read [themes/README.md](themes/README.md), author `theme.json`, run `scripts/render-theme.sh` (compiles + renders + plate reaction → **final_fx.mp4**).

---

## Decision gate — RUN FIRST

Probe the video and classify the scene before either mode.

```bash
ffprobe <video.mp4>                    # specs
ffmpeg -ss <t> -i <video.mp4> -vframes 1 sample.png   # at 20/50/80%
```

Read the samples. Refuse if:

- Multiple speakers / hard cuts (split & render each shot, or refuse)
- No human subject (this skill is for talking-head)
- Under 3 seconds, **no speech**, or face never clearly visible — `transcribe.cjs` warns when audio is near-silent (Whisper hallucinates words like "Thank you." over silence); **heed it and refuse** rather than caption fabricated words
- **Source already has burned-in captions / subtitles / heavy text graphics** — adding a second caption system conflicts and the footage ships untouched (no covering/inpainting). Burned text often appears only mid-clip: sample a **1fps contact sheet** (`ffmpeg -i in.mp4 -vf "fps=1,scale=160:-1,tile=10x5" sheet.png`), don't trust 3 spot frames.
- **Transcript is garbage** — non-native/heavy-accent speech can transcribe into confident gibberish. Sanity-read `transcript.json` before authoring; if it doesn't parse as language, try `WHISPER_MODEL=medium` once, else refuse (a verbatim rail of fabricated words is worse than no captions).
- Busy handheld with fast motion (matte flickers)

### Pre-flight probes (cost nothing, prevent the worst failures)

1. **Shot-cut probe.** Sample frames at 20%, 50%, 80%. If a different subject/scene appears, **trim the clip** before the cut.
2. **Letterbox / pillarbox probe.** Black bars on the first frame? Compute safe content rect and constrain caption placement inside it.
3. **Luminance probe.** Sample the caption region's average luminance — `<60` → light text reads as-is, `60-180` → add the glyph scrim, `180+` → opaque text + scrim (never bare light text). **Cinematic templates are cream+`screen` and LOCKED** — use this probe to _pick a fitting identity_ (bright scenes → `ink`, or a rail-surface identity like `keynote · rail`), never to recolour one; **Standard** you set in the HTML per the chosen template.
4. **Identity recommendation by tone (you recommend; the user picks — see Step 0 + CATALOG.md).** explainer / interview / must-read words → rail/panel-surface identities; poetic / social / "cinematic" → column-flow identities by register; "炸 / 特效 / VFX" / named worlds → themed identities. When unsure → `keynote · rail` (words read, scene safe) — but present a shortlist and let the user choose.

---

## Pipeline — 5 steps

```
1. hyperframes init <project> --non-interactive --video <video.mp4> --skip-skills
2. bash scripts/prepare.sh <project>       # matte ∥ transcribe (parallel) → safe-zones. One command.
                                           #   → frames_fg/ transcript.json safe-zones.json
3. [AGENT STEP — the only creative step] author a small JSON; see below by mode
   Standard:  author standard.json → node scripts/make-standard.cjs <project>
   Cinematic: author plan.json → node scripts/fill-timings.cjs → fit-fonts.cjs → make-composition.cjs
   Theme:     author theme.json → bash scripts/render-theme.sh <project>   (compiles + renders + plate fx)
4. node scripts/preview-frames.cjs <project>   # ~2s/frame composite previews → § Visual QA (BEFORE the render)
5. bash scripts/render-and-composite.sh <project>  # gates → final.mp4 + history/ snapshot
   (Theme mode: SKIP steps 3b/5 — render-theme.sh already runs compile + render-and-composite
    + _postfx.sh; the deliverable is final_fx.mp4, final.mp4 is pre-plate-reaction)
```

Step 3 differs by mode:

### Step 3 — Cinematic mode (pure embed)

1. **Read `safe-zones.json` first.** Narration planes go in **`zones.hugLeft`/`hugRight`** — clean strips ABUTTING the silhouette (text far from the body reads as floating, not embedded; far corners are the fallback, not the default). The hero defaults to `heroAnchor`/`heroBands.best` (centered ON the subject, ~30–55% occluded). `recommendation:"fg"` moves NARRATION in front for legibility; **the hero stays embedded whenever `heroBands.feasible`** — hero-fg is the last resort.
2. **The DNA is the identity you picked in Step 0** (CATALOG.md) — do not re-open the choice here. Sanity-check it against the scene (bright hero band luma > 150 wants `ink`; full pick guidance lives in the catalog, covering all ten incl. neon / glitch / chrome / velocity). State your pick + why; the user decides. The DNA locks type/palette/blend/motion + hero three-act; safe-zones v2 (`palette`/`optics`/`lighting`) parameterizes it to THIS scene automatically.
3. **Author `<project>/cinematic.json`** — `"dna": "<name>"` + thought-BLOCKS, not raw groups: each block = lines of words (grouped 2–5 at clause boundaries) + the plane it stacks in + per-line `css` (size/weight/style only — no positions) + at most ONE line marked `"hero": true` (the promoted word; `"text"` for display form). Schema: `scripts/make-cinematic.cjs` header.
4. **Compile**: `node scripts/make-cinematic.cjs <project>` — lowers blocks → plan.json → index.html. Generated for you: transcript-sequenced timings, accumulate-within-block, page-flip-between-blocks, **the hero LOCKUP** (a hero block's pre-context, HERO and post-context stack as ONE bonded composition centered on the subject — reading order top→bottom = spoken order by construction; context floats in FRONT while the hero embeds BEHIND = the depth sandwich; a mass rule keeps the hero dominating its context), apex/minor hero split, **reading order by construction**, fg fallback per safe-zones. Then the gates run as usual. _(Hand-authoring plan.json directly remains possible for designs blocks can't express — then run `fill-timings.cjs` + `fit-fonts.cjs` + `make-composition.cjs` yourself.)_

### Step 3 — Standard mode (rail + embed)

**Read [modes/standard/PIPELINE.md](modes/standard/PIPELINE.md) FIRST** — it is the contract (the `standard.json` schema + how the compiler realizes the hand-off) and overrides the library's `_anatomy.md` for this skill.

1. Read the transcript; pick the **promoted word** (the headline beat → climax) — prefer a clause-final word. Everything else rides the **rail**, verbatim.
2. **Pick a VALIDATED rail DNA** (`keynote` or `cream` — see the category-lock matrix in [dna/README.md](dna/README.md); other DNAs ERROR under Standard until validated) — `"dna": "<name>"` in standard.json fills font / fills / accent / climax-entrance and wires the climax three-act (rail yields → per-letter RMS-coupled entrance → breathe). _(Legacy alternative: pick up to 3 of the 54 archived templates for their style tokens — still works, but DNA-first is the recommended path.)_
3. **Author `<project>/standard.json`** — your creative choices only: the DNA name (or explicit tokens — your fields always win over the DNA), rail line grouping (2–5 words/line at clause boundaries — include the promoted word where spoken), and the climax block (`match`/`occurrence`/`text`/`top_pct`/`font_cqh`/`entrance`/`exit`). Schema: [modes/standard/PIPELINE.md](modes/standard/PIPELINE.md) § standard.json.
4. **Compile**: `node scripts/make-standard.cjs <project>` → index.html + rail.html + a derived plan.json. The compiler pulls every word's timing from the transcript by sequence, generates rail pre-emption + the rail↔climax **hand-off** (promoted word lifted out, pre-line freeze, climax holds to end of thought, page-flip), sets canvas = source length, and line-fits the climax. **Don't hand-edit the generated HTML** — change standard.json and recompile.
5. Render: the timing / occlusion(+hero) / overflow / hand-off gates all run (the derived plan.json lights them up); with the compiler they pass first try.

### Step 3 — Theme mode (themed constitution)

**Read [themes/README.md](themes/README.md) FIRST** — paradigm/setpiece registries, linkages, hard rules, and the exact `theme.json` schema.

1. **Pick a theme DNA** by content register (each `themes/<name>.json` has `voice` + `when`). State your pick + why; the user decides.
2. **Author `<project>/theme.json`** — `dna`, `lines` (verbatim, transcript order; 1–5 words each — for `takeover` each line is one CARD), `minors` (emphasis words), `hero:{match}` (the climax word/phrase; leave it OUT of `lines` for embed setpieces, keep it IN for inline setpieces and panel+redact).
3. **Render**: `bash scripts/render-theme.sh <project>` — compiles (verbatim-completeness gate at compile time), renders both layers, composites, applies the plate reaction → `final_fx.mp4`. Use `preview-frames.cjs` between compile and render for Visual QA.

---

## Visual QA — preview BEFORE you render

`node scripts/preview-frames.cjs <project> [t…]` composites **faithful preview frames in ~2s each**
(caption layers screenshotted at seek-time + real video frame + matte occlusion + rail overlay = what
the final composite will look like at that moment). Default samples = each group/climax window.
A full render costs minutes — never use it to _discover_ layout problems.

Check the previews (`<project>/preview/sheet.png`) against this list — these are the failures the
geometric gates **cannot** catch:

1. **Washout** — light text over a bright region (window/sign/sky): unreadable → move the plane or change DNA/mode (bright scene → `ink`).
2. **Text-on-text** — captions over the scene's own text/graphics, or two caption groups colliding.
3. **Reading order** — on-screen vertical order must match spoken order; the hero must not sit below later words.
4. **Hero presence** — the climax should be BIG and visibly behind the subject (~30–55% occluded), not a floating label in a margin.
5. **Balance** — one coherent column/band, not scattered fragments; margins breathing; nothing clipped.

Then the **5 positive checks** in [references/reference-bar.md](references/reference-bar.md)
(poster test · timid test · one-glance hierarchy · scene handshake · dead-air audit) — the
failure list keeps a render from being broken; the positive list is what makes it _designed_.
Ship when both pass.

**Fresh-eyes review (recommended for anything user-facing):** you have confirmation bias about your
own layout. If you can spawn a subagent, give it ONLY the preview sheet + this checklist and ask for
PASS/FIX verdicts per frame ("review these caption previews against the 5-point checklist; answer
PASS or the specific fix per frame"). Apply fixes in standard.json / plan.json, recompile, re-preview —
each loop costs seconds. Render once, when the previews pass.

---

## The DNA registry — ten visual languages (replaces the template catalog)

Both modes draw from **[dna/](dna/README.md)** — six art-directed visual languages that
**parameterize per scene** (accent sampled from the footage, contact shadow along the
measured light direction, depth-match blur, RMS-coupled hero amplitude):

| DNA             | Register       | Scene fit                                       | Voice                                                                                              |
| --------------- | -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **cream**       | premium-warm   | dark/mid warm scenes                            | Inter + warm cream + screen; glowing emergence hero (successor of cinematic-cream)                 |
| **ink**         | premium        | **bright scenes (luma > 150)**                  | near-black multiply — type printed ON the wall; the bright-scene answer                            |
| **editorial**   | editorial-luxe | introspective / fashion / poetic                | Bodoni Moda, lowercase-italic hero — magazine elegance                                             |
| **keynote**     | tech-premium   | product / launch                                | opaque white Inter 800, dead-center stillness                                                      |
| **documentary** | formal         | interview / serious                             | burn-in reveals, no hero — gravitas IS the style                                                   |
| **loud**        | loud           | hype / sport / social                           | Anton + scene-sampled accent, single-unit slam + ripple; body ANNOUNCES in front (`bodyLayer: fg`) |
| **neon**        | loud-cyber     | cyberpunk / nightlife / tech-noir (dark scenes) | electric-cyan signage, ignition flicker, the hero powers ON like a sign                            |
| **glitch**      | loud-cyber     | digital / hacker / AI                           | RGB-split echoes snap together on landing; machine-percussive timing                               |
| **chrome**      | loud-luxe      | Y2K / fashion-tech / music                      | liquid-metal gradient hero + one sheen sweep during the hold                                       |
| **velocity**    | loud-sport     | sport / auto / fitness                          | every word arrives along its motion vector (streak+skew), hero passes with speed trails            |

Pick by `safe-zones.json` (`heroAnchor.bandLuma`, `palette.temperature`) × content
register — [dna/README.md](dna/README.md) has the decision rule. Authoring:
`cinematic.json` / `standard.json` take `"dna": "<name>"`.

The engine generates the **hero three-act** from the DNA (no authoring needed):
co-visible captions dim (setup) → per-letter entrance with amplitude ∝ spoken loudness
(impact) → breathe + glow until exit (afterglow).

(Legacy: `plan.template:"cinematic-cream"` maps to `dna:"cream"` automatically. The
54-file Standard template library and the archived memory-wall / champion /
portrait-header remain readable as **style-token references**, but DNA-first is the
recommended path for all new work.)

---

## Aesthetic decision — tone × shot × platform (input to the catalog shortlist, NOT a second router)

Classify the clip on 3 axes and feed the result into CATALOG.md's shortlisting — this section never picks a mode/engine by itself:

**Tone** (what feel does the content have?)

- documentary | conversational | energetic | poetic | keynote | investigative | music-video

**Shot** (what's the framing?)

- close-up (head + shoulders) | mid-shot (torso+) | wide (full body+) | cut-montage (mixed shots)

**Platform** (where will it play?)

- 9:16 portrait (TikTok/IG/Shorts) | 16:9 landscape (YouTube/web) | 1:1 square | broadcast export

Cross-reference in [references/direction-catalog.md § Classification matrix](references/direction-catalog.md) for direction language — then return to [CATALOG.md](CATALOG.md) to shortlist identities (this matrix informs the shortlist; the catalog is the only routing surface).

## Composition craft (embed track) — read before embedding

The full **embed-track** playbook lives in **[references/composition-craft.md](references/composition-craft.md)**:
transcript role-annotation, phrase grouping, planes & clean-zone anchoring, zone coherence,
climax pop & readability, edge-breathing, the occlusion 3-step judgement, and
accumulation/persistence. It governs how a _promoted_ phrase sits INTO the scene — read it
before authoring any embed (Cinematic `plan.json` or Standard `index.html`). The default **rail**
track has its own, much simpler spec → **[references/rail.md](references/rail.md)**.

---

## Shared knowledge

| Doc                                                                      | What                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| [references/rail.md](references/rail.md)                                 | **The rail track** — standard lower-third subtitle spec (the default; carries most text).                                          |
| [references/composition-craft.md](references/composition-craft.md)       | **The embed-track playbook** — grouping, planes, climax pop, occlusion judgement, accumulation/persistence. Read before embedding. |
| [dna/README.md](dna/README.md)                                           | **The DNA registry** — six scene-parameterized visual languages; how to pick.                                                      |
| [references/reference-bar.md](references/reference-bar.md)               | **The taste bar** — per-register world-class references + the 5 positive checks.                                                   |
| [references/aesthetic-principles.md](references/aesthetic-principles.md) | **The 18 rules.** Beat Veed AI on taste. Read first.                                                                               |
| [references/motion-vocabulary.md](references/motion-vocabulary.md)       | 10 named motion primitives + tone→timing lookup                                                                                    |
| [references/direction-catalog.md](references/direction-catalog.md)       | 10 ship-ready aesthetics + tone×shot×platform matrix                                                                               |
| [references/anti-patterns.md](references/anti-patterns.md)               | Bugs already locked out (CoreML, letter-spacing reflow, etc.)                                                                      |
| [references/scene-types.md](references/scene-types.md)                   | When a wall surface is usable (4 conditions)                                                                                       |
| [references/layout-heuristics.md](references/layout-heuristics.md)       | Plane positioning, clean-zone selection, crown 3 conditions, pillarbox math                                                        |
| [references/typography-presets.md](references/typography-presets.md)     | Font-size × column-width matrix (starting points)                                                                                  |
| [references/caption-grouping.md](references/caption-grouping.md)         | Word → group rules (pauses, sentence boundaries)                                                                                   |
| [references/failure-modes.md](references/failure-modes.md)               | Long tail of dev gotchas                                                                                                           |
| [references/bespoke-vs-presets.md](references/bespoke-vs-presets.md)     | Why presets fail sometimes; clone-and-tweak pattern                                                                                |

**Read the aesthetic principles and direction catalog FIRST.** Everything else is implementation detail.

---

## Non-negotiables

- **Face must never be 100%-covered continuously** — every 0.3s window, face bbox ≥30% uncovered.
- **WCAG contrast** — final render lints; fix palette if it fails.
- **Deterministic** — no `Math.random()`, no `Date.now()`, no `repeat:-1`.
- **Never grade/recolor the video.** The footage ships untouched — captions are the only addition. No full-frame scanlines / duotone / darken / vignette over the a-roll. Cyberpunk/CRT texture belongs _inside_ a caption element, not over the whole frame.
- **Rail-first for talking-head / explainer.** Don't embed the whole transcript — most text is the rail; embed only peaks. Embedding everything is the default mistake.
- **Embed is scarce + spaced.** ≤1 embed per sentence/beat, never two adjacent or co-visible, ≥ a beat apart, at most one `apex`. climax = per-beat peak, **not** "the single payoff of the entire clip."
- **Matte = the subject (PP-MattingV2 human matting, Apache-2.0).** It segments people, not props — a gripped mic/cup is best-effort and may not be fully captured, and bright incidental objects can leak in. Sample `frames_fg/` and sanity-check before relying on tight prop occlusion.
- **safe-zones is PROP-BLIND — eyeball every band you use.** Zones/heroBands score _subject_ occlusion + luma only: a mic, telescope, or screen sitting inside a "clean" zone is invisible to them (and a prop leaking INTO the matte skews `heroAnchor.centerXPct` off the person). Before authoring, extract ONE frame of each band you intend to use; if a prop lives there, measure its bbox and move/shrink the plane. Two real cases shipped clean only because the agent did exactly this. (Auto prop-saliency is a known gap; zones' `peakLuma` only catches _moving_ bright objects.)
- **Captions stay on-frame.** Cinematic mode hard-gates frame-overflow; Standard mode runs `check-overflow.cjs` as a WARNING (intentional bleed is the only exception — read the warning).
- **Each caption ≥ 0.5s on screen** — shorter = unreadable.
- **Word timings must match transcript.json within 80ms** — a caption firing 500ms off-beat destroys the scene illusion. `render-and-composite.sh` runs `check-timing.cjs --strict` before rendering; fix drift before the gate. Never pack multiple transcript words into one entry (e.g. `"FUTURE OF"` or `"IT <br> ALL"` with one start/end) — the second word inherits the first's timestamp and fires early. Split them into separate word entries with their own timings, even if you want them on the same visual line (use CSS `white-space` / natural wrap instead of `<br>`). Creative substitutions where caption text ≠ transcript (e.g. `"15%"` replacing `"fifteen percent"`) are supported — register them in `CREATIVE_SUBS` inside `check-timing.cjs`.
- **Group windows must envelop their words** — `group.in ≤ min(word.start)` and `group.out ≥ max(word.end)` for every group. If `group.in` is later than a word's start, the word is silently delayed until the container mounts (we've shipped 800ms lag bugs from this). The validator enforces this.
- **No two caption groups may overlap in both time AND screen region** — overlapping-in-time captions create text-on-text pileups. Options: (a) **spatial separation** — place each group in a non-overlapping vertical band so they can coexist (memory-wall cascade style); (b) **handoff** — set the earlier group's `out` ≤ the next group's `in` so only one is on screen; (c) **deliberate layered typography** — add `"allow_overlap": true` on one of the groups to silence the validator. The validator estimates each group's vertical bbox from its CSS and flags collisions. Pick (a) by default — it's what makes cinematic-cream feel like a poem accumulating, not a subtitle track replacing itself.
- **Screen-blend fails on bright backgrounds (>180 luminance).** **Cinematic** templates are cream + `screen` and that DNA is **locked** (the plan can't recolour them) → on a bright backdrop they wash out, so pick `ink` (letterpress built FOR bright surfaces) or a rail-surface identity (`keynote · rail`) rather than overriding a look. In **Standard**, set `mix-blend-mode: normal` + opaque colour directly in the HTML.
- **Don't animate `letter-spacing` or `filter:blur` on word entrance** — inline-block reflow causes line-jumps.
- **CoreML banned for matting** — the onnxruntime CoreML EP's mixed-precision partitioning corrupted face alpha (observed with the previous RVM engine; don't re-try it). Matting is CPU-only (~2 fps @1080p ≈ 2-3 min per 10s clip; budget for it on long clips).

---

## Dependencies

- **hyperframes**, built (`packages/cli/dist/cli.js`). Scripts auto-resolve the checkout: `HYPERFRAMES_ROOT` env → repo root if this skill ships _inside_ hyperframes → `~/Downloads/hyperframes`. Build with `bun install && bun run build`.
- **No Python — Node-only. (One exception: Theme's `drawon` setpiece shells `python3 scripts/gen-stroke-path.py` at compile time — check `python3` exists before recommending the neonsign theme.)** Everything runs on the toolchain hyperframes already ships: PP-MattingV2 matting via **`onnxruntime-node`**, image/alpha math via **`sharp`**, layout/occlusion/overflow via **`puppeteer`**, plus **`ffmpeg`**. The scripts auto-resolve these from the hyperframes checkout — nothing extra to install.
- **Transcription = hyperframes' Whisper** (whisper.cpp — native C++, no API key, no Python). `transcribe.cjs` wraps `hyperframes transcribe`; hyperframes auto-installs whisper.cpp (Homebrew or source build) and the model on first run. Falls back to an existing word-level `transcript.json` if present.
- **Source video** — `matte.cjs` / `transcribe.cjs` auto-resolve `source.mp4` (or glob the clip / read `hyperframes.json`), so `hyperframes init --video X.mp4` needs no manual rename.
- **fps** — `matte.cjs` extracts at the source's native rate and records `matte.fps`; `render-and-composite.sh` uses that so the matte stays frame-aligned.
- `assets/ppmattingv2_stdc1_human_544x960.onnx` (34 MB, Apache-2.0) — **ships with the skill** (no auto-download; the upstream ONNX exports have no stable public URL). `MATTE_MODEL` env can point at another `<H>×<W>.onnx` export (e.g. 1088x1920 for max detail); `MATTE_EMA` tunes temporal smoothing (default 0.5).

If a hard dependency is missing, STOP and ask the user — don't silently skip steps.
