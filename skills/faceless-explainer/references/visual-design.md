# Visual design — faceless-explainer per-frame shot method

> The method behind **Step 4 (Frame visual design)**. You (the orchestrator) read it to **enrich `STORYBOARD.md` frames in place** — story-design wrote the skeleton (each frame's `scene`, `voiceover`, `transition_in`, the narrative fields, and optionally a candidate blueprint id); you add how each frame **looks and moves**. The unit you write per frame is a **time-coded shot sequence** — a shot directed across its whole duration, not a static slide. You write **no HTML** (that's the frame workers). Because the explainer is **faceless, every visual is invented** — typography, abstract graphics, diagrams, data-viz — so you **design** the visual elements rather than select captured assets (there is no `capture/` to read). `frame.md` is your palette/type truth by role. Layout is a compact vocabulary in this file (the **Layout** section below), stated inline per Scene; motion vocabulary + the motion doctrine + the seek-safe core → `motion-language.md`; the proven shapes → `../hyperframes-animation/blueprints-index.md` + `blueprints/<id>.md`; concrete rules resolve in Step 5 from this skill's local `../hyperframes-animation/rules/`. Adding palette theory or a generic font rule here? Wrong home — `frame.md` + `hyperframes-creative`.

## The unit is a time-coded shot sequence

A frame's visual layer is **a sequence of time windows paced to the voiceover**, not a bag of effect tags. The failure that reads as PowerPoint is **front-loading**: the agent rushes the whole canvas on screen in the first ~25%, and then it just sits. A time-coded shot sequence written **against the VO** makes that impossible: each window states what is on screen and what is moving, and **nothing appears before the voiceover reaches it.** In an explainer the development _is_ the teaching — the formula assembling term by term, the diagram gaining a layer, the count-up landing the statistic. Let the build _be_ the message.

Write each frame as a handful of windows cued by the spoken line:

```
Scene 1 (0.0–Xs):  only what the VO is saying at t=0 enters — never the whole canvas
Scene 2 (Xs–Ys):   the next piece reveals as the VO names it (a line / layer / node / stat)
  …                one window per spoken cue — as many or as few as the line calls for
Scene N (…–end):   content has resolved; hold the read (stillness; subtle jitter at most)
```

- Each `Scene` line names **what's on screen**, **what moves in this window**, and **where it sits** (layout, inline). Times are real seconds across the frame's `duration`.
- **Pace reveals to the voiceover; never front-load.** This is the core anti-PowerPoint mechanism (→ `motion-language.md` Part 2 Rule 2). At t=0 show only what the VO is saying then; reveal each further piece — a line, a layer, even an h1 — **when the VO names it**, spreading reveals across the shot and especially the **back ~50%**. **The window count = the number of spoken cues the line calls for** — a two-beat line is two windows, a five-item enumeration is five or six. There is **no fixed count and no mandatory "middle" act**; the only sin is dumping everything up front. (A **silent** frame — a diagram assembling itself, a worked example animating — paces its reveals to the beat instead of the VO; same discipline, no spoken cue.)
- **End on a held read.** Once the content has resolved it holds and reads — **prefer stillness to bad motion**: no forced camera drift, no lazy breathing, no back-half pan/push; at most a subtle jitter keeps it alive (→ `motion-language.md`). On a short shot the final reveal and the hold are the **same window** — the hold is not a separate mandatory act. Only the final frame has a real exit; every other frame's exit is the harness transition (story's `transition_in`).
- A **deliberately held** frame — content already revealed, now reading still — is legitimate and often right (a climax, a breather, a beat of held tension before a turn). The failure is never "too still"; it is **front-loaded-then-frozen** (everything dumped by ~25%, nothing cued to the VO). Place held beats deliberately for rhythm so the video isn't uniformly busy (allocate them in `## Video direction`). Reveal pacing + holds + the idle budget → `motion-language.md`.

## Pick the shape — instantiate a blueprint

Don't invent each shot from scratch. The frame's **role** (its `type` / `beat`) points to a proven shape:

1. **Match the role to a blueprint.** Open `../hyperframes-animation/blueprints-index.md`, find the frame's role in the **role→blueprint menu**, and pick the blueprint whose intent fits this beat (story may already have named a candidate id — confirm or override it). Read that `blueprints/<id>.md`: it is a short, domain-agnostic, **time-coded shot template with `[slots]`** and a named **signature move** (the thing that makes the shape itself — the SVG ring, the push-THROUGH, the in-place token swap).

