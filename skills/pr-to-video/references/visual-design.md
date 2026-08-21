# Visual design — PR-to-video per-frame shot method

> The method behind **Step 4 (Frame visual design)**. You (the orchestrator) read it to **enrich `STORYBOARD.md` frames in place** — story-design wrote the skeleton (each frame's `scene`, `voiceover`, `transition_in`, the narrative fields, and optionally a candidate blueprint id); you add how each frame **looks and moves**. The unit you write per frame is a **time-coded shot sequence** — a shot directed across its whole duration, not a static slide. You write **no HTML** (that's the frame workers). A PR video is **mostly invented** — typography, number-lockups, mechanism diagrams — so you **design** those elements; the two exceptions are **code beats** (a ready-made `code-*` registry block) and the **credits close** (real contributor avatars), both covered below. `frame.md` is your palette/type truth by role. Layout is a compact vocabulary in this file (the **Layout** section below), stated inline per Scene; motion vocabulary + the motion doctrine + the seek-safe core → `motion-language.md`; the proven shapes → `../hyperframes-animation/blueprints-index.md` + `blueprints/<id>.md`; the `code-*` blocks → `code-vocabulary.md`; concrete rules resolve in Step 5 from this skill's local `../hyperframes-animation/rules/`. Adding palette theory or a generic font rule here? Wrong home — `frame.md` + `hyperframes-creative`.

## The unit is a time-coded shot sequence

A frame's visual layer is **a sequence of time windows paced to the voiceover**, not a bag of effect tags. The failure that reads as PowerPoint is **front-loading**: the agent rushes the whole canvas on screen in the first ~25%, and then it just sits. A time-coded shot sequence written **against the VO** makes that impossible: each window states what is on screen and what is moving, and **nothing appears before the voiceover reaches it.** In a PR explainer the development often _is_ the reveal — the diff hunk typing in, the before→after morph, the request-retry diagram running, the impact stat landing. Let the build _be_ the message.

Write each frame as a handful of windows cued by the spoken line:

```
Scene 1 (0.0–Xs):  only what the VO is saying at t=0 enters — never the whole canvas
Scene 2 (Xs–Ys):   the next piece reveals as the VO names it (a file chip / the hunk / a node / a stat)
  …                one window per spoken cue — as many or as few as the line calls for
Scene N (…–end):   content has resolved; hold the read (stillness; subtle jitter at most)
```

- Each `Scene` line names **what's on screen**, **what moves in this window**, and **where it sits** (layout, inline). Times are real seconds across the frame's `duration`.
- **Pace reveals to the voiceover; never front-load.** This is the core anti-PowerPoint mechanism (→ `motion-language.md` Part 2 Rule 2). At t=0 show only what the VO is saying then; reveal each further piece — a line, a file chip, the hunk, a stat — **when the VO names it**, spreading reveals across the shot and especially the **back ~50%**. **The window count = the number of spoken cues the line calls for.** There is **no fixed count and no mandatory "middle" act**; the only sin is dumping everything up front.
- **End on a held read.** Once the content has resolved it holds and reads — **prefer stillness to bad motion**: no forced camera drift, no lazy breathing, no back-half pan/push; at most a subtle jitter keeps it alive (→ `motion-language.md`). Only the final frame has a real exit; every other frame's exit is the harness transition (story's `transition_in`).
- A **deliberately held** frame — content already revealed, now reading still — is legitimate and often right (a climax, a breather). The failure is never "too still"; it is **front-loaded-then-frozen**. Place held beats deliberately for rhythm (allocate them in `## Video direction`).

## Pick the shape — instantiate a blueprint

Don't invent each shot from scratch. The frame's **role** (its `type` / `beat`) points to a proven shape:

1. **Match the role to a blueprint.** Open `../hyperframes-animation/blueprints-index.md`, find the frame's role in the **role→blueprint menu**, and pick the blueprint whose intent fits this beat (story may already have named a candidate id — confirm or override it). Read that `blueprints/<id>.md`: it is a short, domain-agnostic, **time-coded shot template with `[slots]`** and a named **signature move**.

2. **Instantiate its `[slots]` with THIS frame's content** — three postures:
   - **Reproduce** — the blueprint fits the beat and your content maps onto its slots cleanly. Fill every `[slot]` and follow its Scene timing.
   - **Adapt** — the _structure_ fits but the content / surface doesn't. State **what you keep / what you change** in one line, then write the adapted Scene lines. You may never drop the **signature move**, and you keep the reveals **paced to the VO**.
   - **Compose** — no blueprint fits the beat. Build the shot from the **motion vocabulary** in `motion-language.md`: still pace reveals to the VO. Mark it `blueprint: compose`.

