---
name: hyperframes-keyframes
description: Read and edit GSAP keyframes and motion paths in a HyperFrames composition. Use whenever a task involves an element's MOTION over time — adding/removing/moving keyframes, refining a motion path, changing where or when something travels, debugging "why does it move there", or understanding an existing animation before editing it. Run `npx hyperframes keyframes` to surface every tween's keyframes + an ASCII motion-path so you can see and edit motion as data instead of guessing at raw numbers.
---

# HyperFrames Keyframes

Editing motion by reading `keyframes: [{x:0},{x:-260}]` in source is guessing — you can't see the _shape_ a tween traces, only opaque numbers. `npx hyperframes keyframes` surfaces every GSAP tween, its keyframes (with absolute times), and an **ASCII motion-path drawing** so you can reason about motion, then edit precisely and verify.

## The loop

1. **Surface** — `npx hyperframes keyframes [dir|file]` (defaults to `./index.html` + sub-compositions).
2. **Read** the path shape + keyframe list (or `--json` for exact data).
3. **Edit** the `keyframes` / `x`/`y` values in the composition source.
4. **Verify** — re-run `npx hyperframes keyframes` to confirm the new shape, then `npx hyperframes inspect` / `render`.

```bash
npx hyperframes keyframes                      # whole project
npx hyperframes keyframes --selector '#hero'   # one element
npx hyperframes keyframes compositions/s2.html # one composition file
npx hyperframes keyframes --json               # machine-readable (agents)
```

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

- **`to/keyframes`** = method (`to`/`from`/`fromTo`/`set`) + shape (`keyframes` multi-stop, `flat` 2-point, `motionPath` arc).
- **`@1s→4.4s`** = absolute timeline window; each `%` is **tween-relative** (0 % = tween start, 100 % = tween end).
- **Keyframe line** = every stop with its properties.
- **ASCII grid** = the position path in GSAP **x/y offset** pixels (the element's translate from its layout home; +x right, +y down). Marks `0,1,2,…` are keyframes in order; on dense gesture paths only `S`→`E` are marked and the path is traced with `·`.
- `--json` gives exact `{ pct, time, properties }` per keyframe + the raw `path` points — use it when you need to compute edits.

## Editing keyframes (in source)

Percentages are **tween-relative**, and edits go in the composition's `<script>`:

- **Move a keyframe** — change its `x`/`y` (or any prop) at that `%`.
- **Add a keyframe** — insert a new `"P%": { x, y }` entry (object form) keeping ascending order; convert a flat `to("#el", { x })` to `to("#el", { keyframes: { "0%": {x:0}, "100%": {x} } })` first if needed.
- **Remove a keyframe** — delete its `"P%"` entry; if fewer than two remain, collapse back to a flat tween.
- **Retime** — change the tween's `duration` / position argument (the `@start` shifts; the `%`s stay).

```js
// object-form keyframes (each value is the element's gsap x/y OFFSET from its CSS layout position)
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

After any edit, re-run `npx hyperframes keyframes --selector '#hero'` — the new ASCII path is your confirmation the motion matches intent before you render.

## Gotchas

- **x/y are offsets, not absolute canvas coords.** `{x:0,y:0}` = the element's CSS layout spot; values are deltas from there.
- **Studio holds.** A `set("#el", { …, data: "hf-hold" })` is an internal position-hold the Studio injects before a position tween — it's filtered from the surface; don't author or edit it by hand.
- **Dynamic tweens** (computed selectors / data-driven keyframes) can't be statically resolved; they show with fewer details. Author literal `keyframes: {…}` when you want them editable.
- This is **read-then-edit-source**, not a mutation command — it never changes files. Pair it with `inspect` (layout/overflow over the timeline) and `render` to ship.
