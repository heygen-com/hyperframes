# Text Effects — Reference

For deterministic text-animation specs (e.g., `typewriter` at exact `240ms / 46ms stagger / steps(1, end) easing`), this skill defers to the separate **`animate-text`** skill maintained by Pixel Point at [github.com/pixel-point/animate-text](https://github.com/pixel-point/animate-text). It provides a catalog of 24 named text effects with portable contracts and per-library implementation recipes (GSAP, Anime.js, WAAPI).

**We do NOT ship the catalog inside this repo.** Pixel Point's `animate-text` is the source of truth; vendoring its files here would violate the upstream's licensing (no explicit license declared upstream as of this writing). Loading the skill separately keeps the legal picture clean while giving you the same catalog.

## How to use it

When a beat needs a deterministic text animation, load the upstream skill alongside this one:

```bash
# In your project root, install the upstream skill into .agents/skills/
npx skills add pixel-point/animate-text
```

Or in Claude Code / a skill-aware agent runtime, the skill is invoked by name:

```
/animate-text
```

Once installed, the specs live at:

```
.agents/skills/animate-text/assets/effects/<id>.json   # per-library implementation recipe
.agents/skills/animate-text/assets/specs/<id>.json     # portable motion contract
```

Sub-agents reading those files get exact GSAP timings, easing strings, DOM split rules, and stagger algorithms — no creative invention needed.

## When you don't need the upstream skill

If a beat's text animation is simple enough to describe in prose ("headline fades up word-by-word, 80ms stagger"), implement it inline using the GSAP knowledge already in this skill ([motion-principles.md](motion-principles.md), [beat-direction.md](beat-direction.md), [techniques.md](techniques.md) — see entry #4 "Per-Word Kinetic Typography"). The upstream catalog is most valuable when:

- You want a specific NAMED effect across multiple beats (so they feel like one design system, not one-offs)
- You're choosing between several similar effects (typewriter vs per-character-rise vs bottom-up-letters) and want to see all 24 in one place
- You need layout-aware effects (`kinetic-center-build`, `short-slide-right`, `short-slide-down`) where parameters alone aren't enough — those ship with custom layout algorithms

## Effect names — vocabulary (do NOT use this as the implementation source)

For convenience while writing storyboards: the upstream skill provides 24 effects. Their IDs are listed here so you can name them in `STORYBOARD.md` even before loading the upstream skill. **The implementation specs are in the upstream skill, not here.**

- **Per-character (7):** soft-blur-in, per-character-rise, typewriter, bottom-up-letters, top-down-letters, stagger-from-center, stagger-from-edges
- **Per-word (8):** per-word-crossfade, spring-scale-in, shared-axis-y, blur-out-up, kinetic-center-build, short-slide-right, short-slide-down, depth-parallax-words
- **Per-line (2):** mask-reveal-up, line-by-line-slide
- **Whole element (7):** micro-scale-fade, shimmer-sweep, fade-through, shared-axis-z, scale-down-fade, focus-blur-resolve, shared-axis-x

For descriptions, durations, easing curves, and the per-library recipes: load `/animate-text` and read its own catalog page.

## In the storyboard

Every text element in every beat can name an effect by ID, e.g.:

```markdown
**Text Animations:**

- Main headline: `kinetic-center-build`
- Eyebrow label: `soft-blur-in`
- Body copy 3 lines: `mask-reveal-up`
```

Sub-agents implementing the beat will load `/animate-text` if it's not already loaded, then read the spec for each named effect from the upstream skill's files.

If the upstream skill isn't available (offline build, network restrictions, agent runtime that doesn't support skill loading), sub-agents fall back to implementing the effect from the description alone — using GSAP knowledge plus the effect ID as a description of intent (e.g., "typewriter" = per-character stepped reveal with no interpolation).