3. **Keep the signature move.** Whichever posture, the blueprint's signature move is the spine of the shot — carry it through.

> A **code beat** is the one place you don't pick a blueprint for the centerpiece — the `code-*` block _is_ the shape (see **PR code beats** below). You still write the Scene sequence for the surrounding surface.

## What you add to each frame

Story-design's `## Frame N` block already carries the narrative. You append the shot. Story's `scene` / `voiceover` / `transition_in` / role fields stay untouched.

```
## Frame 4 — The retry fix
- scene: the request() retry hunk lands on the navy code surface   ← refine only if it could read sharper
- voiceover: "…"            ← story's; leave it
- transition_in: crossfade  ← story's; leave it
- type: diff                ← story's (PR-native)
- persuasion: Show-the-change
- beat: clarity
- blueprint: compose        ← code beats compose the surround; the block owns the code motion
- focal: code-diff — the request() retry block, ~6 lines   ← you add: the code-* block IS the focal
- roles: code surface = foreground subject · file header = supporting · dim grid = background
- sfx: keyclack-soft, soft-confirm

Scene 1 (0.0–1.0s): the navy Code Surface window seats in (scale-in + soft shadow), file header "client/request.ts" types on — Centered, ~60% of frame. Slow push-in underneath.
Scene 2 (1.0–3.2s): the camera settles onto the hunk; the `code-diff` block runs its own before→after on its cadence (the worker fits it to the duration) — you do not re-specify the code motion.
Scene 3 (3.2–4.5s): a coral underline draws on the changed line as the VO names it; a `+6/−2` count-up ticks beside the header; settles and holds STILL.
```

The lightweight tags:

- **`blueprint:`** — the id you instantiated (with `(Reproduce)` / `(Adapt)`), or `compose`. One id per frame.
- **`focal:`** — for a concept/mechanism beat, the **invented** hero (a hero word, a diagram, a number-lockup); for a **code beat**, the **`code-*` block** (name the block + the hunk); for the **credits** close, the avatar row.
- **`roles:`** — each element's role: `foreground subject` · `background` (full-bleed, dim 30–50%) · `supporting`. Invented elements you **design**; the only real assets are the credits `assets/<login>.png` avatars (named in story's `asset_candidates`).
- **`sfx:`** — name the sound the beat wants; the audio script's `fetch-sfx` retrieves it and the assembler mounts it at root — you only **name** it, never embed `<audio>`.

**Layout + motion are stated INLINE in each Scene line** — name the template / density / depth as part of "where it sits", and name the move from `motion-language.md`'s vocabulary; let it settle on a long-tail curve (`power3` default). Never write px / scale / ease curves / ms (the worker writes those).

## PR code beats — name a `code-*` block

For a `diff` / `before_after` / code beat, the frame's centerpiece is a **ready-made `code-*` registry block**, not an invented HTML visual — the one exception to "invent every visual."

- **Name the block in `scene` + `focal`.** Pick the one that fits the beat (before→after = `code-diff`; refactor/rename = `code-morph`; new code written on = `code-typing`; spotlight a line = `code-highlight`; walk a long file = `code-scroll`; a hero reveal = `code-3d-extrude` / `code-particle-assemble`). Full map → `code-vocabulary.md`. Name the hunk too ("the `request()` retry block, ~6 lines"). The block is the `focal`; the Step-5 worker installs + fills it with the real diff.
- **The block owns the code animation; your Scenes choreograph the surrounding Code Surface.** The block _is_ the development beat (the diff/typewriter/morph plays on its own cadence — the worker only fits it to the frame's `data-duration` so a long snippet doesn't overrun). Your Scene windows move the code-editorial **Code Surface** around it: the navy window seating in, the file header typing on, the camera settling onto the hunk, a `+N/−M` `count-up`, a coral underline drawing on the landed line. Name those moves inline; **do not re-specify the code animation itself.** A code beat is usually `blueprint: compose` (the block is the shape).

## PR mechanism beats — invent an animated diagram of the behavior

A **`mechanism`** frame is the **show-the-behavior** beat — the antidote to a video that only shows code + text. Its `focal` is an **invented animated diagram** that plays out what the change _does_ at runtime (the request retrying, the cache filling, serial→parallel, the race resolved) — **not** a `code-*` block and **not** a headline.

