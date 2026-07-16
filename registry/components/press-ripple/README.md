# press-ripple

Product demo payoff primitive: a cursor decel-arrives from off-stage (power2.out,
it arrives, it never passes through), lands a few px off-center on a
caller-positioned target zone, target and cursor compress in lockstep, release
with two ink ripple rings, and the pressed state holds dead-still to the end of
the clip. 3s authored, elastic HOLD (never time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="press-ripple"
  data-composition-src="./components/press-ripple.html"
  data-variable-values='{"label":"Approve run","target_x":62,"target_y":58,"accent":"blue"}'
  data-start="0"
  data-duration="3"
  data-track-index="0"
></div>
```

## Variables

| id       | type   | default       | notes                                                          |
| -------- | ------ | ------------- | -------------------------------------------------------------- |
| label    | string | "Get started" | Text in the default pill. Ignored when the slot is replaced.    |
| target_x | number | 50            | Zone center, percent of host width (8 to 92).                   |
| target_y | number | 50            | Zone center, percent of host height (8 to 92).                  |
| press_at | number | 1.4           | Seconds from mount start when the compression begins. Clamped so the press tail and any exit stay inside the clip duration. |
| cursor   | enum   | light         | light (white pointer, dark stroke) or dark (inverse).           |
| accent   | enum   | green         | green maps to --brand, blue to --accent, violet to --accent-2. Colors the ripple ink and the pressed fill. |
| exit     | enum   | none          | none holds the pressed state (frame roots own transitions); fade or up add a 0.45s departure. |

## Target slot

The element marked `data-slot="target"` is the press surface. Its default child
is a token-styled pill (`--surface` body, `--border` edge, `--font-body` at
weight 600) carrying `label`. Replace the slot's children in your installed copy
to press anything else: an icon button, a card, a toggle.

The slot wrapper flips `data-state="idle"` to `data-state="pressed"` at the
press (seek-safe: scrubbing backwards restores idle). Custom slot content can
key its own pressed look off that attribute, mirroring the default rule:

```css
.pr-target-slot[data-state="pressed"] .my-thing { /* pressed look */ }
```

## Choreography

- 0.00s: target settles in (fade + short rise, power3.out).
- press_at - 0.94s: cursor departs off-stage bottom-right, decelerating the
  whole way, tip landing slightly below-right of the zone center (human aim).
- press_at: target and cursor compress to 0.93 in lockstep (cursor scales
  about its tip).
- press_at + 0.12s: pressed state lands; release springs back (back.out) while
  two ink rings ripple out from under the slot, 0.09s apart.
- HOLD: dead still on the pressed state, elastic with the clip duration.

Sync point `press` fires the moment compression starts; align SFX or a
downstream reveal to it.

## Known tripwire

The bundler mirrors composition variables as scoped CSS custom properties, so
this unit's own `accent` variable becomes `--accent: blue` inside its subtree,
shadowing the contract token (and `blue` is a valid CSS color). The script
detects the shadow and substitutes the literal contract fallback for the blue
mapping, so `accent: "blue"` renders the soft contract blue, not pure blue.
