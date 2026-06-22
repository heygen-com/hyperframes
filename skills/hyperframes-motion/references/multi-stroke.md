# Multi-stroke traces (pen-up / pen-down)

One element, drawn in **several disconnected strokes**. Use it for any shape where a single continuous line would draw a connector that shouldn't exist:

- a **`?`** (hook + a separate dot below)
- a **counter / hole** (the bar gaps in an icon, the eye of an `e`)
- **separate letters or digits** ("hi", "2026") without a trailing line linking them
- a **detached part** (a logo's separate leaf, a dot over an `i`/`j`)

## The convention

**Each stroke is its own position tween. A 0-duration `set()` between strokes is the pen-up jump.**

```js
const tl = gsap.timeline({ paused: true });

// stroke 1 — the hook
tl.to("#pen", {
  keyframes: { "0%": { x: -100, y: -150 }, "50%": { x: 0, y: -220 }, "100%": { x: 80, y: -120 } },
  duration: 1.5,
});

// pen up — jump to where the next stroke starts (instant, not drawn)
tl.set("#pen", { x: 80, y: 120 });

// stroke 2 — the dot
tl.to("#pen", { keyframes: { "0%": { x: 80, y: 120 }, "100%": { x: 85, y: 140 } }, duration: 0.5 });

window.__timelines = [tl];
```

The `set()` is optional but recommended — it makes the jump explicit and keeps each stroke's `0%` at its true start. Strokes are ordered by their timeline start.

## How it surfaces

The command **groups an element's strokes into one trace**, listing each stroke's keyframes:

```
#pen position  trace  2 strokes @0s→2s
  stroke 1: 0% {x:-100 y:-150}  50% {x:0 y:-220}  100% {x:80 y:-120}
  stroke 2: 0% {x:80 y:120}  100% {x:85 y:140}
```

In `--json` the strokes appear under `traces[].strokes` (and, additively, as normal entries in `tweens`). To see the shape, `--shot` draws each stroke separately and **never connects across the pen-up gap** — no false connector.

## Rules & tips

- **A trace appears only with ≥2 drawn strokes on one element.** A single stroke keeps the normal per-tween output.
- **The `set()` pen-up is hidden** from the human view (it's the jump, not a drawn segment) — don't be surprised it's not its own block.
- **Order = timeline order.** Strokes draw in the order their tweens start; lay them left-to-right / first-to-last accordingly.
- **Each stroke is listed separately** (`stroke 1:`, `stroke 2:` …) in timeline order.
- **Keep each stroke simple.** Holes and detached bits are separate strokes — don't try to snake one line through them.

## Words and icons

For multi-letter words, make each letter (or each pen-down run within a letter) a stroke, with a `set()` jump to the next letter's start. For icons with a counter (a ring around a mark), the outer ring is one stroke and the inner mark another.

## Scope note — visible drawn trail

This surfaces and authors multi-stroke **motion**: the element moves through the strokes and teleports across gaps. Rendering a _persistent drawn line that itself has gaps_ (a self-drawing trace) is a separate effect, not part of this command. If you need the gaps visible in the final render, drive a stroke/trail effect from the same keyframes — ask for that explicitly.
