# telemetry-hud

Quiet mono debug-HUD readouts frame a slotted subject. Four corner brackets
draw on, small `label: value` data lines fade in around the frame, and each
value ticks to its final string on its cue (unresolved characters roll through
same-class stand-ins and resolve left to right, the typed-prompt text-at-time
law). One readout is emphasized in the accent color. The subject never moves
and the HUD breathes zero: once the last tick lands, the hold is dead still.

## Files

- `telemetry-hud.html`: the mountable sub-composition (install target:
  `compositions/components/telemetry-hud.html`).
- `registry-item.json`: registry metadata and the variables block.

## Variables

| id          | type   | default                                      | notes                                                                     |
| ----------- | ------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| `readouts`  | string | `fps:59.94,latency:11.8 ms,gpu:38%,heap:1.2 GB` | comma-separated `label:value` pairs, up to 8; first colon splits        |
| `emphasize` | number | `0`                                          | index of the accent-colored readout; `-1` disables                        |
| `cues`      | string | `""`                                         | comma-separated seconds; cue N starts readout N's tick; empty = authored  |
| `accent`    | enum   | `green`                                      | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`      | enum   | `none`                                       | `none` holds the final frame; `fade` and `up` release the stage           |

Envelope: IN = stage fade 0.45s, bracket draws from 0.12s, readout ticks land
per cue (default rhythm 1.0s + 0.28s per readout, each tick 0.5s; cues clamp
so every tick finishes before the exit). OUT = 0.45s only when `exit` is
`fade` or `up`. HOLD is the sole elastic phase and is completely still. The
`readouts-settled` sync point fires when the last default tick lands, 2.35s
at defaults.

Readouts are assigned to the four corners cyclically (top-left, top-right,
bottom-left, bottom-right), so 4 readouts give one line per corner and 8 give
two per corner.

## The slot mechanism

The primitive ships one named slot inside its `<template>`:

```html
<div class="th-slot" data-slot="subject"> ... </div>
```

The slot's default children are a token skeleton card, so an untouched mount
still reads as a framed subject. To show your own content, install the
component and **replace the children of the `[data-slot="subject"]` element
in your installed copy** (the runtime clones only the primitive's own
template on mount, so slot content lives in the component file, not on the
host clip).

Rules:

- The subject stays centered at 56cqw by 58cqh and never moves; the HUD
  brackets and readouts render around it, outside the slot.
- Direct `img`/`video` children are automatically sized to cover the subject
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- Keep the brackets and readout corners alone; they render above slot content.

## Worked example

Install, then fill the slot with a product screenshot:

```bash
npx hyperframes add telemetry-hud
```

In `compositions/components/telemetry-hud.html`, replace the slot's default
block:

```html
<div class="th-slot" data-slot="subject">
  <img src="../../assets/render-preview.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="telemetry-hud"
  data-composition-src="./components/telemetry-hud.html"
  data-variable-values='{"readouts":"pass:2 of 2,frames:135,gpu:41%,eta:00:12","emphasize":3,"accent":"blue"}'
  data-start="2"
  data-duration="4.5"
  data-track-index="0"
></div>
```

The brackets draw as the clip mounts, the four values tick in on the default
rhythm with `eta` emphasized in blue, and the HUD holds perfectly still for
the rest of the clip window (`exit` defaults to `none`; frame roots own scene
transitions).
