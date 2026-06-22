# Visual design — product-launch per-frame enrichment method

> The method behind **Step 4 (Frame visual design)**. You (the orchestrator) read it to **enrich `STORYBOARD.md` frames in place** — story-design wrote the skeleton (each frame's `scene`, `voiceover`, `transition_in`, the five narrative fields, and its `asset_candidates`); you add how each frame **looks and moves**. Each frame is a **directed shot, not a static slide** — you choreograph it across its whole duration, not just its entrance. You write **no HTML** (that's the frame workers), you **never read `capture/`** (story already chose the assets), and you do **not** select assets or name transitions (story owns both). `frame.md` is your palette/type truth. Composition / motion detail lives in `composition.md` + `motion-language.md`; effect & blueprint **bodies** live in `hyperframes-animation`. Adding palette theory or a generic font rule here? Wrong home — `frame.md` + `hyperframes-creative`.

## Every frame is a directed shot

A frame's visual layer is choreographed across its **full duration**, not front-loaded into an entrance. The failure that reads as PowerPoint: content animates in over the first ~0.8s, then **freezes** while a slow drift plays under it. So every frame's metadata + note describe a **shot with phases** — `entrance → development → settle` — where _development_ (a reveal, a rearrange, a morph, an emphasis hit, a count-up) is the mid-shot motion that separates video from slides. The shot model and the choreography-vs-idle budget live in `motion-language.md`; here you **encode it into the frame**: the `effects` / `blueprint` ids are the motion vocabulary, and the **composition note sequences them into phases**.

Deliberate **stillness** is the marked exception — the 2-3 climax/breather frames you allocate in `## Video direction`. Every other frame develops; a held frame outside that allocation is just a slide.

## What you add to each frame

Story-design's `## Frame N` block already carries the narrative. You append the visual layer as frame metadata + one composition note (story's role/message prose stays):

```
## Frame 3 — The problem
- scene: a 20-minute timer spins on a stack of rejected takes   ← refine only if it could read sharper
- voiceover: "…"            ← story's; leave it
- transition_in: crossfade  ← story's; leave it
- type: pain_point          ← story's
- persuasion: Pain agitation
- beat: frustration
- effects: slow-push, count-up, vignette-pulse   ← you add: cite effect ids (≥3, sequenced into the phases below)
- blueprint: messaging-multi-phase         ← you add (optional): one multi-phase blueprint id
- focal: assets/timer-stack.png             ← you add: which existing candidate is the hero
- roles: timer-stack = background (dim ~40%) ← you add: cutout / background / supporting per candidate
- sfx: impact-soft, riser                    ← you add: the sound the beat wants (fetched + mounted at root; never yours to embed)

Entrance: timer drops in upper-left (heavy), rejected-takes stack seated low. Development: the stack grows beat-by-beat toward the band as the reject count ticks up (count-up). Settle: vignette pulses in and holds; only the slow-push continues. A dense, edge-anchored frame.
```

- **`effects`** — name atomic effect **ids** from `hyperframes-animation`'s rules index. **Cite ≥3 when you name no `blueprint`** (the worker composes them into the beat; fewer than 3 reads as generic motion); 1+ as accents when a blueprint already carries the choreography. With no blueprint, those **≥3 effects are the shot's phases** — your note must **sequence them** (one enters, one develops, one emphasizes), not list them as a flat set that all fires at entry (that collapses three phases into one slide). The names are a shared vocabulary; the recipe lives there — you cite, the worker **reads the body and reproduces it** (not a name-guess).
- **`blueprint`** — name **one** multi-phase blueprint id from `hyperframes-animation/blueprints-index.md` when a frame's beat wants a proven multi-phase shape (multi-phase reveal, orbit-collapse, …). Two postures — **both require the worker to read the recipe body (and run its `examples/<id>.html` to see the signature move) first**; deviating from a name-guess instead of from understanding is the one banned failure:
  - **Reproduce** — the blueprint fits the beat cleanly and the frame's content maps onto its slots; the worker reproduces its phases faithfully. Write the composition note shot-by-shot to match.
  - **Adapt** — the blueprint is the right _structure_ but the content / beat / asset-count doesn't fit its exact form, or you want the proven skeleton with a fresher surface (anti-templating), or you're grafting a second blueprint's phase. Lead the note with a **`Base / Keep / Depart`** line — `Base:` the blueprint id · `Keep:` its **signature** (the move that makes it itself — the SVG ring, the orbit→collapse; never drop this, or you named the wrong blueprint) · `Depart:` what you change and why. Adapt may **extend or vary, never reduce below the shot model** — never flatten a multi-phase blueprint into a single entrance. E.g. `Base: avatar-cloud-network · Keep: the SVG-connected elliptical ring · Depart: 7 logos not 12, + a hub count-up as the development beat`.

  Choose **Reproduce** when the shape fits as-is, **Adapt** when the structure fits but the form doesn't (or to avoid templating); **omit** `blueprint` entirely when no blueprint's structure fits — then the cited `effects` (≥3) carry the phases (**Compose**).