- **Name the behavior + the diagram in `scene` + `focal`.** e.g. `scene: "animate the request lifecycle — fire → 500 → backoff → retry → 200, invented SVG flow"`; `focal: the request-lifecycle flow`. Reach for the `flowchart` / `flowchart-vertical` / `data-chart` registry blocks where they fit (name them in `scene` so Step 5 pre-installs them); otherwise the worker builds it in SVG / HTML / GSAP from code-editorial's atoms.
- **The build IS the shot sequence.** Unlike a code block (which owns its own animation), the diagram is yours to choreograph across the Scene windows — the lanes / nodes draw on (Scene 1), the flow runs / the lane splits / the front advances as the VO names each step (middle Scenes), the resolved state + one coral emphasis lands (final Scene). Never let it enter then freeze.
- **Stay on code-editorial's cream ground, hairline-ink.** Nodes / edges / lanes in hairline ink on cream; **one coral marker** on the active or changed element; mono labels. Not the navy code surface (that's for code), not heavy shapes / bokeh. Plan it into the top ~83% (caption keep-out).

A `mechanism` frame carries **no** `asset_candidates` (it's invented, like every non-credits frame).

## Impact & credits

- **Impact / evidence** — numbers (`+1,204 / −318`, files touched, perf delta) go on an `impact` frame as a **`number-lockup`** (code-editorial's Number/Impact treatment): name it the `focal`, reveal it with a `count-up` paced to the VO.
- **Credits close** — the optional `credits` frame uses the real `assets/<login>.png` avatars (named in story's `asset_candidates`) as the `focal`: an avatar row that staggers in. This is the one frame with non-empty `asset_candidates` and real assets.

## Inventing the visual (non-code beats)

Every non-code, non-credits beat (`hook` / `change` / `cta` / concept) is **designed**, not captured. Three first-class treatments:

- **Typographic / kinetic type** — a hero word, the PR's headline claim, a stat. Treat type as the subject: full-bleed scale, weight contrast, one emphasized term. Strongest for hooks and the cta.
- **Abstract graphics** — shapes / paths / geometry that _embody_ the idea the script names; don't decorate with generic bokeh.
- **Diagram / data-viz** — the mechanism diagrams above, a `data-chart` for a perf delta, a number-lockup. The build (each part on beat) is the teaching — design it to assemble across the Scenes.

Make the invented hero **fill 40–60% of the frame** — big enough to read; don't shrink the one designed element into decoration around empty space.

## Layout — named inline per Scene

State each Scene's layout as part of "where it sits." **If the blueprint (or the code-\* block) already implies a composition, that wins** — describe it directly; the vocabulary below is for composing freely. Never write px / scale / shadow (the worker does). One frame's layout can EVOLVE across its Scenes. Use **≥3 different framings per video**; never the same framing twice in a row.

- **Framing vocabulary** — centered (hero / climax / a single code surface) · rule-of-thirds · split-screen (before/after, two surfaces) · layered-depth (immersive) · asymmetric 60/40 or 70/30 (a code surface + a caption rail) · triptych (three changes at once) · full-width strip (a file list / timeline). Let the beat decide, not a quota.
- **Density** — primary visual ≥ 40% of canvas; ≥ 3 depth layers; never a lone small cluster floating in empty space. Openings/closings are prone to emptiness — add environmental layers (a dim grid, low-opacity scanlines, brand-color ambient). Squint test: after blur you can still pick out the #1 element.
- **Hierarchy** — combine ≥ 2 of size (3:1) / weight (800 vs 400) / contrast / position (upper-third is golden) / motion, so one element clearly dominates.
- **Depth** — layer 2–3 of: size, blur, opacity gradient, overlap, shadow-stack, counter-scale on a push.
- **Don't show**: nav bars, footers, scrollbars, real cursors / browser chrome, generic decorative shapes, floating bokeh / purple-blue "AI" gradients (banned). The navy code surface is for code beats only; mechanism diagrams stay on cream.

## Portrait & square (non-16:9 canvases)

The zones, density, hierarchy, and depth principles all still apply; the **aspect ratio** changes, and a wide layout doesn't transplant into a tall one — design for the storyboard's `format` from the start.

- **Stack vertically, not side-by-side** — split-screen / triptych / 60-40 become top/bottom stacks. A code surface runs nearly full-width in portrait with fewer visible lines.
- **Vertical center moves with the canvas** — anchor a centered hero around **y ≈ 0.42 × height** (portrait ≈806, square ≈454), not a fixed 540.
- **Type runs larger, fewer words per line.** **Travels well to portrait:** Centered, Layered Depth, Full-Width Strip; **avoid** wide Split Screen / Triptych — use stacked equivalents.

## `## Video direction` — write the invariants ONCE

The whole video shares one look and one motion grammar. Write a **`## Video direction`** block ONCE at the top of `STORYBOARD.md` so every frame inherits it and per-frame Scene lines carry only the **delta**. This block is load-bearing — **keep it.**

- **palette system** — from `frame.md` (code-editorial): which roles map to which hues. Never invent.
- **motion grammar + reveal model** — long-tail eases (`power3` default, smooth over bouncy) + the **VO-paced reveal** model + what may stay alive during a hold (subtle jitter at most) (→ `motion-language.md`).
- **rhythm / held-frame allocation** — name the **held / breather frames** so the video varies its energy.
- **negative list** — off-brand textures, **plus both motion failure modes** — slideshow (front-load then freeze) and screensaver (everything floating independently) (→ `motion-language.md`).

Do **not** repeat these per frame.

## Palette & type — from `frame.md`, never invented

- **Palette** — `frame.md` (code-editorial) is the color truth; apply its roles per frame. Generic basics → `hyperframes-creative/references/house-style.md`.
- **Type** — fonts resolve via `frame.md`'s type tokens; reference them **by role** (display / body / mono / the pack's ramp), never by raw family or px. Code surfaces and mechanism labels use the **mono** role. Typography craft → `hyperframes-creative/references/typography.md`.

## Caption-band keep-out (plan side)

The bottom ~17% of the canvas is reserved for the caption pill. Plan every frame's content into the **top ~83%** (the worker enforces the pixel cutoff). When captions are enabled, primary content caps at the band top, and a centered hero anchors at **y ≈ 0.42 × height** (landscape ≈454, portrait ≈806); background / ambient layers are exempt and may stay full-bleed. Holds even when captions are disabled — bottom-edge consistency.

## Where the detail lives

| For…                                                                            | Read                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| the proven shapes + role→blueprint menu + how to pick                           | `../hyperframes-animation/blueprints-index.md` → `blueprints/<id>.md`          |
| the `code-*` blocks (pick + fill for a code beat)                               | `code-vocabulary.md` (local)                                                   |
| motion — shot model, vocabulary, holds, idle budget, stillness, seek-safe       | `motion-language.md` (local)                                                   |
| layout — framing, density, depth, hierarchy, inventing the visual, caption band | the **Layout** + **Inventing the visual** sections in this file                |
| concrete eases / ms / stagger + rule recipe bodies (Step 5)                     | local `../hyperframes-animation/rules/` (the frame worker reads it; you don't) |
| palette + type tokens                                                           | the project's `frame.md` (code-editorial); basics → `hyperframes-creative`     |
| within-frame cuts / seams (zoom-through · cut-the-curve · waterfall)            | `cut-catalog.md` (the worker builds them inside the composition)               |
| transitions                                                                     | story-design owns `transition_in`; you don't touch it                          |

## Before you finish — checklist

- **`## Video direction`** written once at the top (palette · motion grammar + shot model + idle budget · stillness allocation · negative list incl. both failure modes); per-frame entries are deltas.
- Every frame is a **time-coded shot sequence** with real second windows across its `duration` — not a tag bag.
- **No frame front-loads** — at t=0 only what the VO is saying enters; each further piece reveals on its spoken cue, across the back ~50%. Window count follows the VO.
- Every frame names a **`blueprint:`** id (Reproduce / Adapt) or `compose`; an Adapt keeps the signature move; nothing collapses to a single front-loaded dump.
- **Code beats** name a `code-*` block as the `focal`, let the block own the code animation, and choreograph only the surrounding Code Surface in the Scenes.
- **Mechanism beats** name an **invented animated diagram of the behavior** (or a `flowchart` / `data-chart`), choreographed across the Scenes on code-editorial's cream ground with one coral marker — not a code block, not typography; the body is not an unbroken run of code surfaces.
- **Impact** uses a `number-lockup` with a `count-up`; the **credits** close uses the real avatars as the `focal`.
- Each non-code, non-credits frame names its **invented** `focal` + per-element `roles`, kept few and load-bearing.
- Layout + motion named **inline** per Scene (no px / ease curves / ms / JS).
- Content planned into the top ~83% (caption band clear); palette / type pulled from `frame.md` by role.
- You wrote no HTML.
