# Text Effects — Bundled Catalog

24 named text animation effects, bundled into HyperFrames. No separate install needed.

**Spec files:**

- `skills/hyperframes/assets/text-effects/effects/<id>.json` — exact GSAP implementation recipe
- `skills/hyperframes/assets/text-effects/specs/<id>.json` — portable motion contract

**How to use:** pick an effect that fits the brand, mood, and content. Read its `.json` file. Use `showcase.library_adapters.gsap` for exact easing strings, durations, stagger values, and keyframe data.

---

## Catalog

### Per-Character

| ID                    | Enter duration | Stagger | Ease                          | Character                                                                        |
| --------------------- | -------------- | ------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `soft-blur-in`        | 648ms          | 18ms    | `cubic-bezier(0.22,1,0.36,1)` | Each letter fades in with a gentle upward drift and blur. Smooth, airy, premium. |
| `per-character-rise`  | 504ms          | 17ms    | `cubic-bezier(0.2,0.8,0.2,1)` | Letters slide up from below, no blur. Crisp, deliberate, kinetic.                |
| `typewriter`          | 173ms          | 33ms    | `steps(1,end)`                | Per-character stepped reveal. Discrete, mechanical, editorial.                   |
| `bottom-up-letters`   | 288ms          | 63ms    | `cubic-bezier(0.18,1,0.32,1)` | Letters rise from below in a pronounced staircase, one symbol at a time.         |
| `top-down-letters`    | 288ms          | 63ms    | `cubic-bezier(0.18,1,0.32,1)` | Same staircase but descending from above.                                        |
| `stagger-from-center` | —              | —       | —                             | Characters reveal outward from the center. Emphasizes the keyword core.          |
| `stagger-from-edges`  | —              | —       | —                             | Characters converge inward from both edges toward the center.                    |

### Per-Word

| ID                     | Enter duration | Stagger | Ease                             | Character                                                                                                                          |
| ---------------------- | -------------- | ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `per-word-crossfade`   | 504ms          | 50ms    | `cubic-bezier(0.16,1,0.3,1)`     | Words gently fade in with a short vertical drift. Calm, sequential.                                                                |
| `spring-scale-in`      | 259ms          | 68ms    | `cubic-bezier(0.34,1.56,0.64,1)` | Words pop in with a spring overshoot. Physical, bouncy, playful.                                                                   |
| `shared-axis-y`        | 140ms          | 56ms    | `steps(1,end)`                   | Hard-cut word-by-word with staircase timing. Sharp, editorial.                                                                     |
| `blur-out-up`          | 403ms          | 20ms    | `cubic-bezier(0.22,1,0.36,1)`    | Words arrive clean and exit upward with increasing blur. Airy exit.                                                                |
| `kinetic-center-build` | custom         | —       | custom                           | Each word locks center as phrase builds right-to-left with soft blur. Layout-aware renderer — read `showcase.rendering_contract`.  |
| `short-slide-right`    | custom         | —       | custom                           | Whole phrase glides in from the left as one move; words reveal only by opacity. Layout-aware — read `showcase.rendering_contract`. |
| `short-slide-down`     | custom         | —       | custom                           | Each word drops from above and pushes the stack down until centered. Layout-aware — read `showcase.rendering_contract`.            |
| `depth-parallax-words` | —              | —       | —                                | Per-word depth motion with scale and vertical drift. Layered readability.                                                          |

### Per-Line

| ID                   | Enter duration | Stagger | Ease                          | Character                                                          |
| -------------------- | -------------- | ------- | ----------------------------- | ------------------------------------------------------------------ |
| `mask-reveal-up`     | 547ms          | 65ms    | `cubic-bezier(0.22,1,0.36,1)` | Lines clip-reveal upward. Contained, intentional, masked feel.     |
| `line-by-line-slide` | 648ms          | 86ms    | `cubic-bezier(0.22,1,0.36,1)` | Lines slide in from left, exit to right. Flowing paragraph rhythm. |

### Whole Element

| ID                   | Enter duration | Ease                          | Character                                                                      |
| -------------------- | -------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `micro-scale-fade`   | 432ms          | `cubic-bezier(0.32,0.72,0,1)` | Tiny scale pop and fade. Barely perceptible — premium polish.                  |
| `shimmer-sweep`      | 612ms          | `cubic-bezier(0.22,1,0.36,1)` | Subtle horizontal sweep glides from left to center.                            |
| `fade-through`       | 302ms          | `cubic-bezier(0.2,0,0,1)`     | Old content fades out, new fades in with a soft delay. Material-style swap.    |
| `shared-axis-z`      | 374ms          | `cubic-bezier(0.2,0,0,1)`     | Scale-based depth transition. One context fades out small, next fades in full. |
| `scale-down-fade`    | 374ms          | `cubic-bezier(0.22,1,0.36,1)` | Content settles with a slight scale-down on exit. Restrained, premium.         |
| `focus-blur-resolve` | 547ms          | `cubic-bezier(0.22,1,0.36,1)` | Heavy blur resolves to sharp clarity on enter, returns to soft blur on exit.   |
| `shared-axis-x`      | —              | —                             | Horizontal sibling transition for sequential destinations.                     |

---

## Implementation in GSAP

**Step 1:** Read the effect JSON — `skills/hyperframes/assets/text-effects/effects/<id>.json`

**Step 2:** In `showcase.library_adapters.gsap` find:

- `import_statement` — which GSAP plugins to register (`CustomEase` is almost always needed)
- `easing_conversion` — exact easing string or `CustomEase.create()` call
- `start_animation` pattern — how to initialize the tween

**Step 3:** Get timing from `showcase.timing.enter`:

- `scaled_duration_ms` → convert to seconds for GSAP (`/ 1000`)
- `scaled_stagger_ms` → stagger value in seconds
- `easing` → register as CustomEase

**Step 4:** Split text yourself. Span-wrap each character/word/line before the timeline starts. Apply `gsap.set()` to set initial state, then `tl.to()` for the enter animation with stagger.

**For layout-aware effects** (`kinetic-center-build`, `short-slide-right`, `short-slide-down`): read `showcase.rendering_contract` and `showcase.renderer` in the effect JSON. These have custom layout algorithms that manage DOM position — not just stagger timing.

**Register CustomEase before using cubic-bezier strings:**

```js
gsap.registerPlugin(CustomEase);
const ease = CustomEase.create("custom", "cubic-bezier(0.22, 1, 0.36, 1)");
```

---

## In the Storyboard

Every text element in every beat must name an effect by ID. Not "headline fades in" — read the catalog, pick what fits the brand/mood/beat, and name the specific effect.

Format (these are format placeholders — the effect you choose should fit this specific brand and beat, not default to any particular ID):

```markdown
**Text Animations:**

- [element, e.g. "main headline"]: `[effect-id]` — skills/hyperframes/assets/text-effects/effects/[id].json
- [element, e.g. "eyebrow label"]: `[effect-id]` — skills/hyperframes/assets/text-effects/effects/[id].json
- [element, e.g. "body copy 3 lines"]: `[effect-id]` — skills/hyperframes/assets/text-effects/effects/[id].json
```

Sub-agents read the named JSON file and implement from `showcase.library_adapters.gsap` — no creative invention needed.
