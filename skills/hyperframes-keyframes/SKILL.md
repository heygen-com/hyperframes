---
name: hyperframes-keyframes
description: "See and edit GSAP motion as data in a HyperFrames composition. Run `npx hyperframes keyframes` to surface every tween's keyframes + an ASCII drawing of the path, so you reason about an element's MOTION over time — add/move/remove keyframes, refine a path, trace a shape (logo / glyph / icon), debug 'why does it move there', or read an animation before editing. Supports multi-stroke traces (pen-up gaps) for shapes with holes or detached parts. Use whenever the task is about where/when something travels; for authoring new scenes from scratch see hyperframes-animation, for the dev-loop CLI see hyperframes-cli."
---

# HyperFrames Keyframes

Editing motion by reading `keyframes: [{x:0},{x:-260}]` in source is guessing — you can't see the _shape_ a tween traces, only opaque numbers. `npx hyperframes keyframes` surfaces every GSAP tween, its keyframes (with absolute times), and an **ASCII drawing of the path** so you reason about motion visually, then edit precisely and verify by eye — all before you render.

This is **read-then-edit-source**, not a mutation command — it never changes files. Pair it with `inspect` (layout over the timeline) and `render` to ship. For the composition contract (the single paused timeline, `data-duration`, determinism) see `hyperframes-core`; to author motion from scratch see `hyperframes-animation`.

## The loop

1. **Surface** — `npx hyperframes keyframes [dir|file]` (defaults to `./index.html` + sub-compositions).
2. **Read** the path shape + keyframe list against your intent (add `--json` for exact data).
3. **Edit** the `keyframes` / `x`/`y` values in the composition `<script>`.
4. **Verify** — re-run `keyframes` to confirm the new shape; then `inspect` / `render`.

