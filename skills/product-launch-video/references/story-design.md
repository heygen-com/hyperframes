# Story design — product launch video

Use this reference in Step 3 to write `STORYBOARD.md` and `SCRIPT.md` for a product launch, promo, feature reveal, or marketing video.

This file defines the story: what the video says, in what order, and why each frame exists. It does not define layout, visual effects, animation, or final markdown schemas. For exact file syntax, follow `../hyperframes-core/references/storyboard-format.md` and `../hyperframes-core/references/script-format.md`.

## Read first

Read these inputs before writing:

1. `hyperframes.json` — locked brief: angle, length, aspect ratio, language.
2. `frame.md` — tone, mood, design system, and brand register.
3. `capture/extracted/visible-text.txt` — product facts, page copy, positioning, proof, CTA.
4. `capture/extracted/asset-descriptions.md` — the only source for captured asset inventory.
5. `user_script.txt` and `VO_MODE`, when present.

Do not inspect `capture/assets/`, contact sheets, screenshots, or raw captured files during Step 3. Treat `asset-descriptions.md` as the canonical asset list. Do not invent asset filenames.

## Output

Create two files:

- `STORYBOARD.md` — the narrative plan, one frame per beat.
- `SCRIPT.md` — the locked narration, only for spoken frames.

Every storyboard frame must include the required fields from the storyboard format reference, plus the narrative metadata below.

## Core rule

A website is an information layout. A video is an emotional sequence.

Do not follow page order. Reorder, merge, omit, and reshape captured content into a clear launch story.

## Step 3 method

### 1. Extract the product truth

From the brief and captured text, identify:

- Audience — who the video is speaking to.
- Pain or desire — what the viewer already wants fixed or achieved.
- Promise — the one-line thesis of the video.
- Product role — what the product does in the story.
- Proof — features, UI moments, metrics, logos, examples, or demos.
- CTA — what the viewer should do next.

Write the storyboard around the promise, not around a list of features.

### 2. Match the register to `frame.md`

Use `frame.md` as a soft guide:

| `frame.md` signal             | Story effect                              |
| ----------------------------- | ----------------------------------------- |
| restrained, editorial, B2B    | plain, confident, low-hype script         |
| bold, kinetic, launch-like    | short hooks, punchier beats               |
| warm, human, playful          | friendly direct address, lighter phrasing |
| premium, cinematic, spectacle | aspirational framing, fewer words         |

The product truth decides the arc. The visual system tunes the voice.

### 3. Choose one outer arc

Pick one primary arc. Use a compound only when useful, e.g. `PAS with feature-benefit progression`.

| Arc                       | Use when                                                          | Beat order                                                                   | Reveal timing |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| `PAS`                     | The pain is known and urgent. Best for broken B2B workflows.      | hook → pain → agitation → solution tease → product intro → proof/demo → CTA  | late          |
| `Future Pacing`           | The product sells a new future, category, or paradigm.            | imagine → name product → remove pain → show mechanism → show outcome → CTA   | early         |
| `Demo Loop`               | The UI is self-explanatory and the product is best shown working. | question → product intro → demo cycle 1 → demo cycle 2 → trust/benefit → CTA | early         |
| `BAB`                     | The product bridges an old workflow to a better one.              | before → after tease → bridge/product → step 1 → step 2 → step 3/wow → CTA   | early-mid     |
| `Feature-Benefit Cascade` | The product is feature-rich or desire/status-driven.              | product/category hook → feature → benefit → feature → benefit → climax → CTA | frame 1       |

Use feature-benefit rhythm inside any arc when the video has many capabilities. Do not stack several features without translating them into viewer value.

### 4. Build the frame sequence

Each frame needs one clear job. Avoid frames that only say “more benefits” or “another feature.”

Use these frame types:

`hook | pain_point | product_intro | feature_showcase | benefit_highlight | social_proof | branding | cta`

For every frame, define:

- `type` — one of the allowed frame types.
- `persuasion` — the specific persuasion move.
- `beat` — the viewer emotion.
- `scene` — a one-line visual idea, not detailed composition.
- `voiceover` — spoken guide text, or empty for silent frames.
- `asset_candidates` — real captured assets that could support the frame.

The prose under each frame should state:

- `narrativeRole` — why this frame exists in the story.
- `keyMessage` — the one idea the viewer should remember.

## Hook strategy

Pick one opening strategy for the first 3-5 seconds:

| Strategy                | Use when                                        |
| ----------------------- | ----------------------------------------------- |
| Shocking statistic      | A credible number proves the pain.              |
| Pain validation         | The audience already knows the problem.         |
| Rhetorical question     | You need curiosity and speed.                   |
| Direct address          | The audience is clear and specific.             |
| Imagine / future pacing | The product introduces a new future.            |
| Category announcement   | The product is the category or launch headline. |
| Visual spectacle        | The aesthetic is part of the pitch.             |
| Trend positioning       | The product rides a timely market shift.        |

