# whiteboard-ink

A hand-drawn whiteboard sketch draws itself one measured stroke at a time
while a pen nib rides the active ink front. Ships three preset sketches
(bulb, flow, rocket) and a strokes slot: fill it with your own multi-stroke
SVG paths and they become the drawing, with the same nib riding, per-stroke
cadence, and ink law as the presets.

## Files

- `whiteboard-ink.html`: the mountable sub-composition (install target:
  `compositions/components/whiteboard-ink.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: standalone mount used for QA.

## Variables

| id        | type   | default         | notes                                                                     |
| --------- | ------ | --------------- | ------------------------------------------------------------------------- |
| `sketch`  | enum   | `bulb`          | preset sketch (`bulb`, `flow`, `rocket`); ignored when the strokes slot holds paths |
| `caption` | string | `Draw the idea` | short line revealed after the drawing completes; empty string shows none  |
| `pen`     | enum   | `show`          | `hide` removes the traveling nib actor                                    |
| `accent`  | enum   | `green`         | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`    | enum   | `none`          | `none` holds the final frame; `fade` releases opacity; `up` adds a small upward drift |

Envelope: IN = 3.55s (3.25s sequential draw, then pen lift and caption),
OUT = 0.45s only when `exit` is `fade` or `up`, HOLD is the sole elastic
phase. The timeline is never time-scaled. The `ink-complete` sync point fires
at 3.3s at defaults.

## The strokes slot

The primitive's SVG ships an empty named group:

```html
<g class="wbi-sketch" data-slot="strokes" data-sketch="custom" hidden></g>
```

To draw your own artwork, install the component and **fill this group with
`<path>` elements in your installed copy** (the runtime clones only the
primitive's own template on mount, so slot content lives in the component
file, not on the host clip). As soon as the slot holds at least one path, it
replaces the preset selected by `sketch`; leave it empty and the presets
behave exactly as before.

Rules:

- Paths draw in document order, one at a time, with the nib hopping between
  strokes. Each path is measured once with `getTotalLength`; that measurement
  owns its dash array, cadence weight, and nib sampling. Author plain `d`
  path data, no `pathLength` attribute, no `vector-effect`.
- Coordinate space is the component viewBox, `0 0 1000 560`. Keep artwork
  near that scale so the nib and stroke weight read correctly. A `transform`
  on the slot group is honored (the nib maps through it).
- Strokes render in `--fg` at width 6 by default. An authored `stroke-width`
  attribute on a path wins. Fills are stripped (`fill: none`); this is a
  line-draw primitive.
- Mark a path `data-ink="accent"` to route it through the accent token map
  (the `accent` variable picks `--brand`, `--accent`, or `--accent-2`), the
  same treatment as each preset's single highlight stroke.
- Many strokes are fine: when the per-stroke minimums would overrun the 3.25s
  draw phase, the cadence compresses uniformly and stays sequential.

## Worked example

Install, then draw a custom "signal" mark with an accent underline:

```bash
npx hyperframes add whiteboard-ink
```

In `compositions/components/whiteboard-ink.html`, fill the slot group:

```html
<g class="wbi-sketch" data-slot="strokes" data-sketch="custom" hidden>
  <path d="M 320 330 L 420 330 L 460 210 L 540 400 L 580 300 L 680 300"></path>
  <path d="M 470 150 C 500 130 540 130 570 155"></path>
  <path data-ink="accent" d="M 330 430 C 440 452 570 452 672 428"></path>
</g>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="whiteboard-ink"
  data-composition-src="./components/whiteboard-ink.html"
  data-variable-values='{"caption":"Find the signal","accent":"blue","exit":"none"}'
  data-start="0"
  data-duration="5"
  data-track-index="0"
></div>
```

The three paths draw in order (zigzag, hat, then the accent underline in
`--accent` blue), the nib rides each ink front and hops between strokes, and
the caption fades up once the underline lands.

## Contract notes

- One paused GSAP timeline registered at `window.__timelines["whiteboard-ink"]`.
- Elastic root: no `data-width`/`data-height`, `container-type: size`, sized
  in `cq*` units; the HOLD phase absorbs any mount duration.
- Deterministic and seek-safe: dashed draw-on via `getTotalLength` in native
  SVG user units, never `pathLength`, never `non-scaling-stroke` on dashed
  paths; SVG group visibility toggles via the `hidden` attribute.
