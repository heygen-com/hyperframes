# Visual design — faceless-explainer per-frame enrichment method

> The method behind **Step 4 (Frame visual design)**. You (the orchestrator) read it to **enrich `STORYBOARD.md` frames in place** — story-design wrote the skeleton (each frame's `scene`, `voiceover`, `transition_in`, and the narrative fields); you add how each frame **looks and moves**. Each frame is a **directed shot, not a static slide** — you choreograph it across its whole duration. Because the explainer is **faceless, every visual is invented** — typography, abstract graphics, diagrams, data-viz — so you describe the visual elements rather than place captured assets. You write **no HTML** (that's the frame workers). `frame.md` is your palette/type truth. Composition / motion detail lives in `composition.md` + `motion-language.md`; effect & blueprint **bodies** live in `hyperframes-animation`. Adding palette theory or a generic font rule here? Wrong home — `frame.md` + `hyperframes-creative`.

## Every frame is a directed shot

A frame's visual layer is choreographed across its **full duration**, not front-loaded into an entrance. The failure that reads as PowerPoint: content animates in over the first ~0.8s, then **freezes** while a slow drift plays under it. So every frame's metadata + note describe a **shot with phases** — `entrance → development → settle` — where _development_ (a reveal, a rearrange, a morph, an emphasis hit, a count-up) is the mid-shot motion that separates video from slides. The shot model and the choreography-vs-idle budget live in `motion-language.md`; here you **encode it into the frame**: the `effects` / `blueprint` ids are the motion vocabulary, and the **composition note sequences them into phases**.

In explainers, _development_ is often the teaching itself — the formula assembling term by term, the diagram gaining a layer, the count-up landing the statistic. Let the build _be_ the message.

Deliberate **stillness** is the marked exception — the 2-3 climax/breather frames you allocate in `## Video direction`. Every other frame develops; a held frame outside that allocation is just a slide.

## What you add to each frame

Story-design's `## Frame N` block already carries the narrative. You append the visual layer as frame metadata + one composition note (story's role/message prose stays):

```
## Frame 3 — How interest compounds
- scene: a snowball rolls downhill, gaining a labeled ring each turn   ← refine only if it could read sharper
- voiceover: "…"            ← story's; leave it
- transition_in: crossfade  ← story's; leave it
- type: feature_showcase    ← story's
- persuasion: Concretization + progressive disclosure
- beat: comprehension
- effects: scale-in, layer-reveal, count-up   ← you add: cite effect ids (≥3, sequenced into the phases below)
- blueprint: messaging-multi-phase           ← you add (optional): one multi-phase blueprint id
- focal: the snowball                          ← you add: which INVENTED element is the hero
- roles: snowball = foreground subject; hill = background gradient; ring labels = supporting   ← you add: each invented element's role
- sfx: whoosh-soft, tick                       ← you add: the sound the beat wants (fetched + mounted at root; never yours to embed)

Entrance: the snowball seats upper-left on a dim hill gradient. Development: it rolls down across the beat, gaining one labeled ring per turn (layer-reveal) while a small total ticks up (count-up). Settle: the final ring emphasis holds; only the slow camera drift continues. A dense, left-anchored frame.
```

- **`effects`** — name atomic effect **ids** from `hyperframes-animation`'s rules index. **Cite ≥3 when you name no `blueprint`** (the worker composes them into the beat; fewer than 3 reads as generic motion); 1+ as accents when a blueprint already carries the choreography. With no blueprint, those **≥3 effects are the shot's phases** — your note must **sequence them** (one enters, one develops, one emphasizes), not list them as a flat set that all fires at entry. You cite; the worker **reads the recipe body and reproduces it** (not a name-guess).
- **`blueprint`** — name **one** multi-phase blueprint id from `hyperframes-animation/blueprints-index.md` when a frame's beat wants a proven multi-phase shape. Two postures — both require the worker to read the recipe body first:
  - **Reproduce** — the blueprint fits the beat cleanly and the frame's content maps onto its slots; write the composition note shot-by-shot to match.
  - **Adapt** — the blueprint is the right _structure_ but the content / beat doesn't fit its exact form (or you want a fresher surface). Lead the note with a **`Base / Keep / Depart`** line — `Base:` the blueprint id · `Keep:` its **signature** move (never drop this) · `Depart:` what you change and why. Adapt may **extend or vary, never reduce below the shot model** — never flatten a multi-phase blueprint into a single entrance.

  Choose **Reproduce** when the shape fits as-is, **Adapt** when the structure fits but the form doesn't; **omit** `blueprint` entirely when none fits — then the cited `effects` (≥3) carry the phases (**Compose**).

