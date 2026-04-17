# Prompt Expansion

Run on every composition. Expansion is not about lengthening a short prompt — it's about grounding the user's intent against `design.md` and `house-style.md` and producing a consistent intermediate that every downstream agent reads the same way.

Runs AFTER `design.md` is established (Step 0a). The expansion consumes design.md and produces output that cites its palette, typography, and motion energy verbatim.

## Prerequisites

Read before generating:

- `design.md` — palette, typography, energy, mood. The expansion quotes these values; it does not invent any.
- [../house-style.md](../house-style.md) — its rules for Background Layer (2-5 decoratives), Color, Motion, Typography apply to every scene. The expansion does NOT re-state those rules; it writes output that conforms to them.

If `design.md` doesn't exist yet, run Step 0a (Design system) first. Expansion without a design context produces generic scene breakdowns that later agents ignore.

## Why always run it

**The expansion is never pass-through.** Every user prompt — no matter how detailed — is a _seed_. The expansion's job is to enrich it into a fully-realized per-scene production spec that the scene subagents can build from directly.

Even a detailed 7-scene brief lacks things only the expansion adds:

- **Atmosphere layers per scene** (required 2–5 from house-style: radial glows, ghost type, hairline rules, grain, thematic decoratives) — the user's prompt almost never lists these; expansion adds them.
- **Secondary motion for every decorative** — breath, drift, pulse, orbit. A decorative without ambient motion feels dead.
- **Micro-details that make a scene feel real** — registration marks, tick indicators, monospace coord labels, typographic accents, code snippets in the background, grid patterns. Things the user didn't think to request.
- **Transition choreography at the object level** — not "crossfade" but "X expands outward and becomes Y". Specific duration, ease, and morph source/target.
- **Pacing beats within each scene** — where tension builds, where a hold lets the viewer breathe, where the accent word lands.
- **Exact hex values, typography parameters, ease choices** from design.md — no vagueness left for the scene subagent to guess.

Expansion's job on a detailed prompt is not to summarize or pass through — it's to **take what the user wrote and make it richer**. The user's content stays; the atmosphere, ambient motion, and micro-details are added on top. That's what makes the difference between a scene that matches the brief and a scene that feels alive.

The quality gap between a single-pass composition and a multi-scene-pipeline composition comes from this step. Expansion front-loads the richness so every scene subagent builds from a rich brief, not a terse one.

**Do not skip. Do not pass through.** Single-scene compositions and trivial edits are the only exceptions.

## Before you enrich: calibrate to content culture

Enrichment without calibration is the main failure mode of always-enrich. Before picking decoratives, motion, and narrative arc, identify the composition's **genre** and pick the energy register the genre expects. Reach for enrichment inside that register.

The failure mode this rule corrects: a running-shoes teaser treated as an introspective narrative (stillness → ignition → claim) is clever but wrong — consumer-brand launches exist to pump the viewer up, not to make them contemplate. Similarly, a documentary about a 1936 photograph treated with tech-product chrome (ghost watermarks, coord stamps, corner registration ticks) fights the tone.

| Genre                                                           | Energy register                        | What the genre wants                                                                                                                                          | What the genre does NOT want                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Consumer brand launch** (sports, fashion, beverage, CPG)      | Bold, kinetic, in-your-face            | Display typography at scale (200px+), marquee motion, beat-synced cuts, oversized color blocks, counters ticking live, confidence in short bursts             | Introspective narrative arcs, contemplative opening scenes, whisper captions, "journey" framing                                     |
| **Product demo** (SaaS, B2B, developer tools)                   | Confident, measured, purposeful        | The product doing its actual thing — pipeline moving, values changing, workflows running. Arc follows the product's real flow, not a marketing template       | Problem-hook → stat → product → proof → CTA when the product itself is more interesting than the pitch                              |
| **Technical explainer** (science, engineering, how-things-work) | Clear, labeled, progressively revealed | Diagrams that build — each scene adds a labeled entity to the previous one. Restrained. Numbers with units.                                                   | Dramatic reveals, bombastic typography, "sci-fi" moves                                                                              |
| **Documentary / archival**                                      | Quiet, reverent, observational         | Long holds (4+ seconds of stillness per scene), restrained typography, the subject doing the work. Minimal decoration.                                        | Tech-product chrome (registration marks / coord stamps / ghost words / tick rails), bouncy eases, ambient "breathing" on everything |
| **Editorial / brand story** (luxury, fashion, lifestyle)        | Warm, writerly, mood-driven            | Serif headlines, pull-quotes held unchanged for seconds, generous whitespace, mono metadata only for factual anchors (dates, places, credits). Magazine feel. | Dashboard chrome, data-UI patterns, tabular numbers, dense HUDs                                                                     |
| **News / social / viral**                                       | Snappy, high-contrast, caption-forward | Big readable text, fast cuts, stacked caption layers, short scene durations (1.5–3s), urgency                                                                 | Slow eases, ambient drift, "breathing" decoratives                                                                                  |

