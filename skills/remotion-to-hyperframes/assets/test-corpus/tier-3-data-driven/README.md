# Tier 3 — stargazed-data-driven

## What it tests

A purpose-built data-driven fixture that exercises the realistic shape of a
production Remotion composition without using the runtime adapter from
PR #214. If a translation passes T3, the skill correctly handles:

- A `<Composition>` with a `z.object` schema and typed `defaultProps`
- Custom React subcomponents reused with different props across scenes
- A nested data structure (`stats[]`) materialized as repeated HTML with
  per-instance attributes
- A frame-driven count-up animation (`AnimatedNumber` → GSAP `onUpdate`)
- Two different `spring` configs translated to two different `back.out` overshoots
- Per-instance delays via component props (`delayInFrames` → GSAP timeline offsets)

## Composition shape

```
Stargazed (10 s @ 30 fps, 1280×720)
├── Sequence 0–3 s   TitleScene
│                    ├── title  ← spring scale
│                    └── subtitle ← linear fade
├── Sequence 3–7 s   StatsScene
│                    ├── StatCard "Stars" 1247 #fbbf24 (delay 0 frames)
│                    ├── StatCard "Forks" 312 #60a5fa  (delay 12 frames)
│                    └── StatCard "Issues" 48 #f87171  (delay 24 frames)
└── Sequence 7–10 s  OutroScene
                     └── UnderlinedText "thanks for watching" ← scale-in underline
```

Each `StatCard` is a custom subcomponent that internally uses `AnimatedNumber`
to count from 0 to the target. `AnimatedNumber` itself derives the displayed
value from `useCurrentFrame()` + a manual `1 - (1 - t)^3` ease.

## The lossy parts (and why threshold = 0.90)

1. **`spring → back.out(N)`**: two different spring configs in this composition.
   - `{ damping: 12, stiffness: 100, mass: 1 }` (title) → `back.out(1.4)`
   - `{ damping: 14, stiffness: 90, mass: 1 }` (stat card) → `back.out(1.2)`

   Overshoot ratio (1.4 vs 1.2) approximates the damping difference. The
   late-tail curve of GSAP's back ease and Remotion's spring don't match
   exactly — costs ~0.03 mean SSIM per spring instance.

2. **Count-up easing**: `AnimatedNumber` uses `1 - (1 - t)^3` (cubic ease-out)
   manually computed in the component. GSAP's `power2.out` matches that cubic curve
   exactly (`power3.out` is quartic). Compare the rounded integers at matching
   frame times in both renderers; matching final values alone does not validate
   the easing curve.

3. **Font rendering**: same caveat as T1/T2. System Helvetica/Arial fallback
   produces minor anti-aliasing differences between renderers. Affects the
   stat card numbers (large weight 800) most.

A mean SSIM below 0.90 in T3 indicates a _structural_ mismatch (wrong scene
durations, wrong stagger timing, missing prop wiring), not approximation
drift. That's the failure signal we care about. The September 18 measurement
against Remotion @ 4.0 with PNG/BT.709 output was 0.953 for the quartic
translation; it does not measure the corrected cubic count-up.

## Translation walk-through (skill cheat sheet)

| Remotion                                                                    | HyperFrames                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `<Composition schema={z.object({...})} defaultProps={...} />`               | data-\* attributes on root `#stage` div                                               |
| nested array prop (`stats[]`)                                               | repeated HTML markup with per-instance `data-*` attrs                                 |
| custom React subcomponent                                                   | inline repeated HTML using the component's prop interface as the template             |
| `<AnimatedNumber from={0} to={value} dur={45} />` (cubic ease-out count-up) | tween on `{ v: 0 }` object with `onUpdate` rewriting `textContent`, ease `power2.out` |
| `spring({damping:12, stiffness:100})`                                       | `back.out(1.4)` over ~0.7 s                                                           |
| `spring({damping:14, stiffness:90})`                                        | `back.out(1.2)` over ~0.7 s                                                           |
| `delayInFrames={i * 12}` (per-instance)                                     | GSAP timeline offset `(i * 0.4)` s                                                    |
| `useVideoConfig()` to get `fps`                                             | dropped — composition fps is in `data-fps` on `#stage`                                |

## How to render and evaluate

```bash
# Render Remotion baseline (no setup.sh — no binary assets in this fixture)
cd remotion-src && npm install && npm run render

# Render HyperFrames translation
cd ../hf-src && npx hyperframes render --output ../hf.mp4

# Compare
npx hyperframes diff ../remotion-src/out/baseline.mp4 ../hf.mp4 --out ../diff
```