**Stop condition (don't thrash).** Iterate until the path is faithful AND another edit wouldn't clearly improve it — that's usually **≤5 rounds**, and **never more than ~8**. If you're tracing a known target (a logo, a glyph), keep it in view and re-check the path against it each round. If you pass ~5 rounds with no clear improvement, **stop and ask the user** whether it's good or worth continuing — more iterations reliably stop helping and can over-edit a good path. (Evidence: a 40-run budget grid {5/8/10/20} — every shape converged in ≤8 with the cap never binding; quality was flat across budgets while a bigger budget only added iterations and occasionally over-edited. So **8 is the hard ceiling, ~5 the soft target**.)

**Formula shortcut.** If the shape has a known parametric form (heart, ∞/lemniscate, star, spiral, circle), author it directly from the formula and verify **once** — don't iterate. The loop's value is for non-formula shapes (objects, glyphs, words, icons) where you can't compute the points.

```bash
npx hyperframes keyframes                      # whole project
npx hyperframes keyframes --selector '#hero'   # one element
npx hyperframes keyframes compositions/s2.html # one composition file
npx hyperframes keyframes --json               # machine-readable (agents)
npx hyperframes keyframes --shot path.png      # screenshot the real element + path overlay
```

**ASCII + screenshot = ground truth.** The ASCII grid is the cheap inline read, but it autoscales each axis so proportions lie (see gotchas). `--shot <png>` renders the composition headless, overlays the motion path on the **real element** in true aspect (each stroke its own colour, green start / red end dots, the element at its final pose), and saves a PNG you can open/read. For anything where shape fidelity matters — tracing a logo/glyph/icon, judging symmetry or proportion — author, then `--shot` and **look at the PNG** to verify against your target; it's the strongest self-check before render. Pair with `--selector` to shoot one element.

## Reading the output

```
#puck-b position  to/keyframes  @1s→4.4s (3.4s)
  0% {x:0 y:0}  33% {x:-180 y:-60}  67% {x:-320 y:40}  100% {x:-460 y:-20}
  ┌──────────────────────┐
  │              1·       │
  │            ··  ··     │
  │ 3·       ··      ·0   │
  │    ·· ·2·             │
  └──────────────────────┘
  x -460..0   y -60..40 (gsap px; marks 0..n = keyframe order)
```

The grid is the position path in GSAP **x/y offset** pixels (the element's translate from its CSS home; +x right, +y down). Marks `0,1,2,…` are keyframes in order. Full legend, scale caveats, and the `--json` schema: **`references/reading-the-surface.md`** — read it before trusting proportions (the grid autoscales each axis, so aspect can read distorted).

## Multi-stroke / pen-up (shapes with gaps)

A single element can trace a shape in **multiple strokes** with pen-up gaps between them — needed for anything with holes or detached parts (a `?`'s dot, an icon counter, separate letters/digits) where one continuous line would draw a wrong connector.

**Convention: each stroke is its own position tween; a 0-duration `set()` between them is the pen-up jump.** The command composites an element's strokes into one shared-scale trace and **does not draw across the gaps**:

```js
tl.to("#pen", {
  keyframes: { "0%": { x: -100, y: -150 }, "100%": { x: 80, y: -120 } },
  duration: 1,
}); // stroke 1
tl.set("#pen", { x: 80, y: 120 }); // pen up → jump
tl.to("#pen", { keyframes: { "0%": { x: 80, y: 120 }, "100%": { x: 85, y: 140 } }, duration: 0.5 }); // stroke 2
```

Full pattern (words, icons, holed glyphs, how it surfaces, and the single-stroke fallback): **`references/multi-stroke.md`**.

## Editing keyframes

Percentages are **tween-relative**; edits go in the composition `<script>`. Move = change `x`/`y` at that `%`; add = insert a new `"P%": { x, y }` keeping ascending order; remove = delete the `"P%"` entry; retime = change `duration` / position. Object-form, offset math, and converting a flat `to(x)` into keyframes: **`references/editing-keyframes.md`**.

```js
tl.to(
  "#hero",
  {
    keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 120, y: -80 }, "100%": { x: 240, y: 0 } },
    duration: 2,
    ease: "power1.inOut",
  },
  1.0,
);
```

## Routing

| Want to…                                                | Read                                |
| ------------------------------------------------------- | ----------------------------------- |
| Understand the ASCII grid, marks, scale, `--json` shape | `references/reading-the-surface.md` |
| Trace a shape with holes / gaps / separate letters      | `references/multi-stroke.md`        |
| Add / move / remove / retime keyframes in source        | `references/editing-keyframes.md`   |
| Avoid the common failure modes                          | `references/gotchas.md`             |
| Author brand-new motion / pick a rule or blueprint      | `hyperframes-animation`             |
| Run `lint` / `inspect` / `preview` / `render`           | `hyperframes-cli`                   |

## Gotchas (full list: `references/gotchas.md`)

- **x/y are offsets, not absolute canvas coords.** `{x:0,y:0}` = the element's CSS layout spot; values are deltas from there.
- **The ASCII autoscales per axis** — a tall-narrow shape can render wide-flat. Trust the printed `x …` / `y …` ranges over the visual aspect; use the real coords.
- **One continuous line can't do holes** — if you see a wrong connector across a gap, you want multi-stroke (above), not more keyframes.
- **Studio holds are filtered.** A `set("#el", { …, data: "hf-hold" })` is an internal position-hold the Studio injects — never author or edit it by hand.
- **Dynamic tweens** (computed selectors / data-driven keyframes) can't be statically resolved and surface with fewer details; author literal `keyframes: {…}` when you want them editable.

## Boundaries

- GSAP only. Lottie / Three.js / CSS / WAAPI motion does **not** surface here — see the relevant `hyperframes-animation` adapter.
- It reads and draws; it never writes. All edits are yours to make in source, then re-run to verify.
- Don't restate `hyperframes-core` rules (single paused timeline, determinism) — they still apply.
