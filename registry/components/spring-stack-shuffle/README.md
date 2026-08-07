# spring-stack-shuffle

A stack of 3 to 5 cards reshuffles on cues: on each cue the card at the back
throws over the top of the stack and lands at the front with real mass (one
small sanctioned landing overshoot, quiet register), while the other cards
step one slot deeper and take a brief compress-resettle as the flyer lands.
An accent ring rides the active (front) card across every shuffle.

The signature is law L1, interruptible springs: when a cue fires while a
previous shuffle is still in flight, every moving card redirects to its new
slot from its current position at its current velocity. No snap-to-zero, no
pop. The default cue rhythm (`0.9, 1.7, 1.95`) fires its third cue mid-throw
of the second on purpose, so the redirect is part of the authored default
choreography.

The redirect is not a physics simulation: motion compiles at mount into
per-card segment lists (explicit endpoints, pure ease functions). A cue that
interrupts a segment cuts it analytically (value from the ease curve,
velocity from a fixed finite difference) and continues with a Hermite ease
whose start slope equals the cut velocity. Every emitted tween is a `fromTo`
with both endpoints authored, so seeks in either direction always reproduce
the same frame.

## Files

- `spring-stack-shuffle.html`: the mountable sub-composition (install target:
  `compositions/components/spring-stack-shuffle.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: standalone 1920x1080 host mounting the primitive with
  non-default variables.

## Variables

| id       | type   | default          | notes                                                                     |
| -------- | ------ | ---------------- | ------------------------------------------------------------------------- |
| `cards`  | number | `4`              | stack size, clamped to 3..5                                               |
| `cues`   | string | `0.9, 1.7, 1.95` | comma seconds from mount start, one shuffle per cue; empty keeps default  |
| `accent` | enum   | `green`          | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`   | enum   | `none`           | `none` holds the settled stack; `fade` and `up` release the stage         |

Cues are clamped into `[0.85, D - exit - 0.9]` so every throw lands before an
exit begins. Cues closer together than a throw (0.85s) interrupt the flight;
that is the point, not an error. Envelope: staggered entrances finish by
~0.8s, HOLD is the only elastic phase, OUT is 0.45s only when `exit` is
`fade` or `up`.

## The slot mechanism

The primitive ships five named slot panels inside its `<template>`, one per
card, front to back at mount:

```html
<div class="sss-slot" data-slot="card-1"> ... </div>
...
<div class="sss-slot" data-slot="card-5"> ... </div>
```

Each slot's default children are a numbered token skeleton card, so an
untouched mount still reads as a tasteful shuffle. To show your own content,
install the component and **replace the children of each `[data-slot]`
element in your installed copy** (the runtime clones only the primitive's own
template on mount, so slot content lives in the component file, not on the
host clip). Slots beyond the `cards` count are removed at mount.

Rules:

- Direct `img`/`video` children are automatically sized to cover the card
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- Leave the `.sss-veil` and `.sss-ring` siblings alone; they are the
  timeline-driven depth dim and active ring.

## Worked example

Install, then fill the slots with three screens and shuffle between them:

```bash
npx hyperframes add spring-stack-shuffle
```

In `compositions/components/spring-stack-shuffle.html`, replace each slot's
default block:

```html
<div class="sss-slot" data-slot="card-1">
  <img src="../../assets/screen-dashboard.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="spring-stack-shuffle"
  data-composition-src="./components/spring-stack-shuffle.html"
  data-variable-values='{"cards":3,"cues":"1.0, 1.9","accent":"blue"}'
  data-start="2"
  data-duration="4"
  data-track-index="0"
></div>
```

Two shuffles fire at 1.0s and 1.9s after mount; the second lands just as the
first settles. Bring the cues within 0.85s of each other to see the L1
redirect: the in-flight card bends to its new slot without ever stopping.