- **`focal` / `roles`** — name the **invented** visual elements and their roles. `focal` is the hero element (a hero word, a diagram node, a chart series, a coined-term card). `roles` assigns each element a role: `foreground subject` (the thing the eye lands on, text laid around it), `background` (full-bleed field/gradient/grid, dim 30-50%), `supporting` (labels, secondary shapes, ambient layers). Since there are no captured assets, you are _designing_ these elements, not selecting them — keep them few and load-bearing. A user-supplied `public/<basename>` image, if any, is named in story's `asset_candidates`; treat it as the `focal` cutout or a `background`.
- **`sfx`** — name the sound the beat wants (an impact for a slam, a whoosh for a push, a tick for a count). The audio script's `fetch-sfx` pass retrieves it and the assembler mounts it at the root — you only **name** it, never embed an `<audio>` element.
- **composition note** — the frame's visual brief: layout, hero, depth layers, the macro move, **and the shot's phases**. **Default to a phased note** — `entrance: … → development: … → settle: …` (mandatory when you named a `blueprint`). A **single still line** is correct only for a deliberately held climax or an allocated stillness frame. Full method → `composition.md` (layout) + `motion-language.md` (phases).

## Video direction — write the invariants ONCE

The whole video shares one look and one motion grammar. State it **once**, at the top of `STORYBOARD.md` (a `## Video direction` block), so every frame inherits it and per-frame metadata carries only the **delta**:

- **palette system** — from `frame.md`: which roles map to which hues. Never invent.
- **motion defaults + shot model** — default eases + the **choreography baseline** (every frame a directed shot: entrance → development → settle) + the **idle-life budget** (what may keep moving during the hold) (→ `motion-language.md`).
- **negative list** — what never appears: off-brand textures the pack forbids, **plus both motion failure modes** — slideshow (enter-then-freeze) and screensaver (everything floating independently) (→ `motion-language.md`).
- **stillness allocation** — name the 2-3 frames that hold still before a climax; every other frame develops.

Do **not** repeat these in every frame — each frame's metadata is the delta on top of Video direction.

## Palette & type — from `frame.md`, never invented

- **Palette** — `frame.md` (the adopted pack) is the color truth; apply its roles per frame. Generic basics (one accent, tint neutrals, avoid pure `#000`/`#fff`) → `hyperframes-creative/references/house-style.md`.
- **Type** — fonts resolve via `frame.md`'s type tokens; reference them **by role** (display / body / mono / the pack's ramp), never by raw family or px. Typography craft (embedded fonts, dark-bg optical compensation, `tabular-nums`) → `hyperframes-creative/references/typography.md`. In a faceless explainer, **type is often the primary visual** — the hero word, the coined term, the kinetic enumeration — so lean on the type ramp hard.

## Caption-band keep-out (plan side)

The bottom ~17% of the canvas is reserved for the caption pill. Plan every frame's content into the **top ~83%** so nothing important lands in the band (the worker enforces the pixel cutoff; you plan the layout). Holds even when captions are disabled — bottom-edge consistency. Geometry detail → `composition.md`.

## Where the detail lives

| For…                                                                                  | Read                                                                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| composition — zones, density, templates, invented-visual prominence, caption geometry | `composition.md` (local)                                                                     |
| motion — the shot model, phases, idle budget, beat structure, stillness               | `motion-language.md` (local)                                                                 |
| effect ids + blueprint ids (vocabulary + recipes)                                     | `../hyperframes-animation/blueprints-index.md` + `../hyperframes-animation/rules-index.md`   |
| palette + type tokens                                                                 | the project's `frame.md`; basics → `hyperframes-creative` `house-style.md` / `typography.md` |
| transitions                                                                           | story-design owns `transition_in`; you don't touch it                                        |

## Before you finish — checklist

- Every frame has `effects` (≥1 cited id; **≥3 when no `blueprint`** is named); a `blueprint` where the frame matches one, with a shot-by-shot composition note.
- **Every frame's composition note is phased** (entrance → development → settle) — not a single entry that then freezes; the ≥3 effects are **sequenced across phases**, not all fired at t=0.
- **Stillness is only the 2-3 frames allocated in Video direction**; every other frame develops mid-shot.
- Each frame names its **invented** `focal` + per-element `roles` (foreground / background / supporting), kept few and load-bearing.
- **Video direction** stated once at the top (palette · shot model + idle budget · negative list incl. both failure modes · stillness allocation); per-frame entries are deltas.
- Content planned into the top ~83% (caption band clear).
- Palette / type pulled from `frame.md` by role — nothing invented.
- You wrote no HTML.
