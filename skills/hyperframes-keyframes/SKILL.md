---
name: hyperframes-keyframes
description: "See and edit GSAP motion as data in a HyperFrames composition. Run `npx hyperframes keyframes` to surface every tween's keyframes, then `--shot` to render a true-3D onion-skin of the real element, so you reason about an element's MOTION over time — add/move/remove keyframes, refine a path, trace a shape (logo / glyph / icon), tune a 3D flip/tumble, debug 'why does it move there', or read an animation before editing. Supports multi-stroke traces (pen-up gaps) for shapes with holes or detached parts. Use whenever the task is about where/when/how something moves; for authoring new scenes from scratch see hyperframes-animation, for the dev-loop CLI see hyperframes-cli."
---

# HyperFrames Keyframes

Editing motion by reading `keyframes: [{x:0},{x:-260}]` in source is guessing — the numbers don't show the _shape_, the timing, or what rotation/scale/3D actually look like. `npx hyperframes keyframes` surfaces every GSAP tween and its keyframes (with absolute times) as editable data; then `--shot` renders a **true-3D onion-skin of the real element** so you verify the motion by eye — all before you render.

This is **read-then-edit-source**, not a mutation command — it never changes files. Pair it with `inspect` (layout over the timeline) and `render` to ship. For the composition contract (the single paused timeline, `data-duration`, determinism) see `hyperframes-core`; to author motion from scratch see `hyperframes-animation`.

## The loop

1. **Surface** — `npx hyperframes keyframes [dir|file]` (defaults to `./index.html` + sub-compositions).
2. **Read** the keyframe list against your intent (add `--json` for exact data).
3. **Edit** the `keyframes` / property values in the composition `<script>`.
4. **Verify** — `keyframes --shot out.png` renders the motion; check it by eye, then `inspect` / `render`.

