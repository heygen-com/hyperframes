# grid-card-assemble

Layout / feature-tour primitive: N labeled tiles stagger-assemble into a grid
or a vertical list, then hold perfectly still. Each tile is a token card
(surface fill, hairline border, contract radius) with a wide-tracked mono
label and an accent dot. Entrances are a fade plus a short slide directly
into the tile's own slot: no scatter from center, no overshoot, a smooth
long-tail settle.

Authored at 4.5s with an elastic HOLD: the IN cascade is fixed, everything
after it is still frame until the (optional) exit.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `items` | string | `Capture,Compose,Render,Publish` | Comma list of tile labels. 3 to 12 items render gracefully; extras past 12 are dropped. |
| `layout` | enum `grid` \| `list` | `grid` | Grid wraps by `columns`; list stacks vertically in one column. |
| `columns` | number 0-4 | `0` | Grid only. `0` = auto: one row up to 3 items, then `ceil(sqrt(N))` (4 items form 2x2, 9 items form 3x3). |
| `cues` | string | `""` | Comma-separated per-item entrance times in seconds relative to mount start. Blank or invalid entries fall back to that item's default cascade slot (~0.06s gap). Values are clamped so every tile lands before any exit begins. |
| `accent` | enum `green` \| `blue` \| `violet` | `green` | Dot color family: green rides `--brand`, blue `--accent`, violet `--accent-2`. |
| `exit` | enum `none` \| `fade` \| `up` | `none` | Frame roots own transitions; the default hold ends the film. |

## Content override (items slot)

The stage grid is the `[data-slot="items"]` element inside the template. A
fork that wants custom tile content authors its own children there; when that
element already has children the script animates them as the tiles instead of
generating token cards from `items` (layout, `cues`, and `exit` still apply,
and `items` then only feeds the stage's aria-label).

## Usage

```html
<div
  class="clip"
  data-composition-id="grid-card-assemble"
  data-composition-src="./components/grid-card-assemble.html"
  data-variable-values='{"items":"Plan,Design,Build,Ship,Measure,Iterate,Launch,Scale,Repeat","columns":3,"accent":"blue"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
></div>
```

Golden refs: scramble-reveal (token consumption), toggle-flip (mount-contract
structure).
