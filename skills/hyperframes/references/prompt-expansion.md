# Prompt Expansion

Run on every composition. Expansion is not about lengthening a short prompt — it's about grounding the user's intent against `design.md` and `house-style.md` and producing a consistent intermediate that every downstream agent reads the same way.

Runs AFTER `design.md` is established (Step 0a). The expansion consumes design.md and produces output that cites its palette, typography, and motion energy verbatim.

## Prerequisites

Read before generating:

- `design.md` — palette, typography, energy, mood. The expansion quotes these values; it does not invent any.
- [../house-style.md](../house-style.md) — its rules for Background Layer (2-5 decoratives), Color, Motion, Typography apply to every scene. The expansion does NOT re-state those rules; it writes output that conforms to them.

If `design.md` doesn't exist yet, run Step 0a (Design system) first. Expansion without a design context produces generic scene breakdowns that later agents ignore.

## Why always run it

A detailed user prompt can still be ambiguous or under-specified in ways only the expansion step surfaces:

- The user's color words ("warm", "cinematic") get resolved to design.md's exact hex values.
- Decorative layers that the user forgot to mention get added explicitly, per house-style.
- Transitions vaguely described ("cut", "crossfade") get specified as morph operations with duration and ease tied to design.md's energy.
- Per-scene timing gets verified to sum to the stated total.

If the user's prompt is already scene-by-scene, the expansion is shorter and largely pass-through, but it still binds the prompt to design.md and house-style — which is the contract the scene subagents and assembler depend on.

**Do not skip.** Single-scene compositions and trivial edits are the only exceptions.

## What to generate

Expand into a full production prompt with these sections:

1. **Title + style block** — cite design.md's palette (bg/fg/accent hex values), typography pairing, energy level, and mood. Do NOT invent a palette — quote the design.md values.
2. **Global animation rules** — parallax layers, micro-motion requirements, kinetic typography, pacing rules, transition style. Align energy with design.md (calm → slow eases, high energy → snappy eases).
3. **Scene-by-scene breakdown** — for each scene, three layers:
   - Time range and title
   - Background layer — list the decoratives (per the prerequisite rules)
   - Midground — the specific content elements (not generic: "alien claw slides across wall" not "scary things happen")
   - Foreground — text and typography with their animation style
   - Transition to next scene as a specific morph (what object becomes what)
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