2. **Instantiate its `[slots]` with THIS frame's invented content** — three postures:
   - **Reproduce** — the blueprint fits the beat and your content maps onto its slots cleanly. Fill every `[slot]` with this frame's word / shape / stat and follow its Scene timing. Write the resulting Scene lines.
   - **Adapt** — the _structure_ fits but the content / element-count / surface doesn't (or you want a fresher surface to avoid templating). State **what you keep / what you change** in one line, then write the adapted Scene lines. You may extend or vary; you may **never** drop the **signature move** (drop it and you picked the wrong blueprint), and you keep the reveals **paced to the VO** — never collapse the shape to a single front-loaded dump.
   - **Compose** — no blueprint fits the beat. Build the shot from the **motion vocabulary** in `motion-language.md`: still pace the reveals to the VO across the shot, never fire everything at t=0. Mark it `blueprint: compose`.

3. **Keep the signature move.** Whichever posture, the blueprint's signature move (named in its file) is the spine of the shot — it usually lands on the shot's key reveal. Carry it through.

The blueprint's own Scene lines, motion vocabulary, and `rule mapping` are your raw material; you are choosing a shape and casting this frame's invented content into it, not copying an engineering spec.

## What you add to each frame

Story-design's `## Frame N` block already carries the narrative. You append the shot. Story's `scene` / `voiceover` / `transition_in` / role fields stay untouched.

```
## Frame 3 — How interest compounds
- scene: a snowball rolls downhill, gaining a labeled ring each turn   ← refine only if it could read sharper
- voiceover: "…"            ← story's; leave it
- transition_in: crossfade  ← story's; leave it
- type: feature_showcase    ← story's
- persuasion: Concretization + progressive disclosure
- beat: comprehension
- blueprint: dataviz-countup (Adapt)   ← you add: the id you instantiated (or "compose")
- focal: the snowball                  ← you add: the INVENTED hero element of this beat
- roles: snowball = foreground subject · hill = background gradient (dim ~40%) · ring labels = supporting   ← you add: role per invented element
- sfx: whoosh-soft, tick               ← you add: the sound the beat wants (fetched + mounted at root; never yours to embed)

Adapt: keep the count-up-ring signature; the trend chart becomes the snowball's labeled rings climbing.
Scene 1 (0.0–1.2s): solid hill gradient (dim ~40%); the snowball seats upper-left, a circular progress ring + bold center number anchor it — Centered template, ~50% of frame. Slow push-in runs underneath.
Scene 2 (1.2–3.4s): as the VO names each turn, the snowball rolls down and gains one labeled ring per turn (layer-reveal); a small total ticks up beside it (the count-up reveals on its spoken cue, not at t=0). Asymmetric 60/40, 3 depth layers.
Scene 3 (3.4–5.0s): land the final ring emphasis dead-center, accent glow blooms behind it and holds; the total reads clean and STILL — no continuing push, no breathing (a held beat beats bad motion). The stillness reads against the prior motion.
```

The lightweight tags:

- **`blueprint:`** — the id you instantiated (with `(Reproduce)` / `(Adapt)`), or `compose`. One id per frame.
- **`focal:`** — which **invented** element is the hero of this beat (a hero word, a diagram node, a chart series, a coined-term card).
- **`roles:`** — each invented element's role: `foreground subject` (the thing the eye lands on, text laid around it) · `background` (full-bleed field / gradient / grid, dim 30–50%) · `supporting` (labels, secondary shapes, ambient layers). Since there are no captured assets, you are **designing** these elements, not selecting them — keep them **few and load-bearing**. A user-supplied `public/<basename>` image, if any (named in story's `asset_candidates`), is treated as the `focal` cutout or a `background`.
- **`sfx:`** — name the sound the beat wants (an impact for a slam, a whoosh for a push, a tick for a count). The audio script's `fetch-sfx` pass retrieves it and the assembler mounts it at the root — you only **name** it, never embed an `<audio>` element.

**Layout is stated INLINE in each Scene line** — name the template, density, depth, and hierarchy as part of "where it sits" (`Centered, ~50% of frame`, `asymmetric 60/40, 3 depth layers`), drawing on the **Layout** vocabulary below; never write px / scale / shadow recipes (the worker writes those).

**Motion is named INLINE in each Scene line** — name the move from `motion-language.md`'s vocabulary (`per-word reveal`, `layer-reveal`, `count-up`, `glow blooms`) and let it settle on a long-tail curve (`power3` default — smooth beats bouncy; see `motion-language.md`). Never write ease curves / ms / stagger (those resolve in Step 5 from this skill's local `../hyperframes-animation/rules/`).

