# split-tilt-cards

Two equal-weight cards arrive from opposite wings, each carrying a mirrored
3D rotateY book-open tilt (+18deg left, -18deg right) under one shared stage
perspective, with soft box-shadows falling outward from the tilt. A pill
badge spring-pops at each card's inner edge (left first, right ~0.3s behind:
the one sanctioned overshoot, kept small), then the pair holds with a
barely-there phase-opposed idle float and settles dead still. The eye reads
the two cards as a balanced comparison: an A/B, a before/after, two
complementary capabilities weighed simultaneously.

This realizes the comparison-split blueprint's signature move as its own
unit. Not for more than 2 items (use `grid-card-assemble`) or sequential
steps. For a divider that wipes one state over another, use
`before-after-wipe`.

## Files

- `split-tilt-cards.html`: the mountable sub-composition (install target:
  `compositions/components/split-tilt-cards.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 standalone host that mounts the primitive with
  non-default variables.

## Variables

| id        | type   | default  | notes                                                                     |
| --------- | ------ | -------- | ------------------------------------------------------------------------- |
| `label_a` | string | `Before` | mono header on the left card; empty string hides it                       |
| `label_b` | string | `After`  | mono header on the right card; empty string hides it                      |
| `badge_a` | string | `v1`     | inner-edge pill on the left card; empty string disables that pop          |
| `badge_b` | string | `v2`     | inner-edge pill on the right card; empty string disables that pop         |
| `accent`  | enum   | `green`  | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`    | enum   | `none`   | `none` holds the final spread; `fade` and `up` release the stage          |

Envelope: IN = 2.15s (left card lands 0 to 1.1s, right 0.2 to 1.3s, badge A
pops at 1.45s, badge B at 1.75s), OUT = 0.5s only when `exit` is `fade` or
`up`, HOLD is the sole elastic phase. During HOLD the two cards run whole
2.0s phase-opposed float cycles (left dips as right rises, every cycle starts
and ends at rest) and always finish with a 0.3s dead-still window. Sync
points: `badge-pop-a` at 1.85s and `badge-pop-b` at 2.15s (`hf:sfx` id
`badge-pop-soft` fires at each landing).

## The slot mechanism

The primitive ships two named slot panels inside its `<template>`:

```html
<div class="stc-slot" data-slot="card-a"> ... </div>
<div class="stc-slot" data-slot="card-b"> ... </div>
```

Each slot's default children are a token-styled wireframe (muted on the left
card, accent-tinted on the right), so an untouched mount still reads as a
tasteful comparison. To show your own content, install the component and
**replace the children of each `[data-slot]` element in your installed
copy** (the runtime clones only the primitive's own template on mount, so
slot content lives in the component file, not on the host clip).

Rules:

- Direct `img`/`video` children are automatically sized to cover the slot
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- Keep the label headers and badge pills alone; they render outside the
  slots and ride the same tilt and float as the card.
- The tilt is carried by the card, so slot content tilts with it; keep
  content readable at 18 degrees (avoid dense small text).

## Worked example

Install, then fill the slots with two screenshots:

```bash
npx hyperframes add split-tilt-cards
```

In `compositions/components/split-tilt-cards.html`, replace each slot's
default block:

```html
<div class="stc-slot" data-slot="card-a">
  <img src="../../assets/plan-free.png" alt="" />
</div>
...
<div class="stc-slot" data-slot="card-b">
  <img src="../../assets/plan-pro.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="split-tilt-cards"
  data-composition-src="./components/split-tilt-cards.html"
  data-variable-values='{"label_a":"Free","label_b":"Pro","badge_a":"$0","badge_b":"$29","accent":"violet"}'
  data-start="2"
  data-duration="5"
  data-track-index="0"
></div>
```

The cards land 1.3s after the clip mounts, the badges punctuate by 2.15s,
and the spread holds with a barely-there float for the rest of the clip
window (`exit` defaults to `none`; frame roots own scene transitions).