**Stop condition (don't thrash).** Iterate until faithful and another edit wouldn't clearly help — usually **≤5 rounds, never more than ~8** (a 40-run grid showed quality flat past ~5; extra rounds just over-edit). Tracing a known target? Keep it in view and re-check each round. Past ~5 with no clear gain, **stop and ask the user**.

**Formula shortcut.** If the shape has a known parametric form (heart, ∞/lemniscate, star, spiral, circle), author it directly from the formula and verify **once** — don't iterate. The loop's value is for non-formula shapes (objects, glyphs, words, icons) where you can't compute the points.

```bash
npx hyperframes keyframes                      # whole project
npx hyperframes keyframes --selector '#hero'   # one element
npx hyperframes keyframes compositions/s2.html # one composition file
npx hyperframes keyframes --json               # machine-readable (agents)
npx hyperframes keyframes --shot path.png      # onion-skin screenshot (3D, all channels)
```

**The shot is ground truth.** Numbers say what you wrote; `--shot <png>` shows what it does. It seeks the **live timeline** at N steps and renders the **real element** at each — true-3D ghosts (foreshortened/edge-on for rotationX/Y/Z + z, sized by scale, filled with its colour, faded by opacity; path coloured by time, ghost spacing = velocity). It reads what actually rendered, so it catches eased / dynamic / 3D motion the numbers hide. Works on **any** animated element. Author → `--shot` → open the PNG → check against your target, before render.

**Frame what you're editing.** A head-on render lies twice — in-place motion collapses to a dot, 3D to a flat stack. Pick the framing:

| Want to…                                                               | Flag                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| make a small / centred motion legible (default on)                     | _(zoom-to-fit; `--no-fit` to disable)_              |
| separate **in-place / overlapping** ghosts (a pulse, an in-place flip) | `--layout strip` (filmstrip, one cell per keyframe) |
| inspect **one phase** densely (e.g. a single bounce)                   | `--from 2.0 --to 3.0`                               |
| reveal **3D** that's ambiguous head-on (flips, tumbles)                | `--angle top` · `side` · `iso` · `yaw,pitch`        |
| change sample count · focus one element                                | `--samples 13` · `--selector '#hero'`               |

**For any 3D motion (rotationX/Y/Z or z), render at least THREE camera angles before you trust it** — e.g. `front` + `top` + `side` (or `iso`). One viewpoint hides depth: a flip reads as a static stack head-on, a tumble looks flat, an edge-on pose vanishes. Confirm the motion matches your intent in **all three** (a vertical-axis flip reads from `top`, a horizontal-axis flip from `side`, a general tumble from `iso`). For **in-place / overlapping** motion (a pulse, an in-place flip) the head-on render stacks every ghost on one spot — switch to `--layout strip` so each keyframe gets its own cell. Zoom-to-fit is on by default.

## Reading the output

```
#hero position  to/keyframes  @1s→4.4s (3.4s)
  0% {x:0 y:0}  33% {x:-180 y:-60}  67% {x:-320 y:40}  100% {x:-460 y:-20}
```

Each line is a tween — target, property group, method/shape, timing — then its keyframes as `pct% {props}`. x/y are GSAP **offset** pixels (the element's translate from its CSS home; +x right, +y down); rotation / scale / opacity / colour show too when animated. That's the data you edit. To _see_ the motion (shape, timing, 3D), use `--shot` (above). Full `--json` schema: **`references/reading-the-surface.md`**.

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

## Layered motion: nest elements (don't fight last-write-wins)

GSAP is **last-write-wins per element + property**: two tweens animating the same element's `y` (or `rotation`, or `scale`) clobber each other, so you can't cleanly layer independent motions onto one element. When the brief has channels that are **independent in phase or rate** — an orbit AND an axial spin at a different rate, a flight path AND a wing-flap, a bounce AND a roll, a trajectory AND a wobble/bob — put them on **nested elements**:

- **parent** carries the primary trajectory (the path: `x`/`y`/`z`, the orbit),
- **child** carries the secondary, independent motion (a bob on its own `y`, a flap on `scaleX`, an axial spin on `rotation`, a wobble on `rotationZ`).

```js
tl.to("#group", {
  keyframes: { "0%": { x: -380, y: 0 }, "100%": { x: 380, y: 0 } },
  duration: 4,
  ease: "none",
}); // parent: path
tl.to(
  "#core",
  {
    keyframes: { "0%": { y: 0 }, "50%": { y: -40 }, "100%": { y: 0 } },
    duration: 4,
    ease: "sine.inOut",
  },
  0,
); // child: independent bob
```

The child's rendered position is the **composition** of both, so `--shot --selector '#core'` (the leaf) shows the combined motion — the corner markers inherit the full ancestor transform, and the orbit camera handles the chain. Use nesting whenever cramming everything into one tween would force you to trade one channel for another. For motion that genuinely derives from a **single parameter** (a parametric path), one keyframes block is correct — reach for nesting only when channels would otherwise collide.

The text surface shows it too: a nested element's block prints `↑ composed with #group: x −360..360, y −100..100, …` (the ancestor's motion **extent**, so a closed loop isn't hidden as `0→0`). Don't conclude "no path" from a child's own tween — read the `↑ composed with` line (or the `--shot`).

### Patterns that separate a 9 from a 5

These are the layered-motion mistakes that look fine in the numbers and fail on screen:

- **A fast channel needs its own dense tween.** A wing-flap, shimmer, or rotor wobble at "many cycles" can't share the path's coarse keyframe grid (you'll get ~12 lazy cycles, not rapid). Put the high-frequency channel on its **own** tween/child with enough stops (or a short `repeat`), decoupled from the path.
- **Squash stays flat to the ground — even while spinning.** If an element both rolls/spins **and** squashes on impact, they fight on one element: the squash rotates with the spin and skews off-axis. Split them — **spin on an inner child, squash (scaleX/scaleY) on an outer wrapper** that doesn't rotate — so the squash stays aligned to the floor.
- **"Points along travel" = the path tangent.** For heading/banking that follows the path, derive the rotation from the **velocity direction** (`atan2(Δy, Δx)` between keyframes), not an eyeballed linear ramp — and remember `#hero`'s notch points **up** at `0°`, so add the offset that maps `0°` to your travel convention.
- **Lock coupled phases.** If a spin should track the orbit (or a flip the bounce), derive both from the **same parameter** so they don't drift; if they're meant to be independent, give them clearly different rates.
- **Verify every named channel.** Before stopping, check each channel in the brief against the render one by one — a layered motion fails by dropping _one_ channel (the bob, the bank), not by getting the headline path wrong.
- **Deliver the channel that's named, at a magnitude that reads — don't substitute.** "Rotate-in" means real `rotation` (±90° or more), not a vertical offset that approximates it; "overshoot" means actually passing the target and easing back (`back.out`), not just arriving. A subtle stand-in reads as the wrong channel. After authoring, confirm the named thing is _visibly_ that thing (rotation looks like rotation).
- **Make fast or chaotic motion legible — add a trail.** A whip, a chaotic pendulum, a fast orbit reads as a blur or a jumble in any single moment (and in the played clip). Lay down a faint **motion trail / echo** — a fading path, or a few ghost copies along the element's recent positions — so the path itself reads. Confirm it in `--shot`.
- **Match the target's complexity — don't over-interpret.** More channels is not more faithful. A simple steady spin is a constant-gap rotation — do **not** add arc-length oscillation, a wobble, a pulse, or a secondary phase the target doesn't show. When reproducing a reference, the highest score comes from the **same channels at the same simplicity**, not from embellishment; invented detail reads as _wrong_, not richer. (This is the #1 way a careful build loses to a plain one.)

## Reproducing a motion from a reference (one-shot)

With a reference in hand (a clip, a filmstrip, an animated icon) you can usually nail it in **one pass** — the skill is to **decompose before you author**, not guess-then-thrash:

1. **List the moving parts** — what moves independently (the two bell strokes; track + knob; each digit reel). Each is an element/tween.
2. **Name each part's channels** from the frames — position path, rotation, scale, opacity, colour, SVG shape — reading the start pose, end pose, and key in-betweens.
3. **Read timing off the frames.** They're time-ordered: frame `i` of `N` sits at `t = i/(N−1) × duration`. Even spacing = linear; bunched frames = slow there (ease). Note sequence and stagger — what leads, what lags.
4. **Map to literal keyframes** at the `%` those poses fall on, with enough stops to trace the curve and the easing the spacing implies.
5. **Author once, then confirm** with a single `--shot`/render laid next to the reference. A clean decomposition lands first try; if one channel is off it's almost always one you mis-read in step 2 — fix that one, don't restart.

The reference is ground truth for the **target**, the way `--shot` is ground truth for your **output**. Read both; never reason from memory of "what a bell does".

**Author only what you saw.** Reproduce the channels actually present in the reference and stop — resist "improving" it. If the reference is a plain steady spin, ship a plain steady spin. Over-reading a simple motion (adding a pulse, an oscillation, an extra easing phase) is the most common one-shot failure: it loses to the naive build that just matched the reference.

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

| Want to…                                           | Read                                |
| -------------------------------------------------- | ----------------------------------- |
| Understand the keyframe surface + `--json` shape   | `references/reading-the-surface.md` |
| Trace a shape with holes / gaps / separate letters | `references/multi-stroke.md`        |
| Add / move / remove / retime keyframes in source   | `references/editing-keyframes.md`   |
| Avoid the common failure modes                     | `references/gotchas.md`             |
| Author brand-new motion / pick a rule or blueprint | `hyperframes-animation`             |
| Run `lint` / `inspect` / `preview` / `render`      | `hyperframes-cli`                   |

## Gotchas (full list: `references/gotchas.md`)

- **x/y are offsets, not absolute canvas coords.** `{x:0,y:0}` = the element's CSS layout spot; values are deltas from there.
- **Head-on `--shot` can mislead** — in-place motion stacks on one spot and 3D flattens; reach for `--layout strip`, `--from/--to`, or `--angle` (above) to frame what you're editing.
- **One continuous line can't do holes** — if you see a wrong connector across a gap, you want multi-stroke (above), not more keyframes.
- **Studio holds are filtered.** A `set("#el", { …, data: "hf-hold" })` is an internal position-hold the Studio injects — never author or edit it by hand.
- **Dynamic tweens** (computed selectors / data-driven keyframes) can't be statically resolved and surface with fewer details; author literal `keyframes: {…}` when you want them editable.

## Boundaries

- GSAP only. Lottie / Three.js / CSS / WAAPI motion does **not** surface here — see the relevant `hyperframes-animation` adapter.
- It reads and screenshots; it never writes. All edits are yours to make in source, then `--shot` to verify.
- Don't restate `hyperframes-core` rules (single paused timeline, determinism) — they still apply.
