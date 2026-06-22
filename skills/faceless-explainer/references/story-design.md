# Story design — faceless explainer video

Use this reference in Step 3 to write `STORYBOARD.md` and `SCRIPT.md` for a faceless explainer — a topic, concept, how-to, listicle, or narrative explainer built from text, with **no product, no website, and no captured assets**.

This file defines the story: what the video teaches, in what order, and why each frame exists. It does not define layout, visual effects, animation, or final markdown schemas. For exact file syntax, follow `../hyperframes-core/references/storyboard-format.md` and `../hyperframes-core/references/script-format.md`.

## Read first

Read these inputs before writing:

1. `hyperframes.json` — locked brief: angle, length, aspect ratio, language.
2. `frame.md` — tone, mood, design system, and register.
3. `capture/extracted/visible-text.txt` — the article / notes / topic / brief (the source of **information**).
4. `user_script.txt` and `VO_MODE`, when the user pasted a script.

There is no `asset-descriptions.md` and no `capture/assets/` to inspect — this is faceless. Every visual is invented downstream (Steps 4-5); your job here is the **narrative**, not a visual asset list.

## Output

Create two files:

- `STORYBOARD.md` — the teaching plan, one frame per beat.
- `SCRIPT.md` — the locked narration, only for spoken frames.

Every storyboard frame must include the required fields from the storyboard format reference, plus the narrative metadata below.

## Core rule

An article is an information dump. A video is a guided act of understanding.

Do not follow paragraph order. Reorder, merge, omit, and compress the source text into a clear teaching sequence. Strip the asides; surface the spine. **The single most common failure is paraphrasing the article in order — do not do that.** The input text is the source of information, not a story template.

## Step 3 method

### 1. Extract the teaching truth

From the brief and text, identify:

- Audience — who the video is speaking to, and what they already (don't) know.
- Gap or stakes — the confusion, question, or "why care" the explanation resolves.
- Thesis — the one-line idea the viewer should walk away with.
- Spine — the 3-6 ideas (mechanisms / steps / items / beats) that build to the thesis.
- Evidence — the concrete numbers, examples, comparisons, or worked cases that ground it.
- Landing — the takeaway or the call to think / try / act.

Write the storyboard around the thesis, not around the article's sections.

### 2. Match the register to `frame.md`

Use `frame.md` as a soft guide — the visual system tunes the **voice**, not the structure:

| `frame.md` signal              | Story effect                           |
| ------------------------------ | -------------------------------------- |
| warm, handmade, notes-like     | plain, considered, low-hype; humane    |
| bold, poster-like, declarative | short punchy beats, confident claims   |
| friendly, polished, modern     | approachable direct address, lighter   |
| literary, technical-but-human  | thoughtful, precise; safe for code/dev |

The teaching truth decides the arc. The visual system tunes the voice.

### 3. Choose one explainer structure

Pick **one** structure (or explicitly name a compound). Do not splice phases from different structures — each is a complete path through understanding.

| Structure           | "It is…"                                         | Use when the payload is…                                    | Body shape                                                           |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `concept-explainer` | "what is X, and why does it matter"              | one idea/term/phenomenon the audience half-knows            | name concept → reveal mechanism layer by layer → land implication    |
| `how-to-process`    | "here is how to do / how X works," ordered steps | a procedure or mechanism with a clear start→finish          | a 3-6 step sequence on a consistent visual stage, one move each      |
| `listicle`          | "N things about X"                               | a set of parallel, co-equal items (tips, mistakes, reasons) | hook → N roughly co-equal items → wrap; rule-of-three is strongest   |
| `story-explainer`   | teach through a narrative arc                    | case studies, histories, cautionary tales                   | setup → tension → turn → resolution → lesson; the lesson generalizes |

**Choosing:** one idea to understand → concept; an ordered procedure → how-to; parallel co-equal items → listicle; a concrete narrative/case → story.

**Compounds** layer an outer arc with an inner rhythm — e.g. `concept-explainer with process` (ordered steps inside the mechanism phase), `story-explainer with how-to`. Set `arc` in the frontmatter to the chosen structure (or `<outer> with <inner>`). The downstream visual phase reads it for pacing: a process inner rhythm means tighter seams on a consistent stage and shorter frames.

### 4. Build the frame sequence

Each frame needs one clear job. Avoid frames that only say "more detail" or "another point."

For every frame, define (use the storyboard format's fields, with these narrative additions in the frame's metadata + prose):

- `type` — one of `hook | pain_point | product_intro | feature_showcase | benefit_highlight | social_proof | branding | cta`. This enum is shared with the downstream visual layer for pacing; **repurpose** it for teaching per the mapping below.
- `persuasion` — a **named** rhetorical / clarity technique (see catalog), not "explain the idea."
- `beat` — the target feeling (see vocabulary).
- `scene` — a one-line visual idea, not detailed composition.
- `voiceover` — spoken guide text, or empty for silent frames.
- `transition_in` — a registry transition name (see Transitions).

In the prose under each frame, state:

- `narrativeRole` — the scene's **job** in the explanation (e.g. "Concretizes compound interest as a snowball," not "Shows a chart").
- `keyMessage` — the one thing the viewer should understand after this frame (one sentence).

### Type-enum repurposing (shared enum → explainer roles)

The enum is shared with the product-launch visual layer; map your explainer roles onto it so downstream pacing matches the frame's job:

| Explainer role you want          | Use `type`          | Why this value                                                       |
| -------------------------------- | ------------------- | -------------------------------------------------------------------- |
| Hook / curiosity gap             | `hook`              | The high-leverage opening 3-5s.                                      |
| Pain / problem / why-care        | `pain_point`        | The friction or gap the explanation resolves.                        |
| Name the core concept            | `product_intro`     | "Introduce the protagonist" — here the protagonist is the **idea**.  |
| Mechanism / step / item          | `feature_showcase`  | A unit of the body — one move of a process, one mechanism, one item. |
| Implication / payoff / "so what" | `benefit_highlight` | The consequence or value of understanding.                           |
| Evidence / example / data point  | `social_proof`      | A concrete grounding: a number, a worked example, a comparison.      |
| Thesis / takeaway / principle    | `branding`          | The philosophical landing — the generalizable idea, the one line.    |
| Call to think / try / act        | `cta`               | The closing ask — try it, watch for it, question it.                 |

The body is usually a run of `feature_showcase` (steps/mechanisms/items), interleaved with `benefit_highlight` (implications) and `social_proof` (examples/data). At least one `feature_showcase` or `product_intro` should exist (every explainer has a body and a named idea).

## Hook strategy

Pick one opening strategy for the first 3-5 seconds. For explainers the hook opens a cognitive gap or stakes:

| Strategy               | Use when                                           | Example                                                          |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Shocking statistic     | A credible number quantifies the stakes.           | "90% of plastic ever made has never been recycled."              |
| Rhetorical question    | Create an immediate cognitive gap.                 | "Why does time seem to speed up as you get older?"               |
| Counterintuitive claim | The truth contradicts common belief.               | "Adding more lanes to a highway makes traffic worse."            |
| Pain validation        | The audience already feels the confusion.          | "Everyone says 'just diversify' — nobody says what that means."  |
| Visceral metaphor      | The idea is abstract and needs to become concrete. | "Your attention is a spotlight, and apps fight over the switch." |
| Concept announcement   | The term itself is the subject; make it memorable. | "There's a word for this: the bystander effect."                 |
| Direct address         | The audience is clearly defined.                   | "If you've ever rage-quit a recipe halfway — this is for you."   |
| Imagine / scenario     | A thought experiment frames the whole piece.       | "Imagine money that loses value if you don't spend it."          |
| Stakes / consequence   | The "why care now" is a real cost or risk.         | "Get this one step wrong and the whole batch is ruined."         |

The hook must create curiosity, tension, or stakes. Do not open with a generic definition.

## Clarity / rhetoric technique catalog

`persuasion` is a **named technique** — how this frame makes the idea land or clear — not a vague intent. Combine when several are active (e.g. "Analogy + progressive disclosure").

| Family               | Techniques                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Make-concrete**    | Analogy / metaphor · Concretization (abstract → tangible object) · Worked example with real numbers · Anchoring on a familiar referent       |
| **Reveal-in-order**  | Progressive disclosure (one term/layer at a time) · Build-up (simple → general case) · Signposting ("first… then… finally")                  |
| **Contrast**         | Before/after · Common-belief vs reality · Comparison of two options · Counterexample (here is when it breaks)                                |
| **Structure**        | Rule of three · Numbered enumeration · Question→answer pairing · Frame-then-fill (state the shape, then populate it)                         |
| **Evidence**         | Statistical proof · Citation / source · Demonstration (show the mechanism running) · Causal chain (A → B → C)                                |
| **Memory & landing** | Callback (return to the hook's image) · Distillation (compress to one line) · Coined term / mnemonic · Generalization (specific → principle) |

When no catalog technique fits, name a new one inline and explain its mechanism (e.g. "Subtractive framing: define the concept by what it is _not_ first"). Never write generic "explain the idea."

## Emotional beats

`beat` is one word or a short compound phrase (e.g. "Curiosity and clarity"). Avoid generic "positive" / "interested." Explainers ride a comprehension arc:

- **Negative valley** — _open the gap_ (hook / pain_point): curiosity · puzzlement · surprise · tension · concern · skepticism · recognition · intrigue
- **Pivot** — _orient_ (product_intro / concept-naming): clarity · orientation · anticipation · focus
- **Build** — _build understanding_ (feature_showcase / benefit_highlight / social_proof): comprehension · "aha" · confidence · fascination · foresight · momentum · conviction · delight · unease (for a caveat) · mastery
- **Resolution** — _land_ (branding / cta / final): clarity · satisfaction · resolve · inspiration · inevitability · "now I get it"

Compound beats are often strongest, e.g. "Surprise + recognition", "Comprehension + delight."

## The body is a sequence, not a single frame

An explainer's core is almost always **3-6 body frames on a consistent visual stage**, each advancing one mechanism / step / item / layer, building understanding cumulatively. A single isolated body frame rarely teaches anything.

- **concept-explainer:** name the concept (`product_intro`) → reveal the mechanism layer by layer (a run of `feature_showcase`, interleaving `benefit_highlight` for "so what" and `social_proof` for a grounding example).
- **how-to-process:** `feature_showcase` per step, ordered, on one stage. Carry the object being acted on across adjacent steps (see Continuity).
- **listicle:** `feature_showcase` per item; items are parallel, so default to `cut` / `push-slide` between them.
- **story-explainer:** frames follow the beats (setup / tension / turn / resolution / lesson); types map per the table (`pain_point` for tension, `branding` for the lesson).

## Continuity across frames (no worker grouping)

This framework builds **one frame per worker** — there is no "continue run" that hands several frames to one worker. A sequence of frames reads as one continuous shot through two storyboard-level levers, both yours:

1. **A consistent stage** — consecutive body frames share the same composition idea (same diagram growing, same number line, same desk), stated in each frame's `scene` so Step 4 and the workers keep the stage stable.
2. **A consistent transition** — pick one seam type for a sequence (usually `push-slide <DIR>` for ordered steps, `crossfade` for a soft layer reveal) and repeat it across the run, so the frames feel like one flow rather than separate slides.

When a single element genuinely _transforms_ between two ideas (a diagram node becomes a chart bar, a formula becomes its result), keep it within **one frame** as a development beat (entrance → the transform → settle) rather than splitting it across a seam — the worker owns that motion. Note the intent in the frame's `scene` / narrative; Step 4 turns it into `effects` / `blueprint`.

## Transitions

Use only registry transition names in `transition_in`:

`cut | crossfade | blur-crossfade | push-slide LEFT | push-slide RIGHT | push-slide UP | push-slide DOWN | zoom-through | squeeze`

Pick 2-3 transition types for the whole video and repeat them. Frame 1 uses `cut` as a placeholder (there is no previous frame). Match the seam to the narrative: ordered steps → a consistent `push-slide`; a soft layer reveal or atmosphere shift → `crossfade` / `blur-crossfade`; zooming into a detail or pulling back → `zoom-through`; a clean topic switch or new list item → `cut`.

## Faceless visuals — no asset inventory

Every visual is invented downstream from each frame's `narrativeRole` / `keyMessage` / `scene` — typography, abstract graphics, diagrams, data-viz are all first-class. Therefore:

- Do **not** write an `asset_candidates` line describing intended diagrams or typography as if they were files. Visual intent belongs in `scene` + `narrativeRole`; the visual phase reads those.
- The **only** real asset is a user-supplied image already placed at `public/<basename>`. Then add one line `asset_candidates: public/<basename> — <≤25 words: what it is>`. Never invent paths or reference `capture/`.

## Script rules

### If there is no pasted script

Write tight per-frame narration:

- 1-2 sentences per spoken frame; usually 6-20 words.
- Concrete and human; teach, don't read the article aloud.
- **Strong** (concretization): "Compound interest isn't addition, it's a snowball — every turn picks up the snow from the last, then more."
- **Weak** (article-paraphrase): "The study, published in 2019, examined three cohorts and found that…" — that is reading, not explaining.

Avoid: "Unlock the power of…", "Seamless experience", long noun-phrase lists, a frame that is only a filler bridge ("Or…").

**Silent frames are allowed and common in explainers** — a diagram assembling itself, a worked example animating, a beat of held tension before a turn. Set `voiceover` empty and leave the frame out of `SCRIPT.md`; then `narrativeRole` + `persuasion` must carry what the script doesn't say.

### If `VO_MODE = restructure`

Treat `user_script.txt` as source material. Rewrite, reorder, merge, or omit to fit the chosen structure and target length.

### If `VO_MODE = verbatim`

Do not rewrite the user's words. Segment the script into frame-sized chunks at sentence or paragraph boundaries (you may split a long sentence at a natural clause boundary, but do not change words). Final duration follows the provided script.

## Frame template

Use the exact fields required by the core storyboard format. This is the narrative shape each frame should satisfy:

```md
## Frame N — Short name

- scene: one clear visual idea
- voiceover: "spoken guide text, or empty"
- duration: rough estimate in seconds
- transition_in: crossfade
- status: outline
- src: compositions/frames/NN-short-name.html
- type: feature_showcase
- persuasion: Progressive disclosure
- beat: comprehension

narrativeRole: What this frame does in the viewer's understanding.
keyMessage: The one idea the viewer should remember.
```

## Final checklist

Before asking for user approval, verify:

- One explainer structure is named (compound only when explicitly named); the sequence is narrative-driven, not paragraph-order-driven.
- The opening uses a named hook strategy.
- Each frame has one job; the body builds cumulatively (a run of `feature_showcase` / `benefit_highlight` / `product_intro`), not a single isolated body frame.
- Every frame has `type`, `persuasion` (a named technique from the catalog), and `beat` (specific, not generic).
- The emotional arc has meaningful variation matching the structure.
- Transitions use only registry names and repeat 2-3 types; frame 1 is `cut`.
- A consistent stage + consistent transition carry any multi-frame sequence; a genuine element transform stays inside one frame.
- `asset_candidates` is absent (faceless) except a real user-supplied `public/<basename>`.
- `SCRIPT.md` contains only locked spoken narration; silent frames are intentional and omitted from it.