The hook must create tension, curiosity, or desire. Do not open with generic company description.

## Persuasion labels

Use concrete labels. Do not write generic labels like “show benefit.”

Good labels include:

- Pain agitation
- Cognitive overload
- Negative contrast
- Friction reduction
- Simplification
- Show-don’t-tell proof
- Demonstration of capability
- Feature-to-benefit translation
- Statistical proof
- Authority by association
- Social proof
- Risk reversal
- Future pacing
- Value stacking
- Empowerment and control
- Rule of three
- Scarcity / urgency
- Status seeking

When no label fits, create one and explain the mechanism in the frame prose.

## Emotional beats

Use specific emotions:

- Negative: `anxiety`, `frustration`, `overwhelm`, `tension`, `urgency`, `skepticism`, `FOMO`
- Pivot: `relief`, `curiosity`, `clarity`, `intrigue`, `aspiration`
- Build: `trust`, `confidence`, `control`, `ease`, `power`, `awe`, `excitement`, `belonging`, `reassurance`
- Close: `triumph`, `motivation`, `urgency-to-act`, `peace of mind`, `inevitability`

Compound beats are allowed, e.g. `relief + control`.

## Asset candidates

`asset_candidates` is the handoff from Step 3 to visual design and frame building.

Rules:

1. Read only `capture/extracted/asset-descriptions.md` to know what assets exist.
2. Use only filenames listed there.
3. Write candidates as `assets/<basename>`, where `<basename>` is the captured file basename.
4. Put all candidates on one line.
5. Separate candidates with semicolons.
6. Add a short description after `—`.
7. Prefer `[video]` assets when motion proves the product better than a still.
8. Use content assets: UI, screenshots, product photos, charts, diagrams, demos.
9. Skip tiny icons, favicons, badges, decorative chrome, and repeated logo variants unless the frame needs them.
10. Pure typography frames may use an empty asset list.

Example:

```md
- asset_candidates: assets/dashboard-hero.png — main analytics UI, dark dashboard, wide screenshot; assets/demo-loop.mp4 — product interaction clip, query to result flow
```

Do not use nested lists for assets. The parser expects a single metadata line.

## UI demos

A UI demo should usually be a sequence, not one isolated frame.

Use 3 or more consecutive `feature_showcase` / `benefit_highlight` frames on the same product surface when the product value depends on workflow or interaction.

Good demo rhythm:

1. Input or user action.
2. Product response.
3. Result, insight, automation, or saved effort.
4. Benefit or trust proof.

Use consistent transitions across the sequence so it feels like one flow.

## Script rules

### If there is no pasted script

Write tight per-frame narration:

- 1-2 sentences per spoken frame.
- Usually 6-20 words per frame.
- Concrete and human.
- Say what the product does for a person.
- Prefer active verbs.

Avoid:

- “Seamless experience.”
- “Unlock the power of...”
- “Streamline your workflow.”
- Long noun-phrase lists.
- A whole frame with only “Or...” or another filler bridge.

Silent frames are allowed when the visual proves the point. Leave them out of `SCRIPT.md`.

### If `VO_MODE = restructure`

Treat `user_script.txt` as source material. Rewrite, reorder, merge, or omit to fit the chosen arc and target length.

### If `VO_MODE = verbatim`

Do not rewrite the user’s words. Segment the script into frame-sized chunks at sentence or paragraph boundaries. You may split a long sentence at a natural clause boundary, but do not change words. The final duration follows the provided script.

## Transitions

Use only registry transition names:

`cut | crossfade | blur-crossfade | push-slide LEFT | push-slide RIGHT | push-slide UP | push-slide DOWN | zoom-through | squeeze`

Pick 2-3 transition types for the whole video and repeat them. Frame 1 can use `cut` as a placeholder.

## Frame template

Use the exact fields required by the core storyboard format. This is the narrative shape each frame should satisfy:

```md
## Frame N — Short name

- scene: one clear visual idea
- voiceover: "spoken guide text, or empty"
- duration: rough estimate in seconds
- transition_in: cut
- status: outline
- src: compositions/frames/NN-short-name.html
- type: hook
- persuasion: Pain validation
- beat: urgency
- asset_candidates: assets/example.png — short asset description

narrativeRole: What this frame does in the viewer journey.
keyMessage: The one idea the viewer should remember.
```

## Final checklist

Before asking for user approval, verify:

- The arc is named and consistent.
- The sequence is narrative-driven, not page-order-driven.
- The opening uses a clear hook strategy.
- Each frame has one job.
- Every frame has `type`, `persuasion`, and `beat`.
- Every visual frame has suitable `asset_candidates`, unless intentionally typography-only.
- Asset filenames come only from `capture/extracted/asset-descriptions.md`.
- UI/product demos use a multi-frame sequence when needed.
- Transitions use only registry names and repeat 2-3 types.
- `SCRIPT.md` contains only locked spoken narration.
- Silent frames are intentional and omitted from `SCRIPT.md`.
