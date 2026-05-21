# Text Effects — Bundled Catalog

24 named text animation effects, bundled into HyperFrames. No separate install needed.

**One JSON file per effect** at `skills/hyperframes/assets/text-effects/<id>.json`. Each file is the portable contract for that effect — the per-element parameters (durations, staggers, easings, from/to keyframes, swap behavior). The shared GSAP rendering pattern (how to split text, how to stagger, how to wire to a timeline) lives once in this file, below the catalog.

**How to use:** pick an effect that fits the brand, mood, and content. Read its `.json` to get parameters. Read the shared rendering pattern below to implement.

---

## Catalog

### Per-character

| ID                    | Enter duration | Stagger | Character                                                                                    |
| --------------------- | -------------- | ------- | -------------------------------------------------------------------------------------------- |
| `soft-blur-in`        | 700ms          | 20ms    | Letters fade in with a gentle upward drift and brief blur trail. Premium, atmospheric.       |
| `per-character-rise`  | 520ms          | 18ms    | Letters slide up from below baseline, no blur. Crisp, deliberate, kinetic.                   |
| `typewriter`          | 200ms          | 50ms    | Stepped reveal — characters pop into existence at discrete intervals. Mechanical, editorial. |
| `bottom-up-letters`   | 320ms          | 65ms    | Pronounced staircase rise from below. Confident, audible-feeling rhythm.                     |
| `top-down-letters`    | 320ms          | 65ms    | Mirror of bottom-up — characters descend from above.                                         |
| `stagger-from-center` | 480ms          | 32ms    | Middle character reveals first, edges last. Emphasizes the keyword core.                     |
| `stagger-from-edges`  | 480ms          | 32ms    | Edge characters reveal first, center last. Assembles inward toward the keyword.              |

### Per-word

| ID                     | Enter duration | Stagger | Character                                                                                       |
| ---------------------- | -------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `per-word-crossfade`   | 460ms          | 140ms   | Words fade in sequentially with short vertical drift. Calm, paced.                              |
| `spring-scale-in`      | 280ms          | 80ms    | Words pop in with spring overshoot (1.06 then settle). Bouncy without being cartoonish.         |
| `shared-axis-y`        | 160ms          | 60ms    | Hard-cut word-by-word along Y axis. Sharp, editorial.                                           |
| `blur-out-up`          | 360ms          | 90ms    | Clean entrance, blurry rising exit. Lingers in memory rather than dismisses.                    |
| `kinetic-center-build` | 480ms          | 220ms   | Phrase builds right-to-left, line stays centered as it grows. **Layout-aware.**                 |
| `short-slide-right`    | 560ms          | 120ms   | Whole line glides in from the left as one move; words reveal only by opacity. **Layout-aware.** |
| `short-slide-down`     | 420ms          | 160ms   | Each word drops in from above and pushes the stack down. **Layout-aware.**                      |
| `depth-parallax-words` | 540ms          | 110ms   | Words enter at varied scales (0.82 → 1.0) reading as layered depth.                             |

### Per-line

| ID                   | Enter duration | Stagger | Character                                                                   |
| -------------------- | -------------- | ------- | --------------------------------------------------------------------------- |
| `mask-reveal-up`     | 580ms          | 90ms    | Lines clip-reveal upward through a masked viewport. Contained, masked feel. |
| `line-by-line-slide` | 640ms          | 110ms   | Lines slide in from left, exit to right. Flowing paragraph rhythm.          |

### Whole element

| ID                   | Enter duration | Character                                                                    |
| -------------------- | -------------- | ---------------------------------------------------------------------------- |
| `micro-scale-fade`   | 460ms          | Tiny scale (0.96 → 1.0) + fade. Barely perceptible, reads as polish.         |
| `shimmer-sweep`      | 680ms          | Horizontal light sweep glides left-to-right. Premium, luxury polish.         |
| `fade-through`       | 280ms          | Material-style sequential dissolve — old fades out fully, then new fades in. |
| `shared-axis-z`      | 360ms          | Scale-based depth swap. Outgoing recedes, incoming arrives from depth.       |
| `scale-down-fade`    | 380ms          | Symmetric scale (1.04 → 1.0) on entrance and exit. Restrained, premium.      |
| `focus-blur-resolve` | 580ms          | Heavy 16px blur resolves to sharp clarity. Reads as a camera focus pull.     |
| `shared-axis-x`      | 380ms          | Horizontal sibling transition for sequential destinations (next/prev).       |

