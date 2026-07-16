# vox-annotate

The Vox-style annotate gesture: a short line of display text settles in, then
on one cue a keyword gets a hand-drawn marker WHILE a thin connector draws
from the marker up to a mono callout label that fades in at its end. Marker,
connector, and label are one choreographed beat, not three events; the whole
rig rides the keyword's settle pop as the ink lands.

Absorbs `marker-highlight`: the four stroke styles (highlight, circle,
underline, scribble) and the draw mechanic are inherited from that donor
verbatim. Strokes reveal by a getTotalLength dash tween with both endpoints
explicit (never the `pathLength` attribute, never `non-scaling-stroke` on a
dashed path), so seeks in either direction never leave stale paint. Set
`note` empty and vox-annotate degrades to exactly the donor's behavior:
marker only.

## Files

- `vox-annotate.html`: the mountable sub-composition (install target:
  `compositions/components/vox-annotate.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: standalone 1920x1080 host mounting the primitive with
  non-default variables.

## Variables

| id        | type   | default                        | notes                                                                     |
| --------- | ------ | ------------------------------ | ------------------------------------------------------------------------- |
| `text`    | string | `Ship the story, not the spec` | the full line; may wrap, stays centered                                   |
| `keyword` | string | `story`                        | first case-insensitive substring match gets the annotation; empty = none  |
| `note`    | string | `the annotate beat`            | mono callout at the connector's end; empty draws the marker only          |
| `style`   | enum   | `highlight`                    | `highlight`, `circle`, `underline`, or `scribble`                         |
| `draw_at` | number | `0.9`                          | gesture cue in seconds from mount start; clamped ahead of any exit        |
| `accent`  | enum   | `green`                        | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`    | enum   | `none`                         | `none` holds the lockup; `fade` and `up` release the stage                |

Envelope: IN = 0.55s rise, GESTURE = 0.96s anchored at `draw_at` (marker
0.60s; connector 0.45s starting 0.36s in; label fade-up 0.30s starting 0.66s
in), HOLD is the sole elastic phase, OUT = 0.45s only when `exit` is `fade`
or `up`. The `annotate-draw` sync point fires at `draw_at`.

## Layout notes

The annotation anchors above and to the right of the keyword and needs
headroom: the callout box spans about 19cqh above the line. With centered
single-line text the default stage always has room; if you mount the
primitive very short and wide, prefer `underline` or `highlight` (the
`circle` box extends furthest) and keep `note` short. The callout stays on
one line by design.

## Worked example

```bash
npx hyperframes add vox-annotate
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="vox-annotate"
  data-composition-src="./components/vox-annotate.html"
  data-variable-values='{"text":"Latency fell 40 percent","keyword":"40 percent","note":"p99, last quarter","style":"circle","draw_at":1.1}'
  data-start="2"
  data-duration="4"
  data-track-index="0"
></div>
```

The line rises in, and at 1.1s one gesture circles the number, draws the
connector, and lands the mono note. The lockup then holds until the frame
cuts (`exit` defaults to `none`; frame roots own scene transitions).
