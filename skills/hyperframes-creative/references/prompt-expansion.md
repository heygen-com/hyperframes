# Prompt Expansion

Run on every composition. Expansion is not about lengthening a short prompt — it's about grounding the user's intent against the design spec (`frame.md` or `design.md`) and `house-style.md` and producing a consistent intermediate that every downstream agent reads the same way.

Runs AFTER design direction is established (Step 1). The expansion consumes the design spec (`frame.md` or `design.md`, if present) and produces output that cites its exact values.

## Prerequisites

Read before generating:

- the design spec — `frame.md` → `design.md` → `DESIGN.md` (read the first that exists) — extract brand colors, fonts, mood, and constraints. The expansion cites these exact values (hex codes, font names); it does not invent new ones.
- `references/beat-direction.md` — per-beat planning format (concept, mood, choreography verbs, transitions, depth layers, rhythm). The expansion outputs each scene using this format.
- `references/video-composition.md` — video-medium rules for density, scale, and color presence. The expansion applies these automatically.
- `house-style.md` — its rules for Background Layer (2-5 decoratives), Color, Motion, Typography apply to every scene. The expansion writes output that conforms to them.

If no design spec (`frame.md` or `design.md`) exists yet, run Step 1 (Design system) first. Expansion without a design context produces generic scene breakdowns that later agents ignore.

## Why always run it

**The expansion is never pass-through.** Every user prompt — no matter how detailed — is a _seed_. The expansion's job is to enrich it into a fully-realized per-scene production spec that the scene subagents can build from directly.

Even a detailed 7-scene brief lacks things only the expansion adds:

- **Atmosphere layers per scene** (required 2–5 from house-style: radial glows, ghost type, hairline rules, grain, thematic decoratives) — the user's prompt almost never lists these; expansion adds them.
- **Secondary motion for every decorative** — breath, drift, pulse, orbit. A decorative without ambient motion feels dead.
- **Micro-details that make a scene feel real** — registration marks, tick indicators, monospace coord labels, typographic accents, code snippets in the background, grid patterns. Things the user didn't think to request.
- **Transition choreography at the object level** — not "crossfade" but "X expands outward and becomes Y". Specific duration, ease, and morph source/target.
- **Pacing beats within each scene** — where tension builds, where a hold lets the viewer breathe, where the accent word lands.
- **Exact hex values, typography parameters, ease choices** from the design spec — no vagueness left for the scene subagent to guess.

Expansion's job on a detailed prompt is not to summarize or pass through — it's to **take what the user wrote and make it richer**. The user's content stays; the atmosphere, ambient motion, and micro-details are added on top. That's what makes the difference between a scene that matches the brief and a scene that feels alive.

The quality gap between a single-pass composition and a multi-scene-pipeline composition comes from this step. Expansion front-loads the richness so every scene subagent builds from a rich brief, not a terse one.

**Do not skip. Do not pass through.** Single-scene compositions and trivial edits are the only exceptions.

## What to generate

Expand into a full production prompt with these sections:

1. **Title + style block** — cite the design spec's exact hex values, font names, and mood. Do NOT invent a palette — quote what the design provides.

2. **Rhythm declaration** — name the scene rhythm before detailing any scene. Example: `hook-PUNCH-breathe-CTA` or `slow-build-BUILD-PEAK-breathe-CTA`. Use `references/beat-direction.md` for rhythm templates by video type.

3. **Global rules** — parallax layers, micro-motion requirements, transition style, primary + accent transitions. Match energy to mood (calm → slow eases, high → snappy eases).

4. **Per-scene beats** — for each scene, use the beat-direction format:
   - **Concept** — the big idea in 2-3 sentences. What visual WORLD? What metaphor? What should the viewer FEEL?
   - **Mood direction** — cultural/design references, not hex codes. ("Bauhaus color studies", "cinematic title sequence", "editorial calm")
   - **Depth layers** — BG treatment, MG content, and FG accents or structural details as the concept needs. Use `video-composition.md` to choose density; do not force an element count or invent content to fill one.
   - **Animation choreography** — specific verbs per element. High: SLAMS, CRASHES. Medium: CASCADE, SLIDES. Low: floats, types on, counts up. Every element gets a verb. If you can't name the verb, the element is not yet designed.
   - **Transition out** — shader or CSS, with specific type and parameters. Not "crossfade" but "blur crossfade, 0.4s, power2.inOut."

5. **Recurring motifs** — visual threads across scenes from the brand palette.

6. **Negative prompt** — what to avoid, informed by the design spec's constraints if present.

## Output

Write the expanded prompt to `.hyperframes/expanded-prompt.md` in the project directory. Do NOT dump it into the chat — it will be hundreds of lines.

Tell the user:

> "I've expanded your prompt into a full production breakdown. Review it here: `.hyperframes/expanded-prompt.md`
>
> It has [N] scenes across [duration] seconds with specific visual elements, transitions, and pacing. Edit anything you want, then let me know when you're ready to proceed."

Only move to construction after the user approves or says to continue.