---

## Shared rendering pattern (GSAP)

All non-layout-aware effects render the same way. Implement once, then per-effect just feed in the parameters from the JSON.

**1. Register CustomEase** (most effects use cubic-bezier strings):

```js
gsap.registerPlugin(CustomEase);
```

**2. Split the text by `target`:**

| `target`  | Split rule                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------ |
| `char`    | `Array.from(text)` — preserve every character including spaces and punctuation as animated units |
| `word`    | Regex `/(\S+\|\s+)/g` — span-wrap words and whitespace; animate the non-whitespace spans only    |
| `line`    | Split on `"\n"` — each line is a block-display span                                              |
| `element` | No split — the whole element is the animated unit                                                |

Wrap each animated unit in a span (e.g., `.text-anim-unit`). For `char` and `word` targets use `display: inline-block`; for `line` use `display: block`.

**3. Set the initial state with `gsap.set()`** from the effect's `enter.from`:

```js
gsap.set(units, { opacity: 0, y: 14, filter: "blur(8px)" }); // values from <effect>.enter.from
```

**4. Animate to `enter.to` with a stagger using the effect's easing and duration:**

```js
const ease = CustomEase.create("custom-in", "cubic-bezier(0.22, 1, 0.36, 1)"); // from enter.easing
tl.to(
  units,
  {
    opacity: 1,
    y: 0,
    filter: "blur(0px)", // values from enter.to
    duration: enterDurationMs / 1000, // 700ms → 0.7
    ease,
    stagger: enterStaggerMs / 1000, // 20ms → 0.02
  },
  0,
);
```

**5. For exit**, do the same with `exit.from` / `exit.to` / `exit.durationMs` / `exit.easing`. Place it on the timeline at `beatEnd - exit.durationMs - (units.length * exit.staggerMs) / 1000`.

**6. Hard-kill at beat boundaries** (so a later tween or sibling resurrect doesn't bring the element back):

```js
tl.set(units, { opacity: 0, visibility: "hidden" }, beatEnd + 0.01);
```

### Custom stagger order

Two effects use ordered staggers (not DOM order):

| Effect                | `staggerOrder` value | Algorithm                                                                           |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `stagger-from-center` | `center-out`         | Rank = `\|index - centerIndex\|`. Ties: lower index first.                          |
| `stagger-from-edges`  | `edges-in`           | Rank = `(text.length - 1) / 2 - \|index - centerIndex\|`. Ties: higher index first. |

GSAP's `stagger: { each, from: "center" }` handles `center-out` natively. For `edges-in`, write the function form: `stagger: { each, from: (i, target, list) => /* edges-in rank */ }`.

### Layout-aware effects (3)

Three effects in the catalog (`kinetic-center-build`, `short-slide-right`, `short-slide-down`) animate the LINE container's position separately from each word's reveal. Their JSON includes `layoutAware: true` plus optional `lineFrom` / `lineTo` keyframes for the container.

Implementation pattern:

1. Wrap all word spans in a `.text-anim-line` container.
2. Animate the line container with `lineFrom` → `lineTo` (or, for `kinetic-center-build`, with a per-word x-offset to keep the line centered as it grows).
3. Independently stagger the word spans' opacity (and any per-word transform from `enter.from` / `enter.to`).

Each layout-aware effect's `notes` field in its JSON tells you which line-level transform to apply. Don't infer.

---

## In the storyboard

Every text element in every beat names an effect by ID. Not "headline fades in" — read the catalog, pick the effect that fits the brand and beat, and name the specific ID.

Format:

```markdown
**Text Animations:**

- [element, e.g. "main headline"]: `[effect-id]` — skills/hyperframes/assets/text-effects/[id].json
- [element, e.g. "eyebrow label"]: `[effect-id]` — skills/hyperframes/assets/text-effects/[id].json
- [element, e.g. "body copy 3 lines"]: `[effect-id]` — skills/hyperframes/assets/text-effects/[id].json
```

Sub-agents read the named JSON and implement using the shared rendering pattern above. No creative invention needed — just parameter substitution.
