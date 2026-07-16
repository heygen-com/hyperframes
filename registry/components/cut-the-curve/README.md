# cut-the-curve

A velocity-matched directional hard cut. The outgoing subject accelerates along one straight screen vector with `power4.in`; at peak velocity the timeline swaps identities; the incoming subject continues on the same vector and decelerates to rest with `power4.out`. Matched blur and opacity conceal the seam.

Transition profile: no elastic HOLD; retime by changing the mount duration only (0.3s to 3s).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `subject` | enum | `cursor` | `cursor`, `card`, or `scene`: the visual payload on both sides of the cut. |
| `direction` | enum | `left` | `left`, `right`, `up`, `down`: the shared travel vector. |
| `cutFraction` | number | `0.33` | Normalized point of the hard cut. The incoming distance derives from it so seam velocity stays matched. |
| `blurPx` | number | `12` | Blur shared by both subjects at the seam. |
| `exit` | enum | `none` | `none` rests until the cut; `fade`/`up` depart the incoming subject over a reserved tail (min(0.35s, 25% of D)) after it lands. |

## Mount

```html
<div
  class="clip"
  data-composition-id="cut-the-curve"
  data-composition-src="./cut-the-curve.html"
  data-variable-values='{"subject":"card","direction":"right","cutFraction":0.33}'
  data-start="0"
  data-duration="1"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `cut-the-curve` key.

## Notes

- Sync point: the cut lands at `(D - exit tail) * cutFraction`; a `whip-cut` `hf:sfx` CustomEvent fires there for the scene mix stage.
- Invariants: one shared vector, identity swap only at the cut, matched blur/opacity at the seam. Never split the two halves into independently tuned velocities.
