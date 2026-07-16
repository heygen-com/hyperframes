# radial-surround

Labeled hairline chips assemble around a centered subject on an elliptical
ring: positions baked once via cos/sin, staggered smooth-settle entries. With
`close_in` (the default) the chips then converge inward toward the subject
while a subtle edge vignette dims the stage. The center NEVER moves: the
subject is surrounded, not zoomed. The classic problem-setup beat ("your team,
buried under tools").

## Files

- `radial-surround.html`: the mountable sub-composition (install target:
  `compositions/components/radial-surround.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 host that mounts the primitive with non-default
  variables through `data-composition-src`.

## Variables

| id             | type    | default                                | notes                                                                     |
| -------------- | ------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `center_label` | string  | `Your team`                            | label on the default center token card                                    |
| `chips`        | string  | `Docs,Tickets,Dashboards,Inbox,Chat,Sheets` | comma list of chip labels; up to 12 render                           |
| `close_in`     | boolean | `true`                                 | converge the ring inward with the edge dim; `false` holds the wide ring   |
| `cues`         | string  | `""`                                   | comma-separated per-chip entrance seconds; blank entries use the cascade  |
| `accent`       | enum    | `green`                                | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`         | enum    | `none`                                 | `none` holds the final frame; `fade` and `up` release the stage           |

Envelope: IN = center settle + chip cascade (+ close-in when enabled; the
converge lands at 4.50s at defaults), HOLD is the sole elastic phase (dead
still), OUT = up to 0.45s only when `exit` is `fade` or `up`. Sync points:
`ring-assembled` at 2.95s, `surround-closed` at 4.50s (defaults). Cue values
are clamped so every chip lands before the close-in (or the exit) begins.

## The slot mechanism

The primitive ships one named slot for the center subject inside its
`<template>`:

```html
<div class="rs-center" data-slot="center"> ... </div>
```

The slot is empty by default: the script generates a token card carrying
`center_label`, so an untouched mount still reads as a tasteful setup. To
show your own subject, install the component and **place children inside the
`[data-slot="center"]` element in your installed copy** (the runtime clones
only the primitive's own template on mount, so slot content lives in the
component file, not on the host clip). When the slot already has children the
default card is skipped; chips, cues, `close_in`, and `exit` still apply.

Rules:

- Direct `img`/`video` children are capped at 34cqw x 30cqh with
  `object-fit: cover` and the contract radius. Arbitrary HTML works too; size
  it in `cqw`/`cqh` and keep it inside roughly 34cqw x 30cqh so the close-in
  ring (20cqw x 23cqh radii) clears it.
- The center only fades and settles on entrance; it never translates. Do not
  animate the slot content yourself: the surrounding choreography assumes a
  still subject.
- Leave the chips and vignette alone; they render above the center layer.

## Worked example

Install, then point the center at a product shot:

```bash
npx hyperframes add radial-surround
```

In `compositions/components/radial-surround.html`, fill the slot:

```html
<div class="rs-center" data-slot="center">
  <img src="../../assets/team-photo.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="radial-surround"
  data-composition-src="./components/radial-surround.html"
  data-variable-values='{"chips":"Slack,Email,CRM,Tickets,Docs","close_in":true,"accent":"blue"}'
  data-start="2"
  data-duration="5"
  data-track-index="0"
></div>
```

Chips pop in around the photo on alternating compass points, close in at
~3.3s, and the crowded frame holds still for the rest of the clip window
(`exit` defaults to `none`; frame roots own scene transitions).