## Inventing the visual — diagrams, type, data-viz

This is a **faceless** explainer: the frame's hero is something you **design**, not a screenshot. Three first-class treatments, each invented from the frame's `narrativeRole` / `keyMessage` / `scene`:

- **Typographic / kinetic type** — the hero word, the coined term, a number, a short enumeration. Treat type as the subject: full-bleed scale, weight contrast, one emphasized term. Strongest for hooks, concept names, takeaways. In a faceless explainer **type is often the primary visual** — lean on the type ramp hard.
- **Abstract graphics** — shapes, fields, paths, geometry that _embody_ the idea (the snowball, the spotlight, the staircase-not-cliff). Build the metaphor the script names; don't decorate with generic bokeh.
- **Diagram / data-viz** — nodes + edges, a chart, a number line, a formula, a process flow. The build (each part appearing on beat) is the teaching — design it to assemble across the Scenes, not appear whole.

Make the invented hero **fill 40–60% of the frame** — a diagram big enough to read its labels, a hero word near full-bleed. Don't shrink the one designed element into decoration around empty space.

## Layout — named inline per Scene

State each Scene's layout as part of "where it sits." **If the blueprint already implies a composition** (a ring around a center, stations on a wide canvas, two cards from opposite wings), that wins — describe it directly; the vocabulary below is for **composing freely** or a generic beat, not a menu you must pick from. Never write px / scale / shadow (the worker does). One frame's layout can EVOLVE across its Scenes (Scene 1 centered hero → Scene 2 rearranges to a grid). Use **≥3 different framings per video** so it doesn't read as one repeated template; never the same framing twice in a row.

- **Framing vocabulary** — centered (hero / climax) · rule-of-thirds · split-screen (comparison) · layered-depth (immersive opening / atmosphere) · asymmetric 60/40 or 70/30 (editorial — a dense diagram + a caption rail) · triptych (three items / the rule-of-three landing) · full-width strip (a number line / timeline / enumeration). Vary the framing across the video so it doesn't read as one repeated template — let the beat decide, not a quota.
- **Density** — primary visual ≥ 40% of canvas; ≥ 3 depth layers (background + midground + foreground); never a lone small cluster floating in empty space. Openings and closings are prone to emptiness — add environmental layers (dual-radial swell, low-opacity scanlines, a hairline grid, brand-color ambient). Squint test: after blur you can still pick out the #1 element.
- **Hierarchy** — combine ≥ 2 of size (3:1) / weight (800 vs 400) / contrast / position (upper-third is golden) / motion, so one element clearly dominates. A title that is only _larger_ (sharing weight/color/spacing with body) reads weak.
- **Depth** — layer 2–3 of: size, blur, opacity gradient, overlap, shadow-stack, counter-scale on a push.
- **Don't show**: nav bars, footers, scrollbars, real cursors / browser chrome, generic decorative shapes standing in for a designed metaphor, floating bokeh / purple-blue "AI" gradients (the default-AI cliché, banned). A faceless explainer has no real interface — an interface mock is correct **only** when the topic itself is about that interface and the frame intentionally reconstructs it.

## Portrait & square (non-16:9 canvases)

The zones, density, hierarchy, and depth principles all still apply; the **aspect ratio** changes, and a wide-frame layout does not transplant into a tall one — design for the storyboard's `format` from the start, never plan landscape and "crop."

- **Stack vertically, not side-by-side** — split-screen / triptych / 60-40 become top/bottom stacks, vertical step lists, stacked bands. Square tolerates side-by-side only for two compact items.
- **Vertical center moves with the canvas** — anchor a centered hero around **y ≈ 0.42 × height** (portrait ≈806, square ≈454), not a fixed 540.
- **Type runs larger, fewer words per line** — narrow frames wrap long headlines badly; prefer short kinetic lines, bigger type, more vertical rhythm.
- **Travels well to portrait:** Centered, Layered Depth, Full-Width Strip (stacked band), vertical Rule-of-Thirds. **Avoid** wide Split Screen and Triptych — use stacked equivalents.

## `## Video direction` — write the invariants ONCE

The whole video shares one look and one motion grammar. Write a **`## Video direction`** block ONCE at the top of `STORYBOARD.md` so every frame inherits it and per-frame Scene lines carry only the **delta**. This block is load-bearing — it is what binds many independent shots into one film. **Keep it.**

