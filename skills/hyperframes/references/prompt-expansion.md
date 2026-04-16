# Prompt Expansion

Expand a sparse user prompt into a full production prompt. Runs AFTER `design.md` is established (Step 0a) — the expansion consumes design.md and produces output that cites its palette, typography, and motion energy.

## Prerequisites

- `design.md` exists in the project root. If not, run Step 0a (Design system) first. Expansion without a design context produces generic scene breakdowns that later agents ignore.

## When to expand

A prompt needs expansion if it lacks: scene-by-scene structure, specific visual elements per scene, transition descriptions, or timing.

**Sparse:** "make me a trailer about a killer alien on a spaceship" or "coconut water promo, tropical, 45 seconds"

**Already expanded:** Has numbered scenes with timing, specific elements, transition rules, and animation direction — skip this step.

## What to generate

Expand into a full production prompt with these sections:

1. **Title + style block** — cite design.md's palette (bg/fg/accent hex values), typography pairing, energy level, and mood. Do NOT invent a palette — quote the design.md values.
2. **Global animation rules** — parallax layers, micro-motion requirements, kinetic typography, pacing rules, transition style. Align energy with design.md (calm → slow eases, high energy → snappy eases).
3. **Scene-by-scene breakdown** — for each scene:
   - Time range and title
   - **Background layer (REQUIRED, 2-5 decoratives)** — pick from house-style's decorative list (radial glow / oversized ghost type / accent hairline rules / grid patterns / thematic decoratives) AND confirm each uses design.md's palette values. "Single ambient motion per scene" means one LOOPING MOTION applied to these decoratives, not one element total.
   - **Midground (content)** — specific visual elements (not generic — "alien claw slides across wall" not "scary things happen")
   - **Foreground (text + accents)** — text/typography with animation style
   - Transition to next scene as a specific morph (what object becomes what)
4. **Recurring motifs** — visual threads that appear across multiple scenes, always drawn from design.md's palette and typography.
5. **Transition rules** — every scene-to-scene connection described as object morphing. Transition duration/ease should match design.md's energy level.
6. **Pacing curve** — where energy builds, peaks, and releases.
7. **Negative prompt** — what to avoid. Always include: "no colors outside design.md palette, no fonts outside design.md typography pair".

## Output

Write the expanded prompt to `.hyperframes/expanded-prompt.md` in the project directory. Do NOT dump it into the chat — it will be hundreds of lines.

Tell the user:

> "I've expanded your prompt into a full production breakdown. Review it here: `.hyperframes/expanded-prompt.md`
>
> It has [N] scenes across [duration] seconds with specific visual elements, transitions, and pacing. Edit anything you want, then let me know when you're ready to proceed."

Only move to construction after the user approves or says to continue.