- **`focal` / `roles`** — story listed `asset_candidates`; you pick the **focal** hero and each candidate's role (`cutout` = foreground subject, lay text around it; `background` = full-bleed, dim 30-50%; supporting = secondary). You **consume** the candidates — never add, swap, or drop one (coverage is story's call; if a frame truly has the wrong candidates, flag it back, don't reach into `capture/`).
- **`sfx`** — name the sound the beat wants (an impact for a slam, a whoosh for a push). The audio script's `fetch-sfx` pass retrieves it from HeyGen and the assembler mounts it at the root — you only **name** it, never embed an `<audio>` element.
- **composition note** — the frame's visual brief: layout, hero, depth layers, the macro move, **and the shot's phases**. **Default to a phased note** — `entrance: … → development: … → settle: …` (shot-by-shot; mandatory when you named a `blueprint`) — naming what's on screen and what moves in each phase, so the worker builds the development instead of freezing after entry. A **single still line** is correct only for a deliberately held climax or an allocated stillness frame. Full method → `composition.md` (layout) + `motion-language.md` (phases).

## Video direction — write the invariants ONCE

The whole video shares one look and one motion grammar. State it **once**, at the top of `STORYBOARD.md` (a `## Video direction` block), so every frame inherits it and per-frame metadata carries only the **delta**:

- **palette system** — from `frame.md`: which roles map to which hues. Never invent.
- **motion defaults + shot model** — default eases + the **choreography baseline** (every frame a directed shot: entrance → development → settle) + the **idle-life budget** (what may keep moving during the hold) (→ `motion-language.md`).
- **negative list** — what never appears: off-brand textures and effects the pack forbids, **plus both motion failure modes** — slideshow (enter-then-freeze) and screensaver (everything floating independently) (→ `motion-language.md`).
- **stillness allocation** — name the 2-3 frames that hold still before a climax; every other frame develops (the anti-repetition discipline; → `motion-language.md`).

Do **not** repeat these in every frame — restating video-level rules per frame is exactly the bloat this layer prevents. Each frame's metadata is the delta on top of Video direction.

## Palette & type — from `frame.md`, never invented

- **Palette** — `frame.md` (the adopted pack) is the color truth; apply its roles per frame. Generic basics (one accent, tint neutrals, avoid pure `#000`/`#fff`) → `hyperframes-creative/references/house-style.md`.
- **Type** — fonts resolve via `frame.md`'s type tokens; reference them **by role** (display / body / mono / the pack's ramp), never by raw family or px. Generic typography craft (embedded fonts, dark-bg optical compensation, `tabular-nums`) → `hyperframes-creative/references/typography.md`.

## Caption-band keep-out (plan side)

The bottom ~17% of the canvas is reserved for the caption pill. Plan every frame's content into the **top ~83%** so nothing important lands in the band (the worker enforces the pixel cutoff; you plan the layout). Holds even when captions are disabled — bottom-edge consistency. Geometry detail → `composition.md`.

## Where the detail lives

| For…                                                                        | Read                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| composition — zones, density, templates, asset prominence, caption geometry | `composition.md` (local)                                                                     |
| motion — the shot model, phases, idle budget, beat structure, stillness     | `motion-language.md` (local)                                                                 |
| effect ids + blueprint ids (vocabulary + recipes)                           | `../hyperframes-animation/blueprints-index.md` + `../hyperframes-animation/rules-index.md`   |
| palette + type tokens                                                       | the project's `frame.md`; basics → `hyperframes-creative` `house-style.md` / `typography.md` |
| "produced, not generated" foreground density                                | `hyperframes-creative/references/video-composition.md`                                       |
| transitions                                                                 | story-design owns `transition_in`; you don't touch it                                        |

## Before you finish — checklist

- Every frame has `effects` (≥1 cited id; **≥3 when no `blueprint`** is named); a `blueprint` where the frame matches one, with a shot-by-shot composition note.
- **Every frame's composition note is phased** (entrance → development → settle / shot-by-shot) — not a single entry that then freezes; the ≥3 effects are **sequenced across phases**, not all fired at t=0.
- **Stillness is only the 2-3 frames allocated in Video direction**; every other frame develops mid-shot.
- Each visual frame's `asset_candidates` have a `focal` + per-candidate `roles`; none added or dropped.
- **Video direction** stated once at the top (palette · shot model + idle budget · negative list incl. both failure modes · stillness allocation); per-frame entries are deltas, not restatements.
- Content planned into the top ~83% (caption band clear).
- Palette / type pulled from `frame.md` by role — nothing invented.
- You wrote no HTML and never read `capture/`.