- **palette system** — from `frame.md`: which roles map to which hues. Never invent.
- **motion grammar + reveal model** — long-tail eases (`power3` default, smooth over bouncy) + the **VO-paced reveal** model every frame follows (reveal each piece on its spoken cue; never front-load) + what may stay alive during a hold (subtle jitter at most; no lazy breathing) (→ `motion-language.md`).
- **rhythm / held-frame allocation** — name the **held / breather frames** (often before a climax or the turn in a story) so the video varies its energy: most frames reveal to the VO, a few hold still (a held read beats bad motion; the anti-monotony discipline; → `motion-language.md`).
- **negative list** — what never appears: off-brand textures / effects the pack forbids, **plus both motion failure modes** — slideshow (front-load then freeze) and screensaver (everything floating independently) (→ `motion-language.md`).

Do **not** repeat these per frame — restating video-level rules in every frame is exactly the bloat this layer prevents.

## Palette & type — from `frame.md`, never invented

- **Palette** — `frame.md` (the adopted pack) is the color truth; apply its roles per frame. Generic basics (one accent, tint neutrals, avoid pure `#000`/`#fff`) → `hyperframes-creative/references/house-style.md`.
- **Type** — fonts resolve via `frame.md`'s type tokens; reference them **by role** (display / body / mono / the pack's ramp), never by raw family or px. Generic typography craft (embedded fonts, dark-bg optical compensation, `tabular-nums`) → `hyperframes-creative/references/typography.md`. In a faceless explainer type is often the primary visual — the hero word, the coined term, the kinetic enumeration — so lean on the type ramp hard.

## Caption-band keep-out (plan side)

The bottom ~17% of the canvas is reserved for the caption pill. Plan every frame's content into the **top ~83%** so nothing important lands in the band (the worker enforces the pixel cutoff; you plan the layout). When captions are enabled, primary content and key visuals **cap at the band top**, and a centered hero anchors at **y ≈ 0.42 × height** (landscape ≈454, portrait ≈806), not the canvas midpoint; background / ambient / surface layers are exempt and may stay full-bleed. Holds even when captions are disabled — bottom-edge consistency.

## Where the detail lives

| For…                                                                            | Read                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| the proven shapes + role→blueprint menu + how to pick                           | `../hyperframes-animation/blueprints-index.md` → `blueprints/<id>.md`                        |
| motion — shot model, vocabulary, holds, idle budget, stillness, seek-safe       | `motion-language.md` (local)                                                                 |
| layout — framing, density, depth, hierarchy, inventing the visual, caption band | the **Layout** + **Inventing the visual** sections in this file                              |
| concrete eases / ms / stagger + rule recipe bodies (Step 5)                     | local `../hyperframes-animation/rules/` (the frame worker reads it; you don't)               |
| palette + type tokens                                                           | the project's `frame.md`; basics → `hyperframes-creative` `house-style.md` / `typography.md` |
| "produced, not generated" foreground density                                    | `hyperframes-creative/references/video-composition.md`                                       |
| within-frame cuts / seams (zoom-through · cut-the-curve · waterfall)            | `cut-catalog.md` (the worker builds them inside the composition)                             |
| transitions                                                                     | story-design owns `transition_in`; you don't touch it                                        |

## Before you finish — checklist

- **`## Video direction`** written once at the top (palette · motion grammar + shot model + idle budget · stillness allocation · negative list incl. both failure modes); per-frame entries are deltas, not restatements.
- Every frame is a **time-coded shot sequence** with real second windows across its `duration` — not a tag bag.
- **No frame front-loads** — at t=0 only what the VO is saying enters; each further piece reveals on its spoken cue, across the back ~50%. Window count follows the VO (or the beat, on a silent frame), not a fixed number.
- Every frame names a **`blueprint:`** id (Reproduce / Adapt) or `compose`; an Adapt states keep/change and **keeps the signature move**; nothing collapses to a single front-loaded dump — reveals stay paced to the VO.
- **Held frames are deliberate** — allocated in Video direction for rhythm; a held read is fine (prefer stillness to bad motion), but no frame may be front-loaded-then-frozen.
- Each frame names its **invented** `focal` + per-element `roles` (foreground / background / supporting), kept few and load-bearing.
- The invented hero fills 40–60% of the frame (a diagram big enough to read, a hero word near full-bleed) — not shrunk into decoration around empty space.
- Layout named **inline** per Scene (template / density / depth / hierarchy — the **Layout** vocabulary here); motion named **inline** per Scene from the vocabulary (`motion-language.md`). No px / ease curves / ms / JS.
- Content planned into the top ~83% (caption band clear).
- Palette / type pulled from `frame.md` by role — nothing invented.
- You wrote no HTML; every visual is invented (no captured assets).