**Always-enrich has a known over-rotation: it reaches for narrative reframes on any prompt.** For brand/consumer content, that reframe costs you the genre's native energy. The expansion should choose the register FIRST, then decide what to enrich.

### How to apply

1. Read the user's prompt. Identify the single-most-likely genre from the table above.
2. Pick the energy register. Note what it does NOT want.
3. NOW enrich — decoratives, motion, narrative arc — staying inside that register.

If the prompt's genre is ambiguous, check `design.md`'s mood field — it often disambiguates (`mood: bold, athletic, kinetic` means brand-launch register, not documentary).

## Use the real subject when it exists

If the composition is about a specific, named, real-world artifact — a photograph, painting, song, public figure's recorded words, a real company's UI, a historical event — and that artifact is accessible via public sources, **use it**. Don't abstract it to a placeholder to preserve a skill rule.

- A documentary about Dorothea Lange's 1936 "Migrant Mother" → fetch the photograph (it's in Library of Congress FSA/OWI collection, public-domain-equivalent, IIIF accessible). Don't ship a `[ PHOTOGRAPH ]` placeholder caption.
- A piece about Vermeer's "Girl with a Pearl Earring" → fetch the painting (Mauritshuis has open-access imagery).
- A 1969 moon landing piece → specific NASA photographs exist in NASA's open archive.
- A piece about a specific public figure's speech → quote their actual words when available.
- A product demo for a well-known company → their actual UI and brand are canonical; use them unless the prompt says otherwise.

**R4 (persistent-element continuity morph) applies to HOW you present the subject**, not WHETHER to use a real one. When both are available, use both — fetch the real artifact AND structure it via a persistent overlay that migrates across transitions.

### When to abstract instead

- The subject doesn't exist yet (a fictional brand launch).
- The subject is private / proprietary / unavailable (an unreleased product).
- Using the real subject would require violating license or consent (a living person who hasn't consented to this use).

These are the exceptions. The default is: use what's real.

## What to generate

Expand into a full production prompt with these sections:

1. **Title + style block** — cite design.md's palette (bg/fg/accent hex values), typography pairing, energy level, and mood. Do NOT invent a palette — quote the design.md values.
2. **Global animation rules** — parallax layers, micro-motion requirements, kinetic typography, pacing rules, transition style. Align energy with design.md (calm → slow eases, high energy → snappy eases).
3. **Scene-by-scene breakdown** — for each scene, enumerate:
   - Time range and title
   - **Background layer** — list the 2–5 decoratives (from house-style's list) with exact positioning, opacity values from design.md, and the ambient motion each uses (breath, drift, pulse, orbit). This is almost always richer than what the user's prompt specified — the user rarely lists atmosphere, you add it.
   - **Midground** — content elements (not generic: "alien claw slides across wall" not "scary things happen"). Keep everything the user specified; add what's missing.
   - **Foreground** — text, typography, animation style per text element. Type sizes and weights quoted from design.md.
   - **Micro-details** — registration marks, tick indicators, monospace coord/meta labels, typographic accents, background data streams, grid patterns. These are what make a scene feel real. The user's prompt never lists them; expansion adds at least 2–3 per scene.
   - **Transition out** — specific morph (what object becomes what, duration, ease), not just "cut" or "crossfade"
4. **Recurring motifs** — visual threads that appear across multiple scenes, always drawn from design.md's palette and typography.
5. **Transition rules** — every scene-to-scene connection described as object morphing. Transition duration/ease should match design.md's energy level.
6. **Pacing curve** — where energy builds, peaks, and releases.
7. **Negative prompt** — what to avoid for this specific composition.

## Output

Write the expanded prompt to `.hyperframes/expanded-prompt.md` in the project directory. Do NOT dump it into the chat — it will be hundreds of lines.

Tell the user:

> "I've expanded your prompt into a full production breakdown. Review it here: `.hyperframes/expanded-prompt.md`
>
> It has [N] scenes across [duration] seconds with specific visual elements, transitions, and pacing. Edit anything you want, then let me know when you're ready to proceed."

Only move to construction after the user approves or says to continue.
