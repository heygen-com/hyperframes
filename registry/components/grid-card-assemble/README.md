# grid-card-assemble

Layout / feature-tour primitive: N capability cards stagger-assemble into a
grid or a vertical list, then hold perfectly still. Each card is a real token
card: surface fill with a subtle top light, hairline border, contract radius,
generous padding, a thin-line icon that draws on as the card lands, a
wide-tracked mono label, and an optional one-line muted body. Entrances are a
fade plus a short slide directly into the card's own slot: no scatter from
center, no overshoot, a smooth long-tail settle.

Six generic thin-line icons (shield, chart, cloud, bolt, layers, doc) cycle
deterministically by item index and draw on with a getTotalLength dash inside
each card's settle window.

Authored at 4.5s with an elastic HOLD: the IN cascade is fixed, everything
after it is still frame until the (optional) exit.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `items` | string | `Capture,Compose,Render,Publish` | Comma list of cards (3 to 12; extras past 12 are dropped). An entry formatted `Label: body text` renders a one-line muted body under the label; a plain entry is label-only. Body text must not contain commas. |
| `layout` | enum `grid` \| `list` | `grid` | Grid wraps by `columns`; list stacks horizontal icon-left rows in one column. |
| `columns` | number 0-4 | `0` | Grid only. `0` = auto: one row up to 3 items, then `ceil(sqrt(N))` (4 items form 2x2, 9 items form 3x3). |
| `cues` | string | `""` | Comma-separated per-item entrance times in seconds relative to mount start. Blank or invalid entries fall back to that item's default cascade slot (~0.1s gap). Values are clamped so every card lands before any exit begins. |
| `accent` | enum `green` \| `blue` \| `violet` | `green` | Icon stroke family: green rides `--brand`, blue `--accent`, violet `--accent-2`. |
| `exit` | enum `none` \| `fade` \| `up` | `none` | Frame roots own transitions; the default hold ends the film. |

## Content override (items slot)

The stage grid is the `[data-slot="items"]` element inside the template. A
fork that wants custom card content authors its own children there; when that
element already has children the script animates them as the cards instead of
generating capability cards from `items` (layout, `cues`, and `exit` still
apply, and `items` then only feeds the stage's aria-label). Any
`.gca-icon path` elements inside slotted cards still dash-draw as the card
lands.

## Usage

```html
<div
  class="clip"
  data-composition-id="grid-card-assemble"
  data-composition-src="./components/grid-card-assemble.html"
  data-variable-values='{"items":"Permissions: Scoped by your policies,Audit trail: Every action logged,Deploy: Your cloud or on-prem","accent":"blue"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
></div>
```

Golden refs: scramble-reveal (token consumption), toggle-flip (mount-contract
structure).

Note: icon dash draws are driven through the `stroke-dashoffset` attribute
(GSAP attr plugin), not CSS style. Chrome under-invalidates the path region
for CSS dash changes, which leaves stale stroke fragments on reverse seeks.
