# state-chip-rail

Product-demo primitive: a rail of mono status chips advances a data-state
snap machine on a cue schedule. Presentation is pure CSS on each chip's
`[data-state]`; the timeline only flips attributes with `tl.set`, so every
advance is an instantaneous snap that is exact in both seek directions. The
active chip is ink on surface, done chips dim, pending chips stay hollow.
Optional badges pop beside one named state when it activates. Generalizes the
flagship agent-console status rail (cohere-north frame 04).

Authored at 5s with an elastic HOLD: chips cascade in, the machine advances
on its schedule, and everything after the last advance is still frame until
the (optional) exit.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `states` | string | `Queued,Reading,Drafting,Done` | Comma list of chip labels in machine order. 2 to 8 states; extras are dropped. State 0 is active from mount. |
| `times` | string | `""` | Comma-separated activation times in seconds relative to mount start, one per ADVANCE (state 1, state 2, ...). Blank or invalid entries use the default even rhythm; values are clamped into the mount window and forced monotonic. |
| `badge_state` | number 0-7 | `1` | Index of the state the badges pop beside. Clamped to the states range. |
| `badges` | string | `""` | Comma list of badge labels rendered after the `badge_state` chip; they pop in (staggered scale + fade) when that state activates. Empty disables. Up to 4. |
| `accent` | enum `green` \| `blue` \| `violet` | `green` | Active-chip accent: green rides `--brand`, blue `--accent`, violet `--accent-2`. |
| `exit` | enum `none` \| `fade` \| `up` | `none` | Frame roots own transitions; the default hold ends the film. |

## Usage

```html
<div
  class="clip"
  data-composition-id="state-chip-rail"
  data-composition-src="./components/state-chip-rail.html"
  data-variable-values='{"states":"Queued,Reading,Searching,Drafting,Done","times":"1.0,1.9,2.8,3.7","badges":"Drive,Mail,CRM","badge_state":2,"accent":"blue"}'
  data-start="0"
  data-duration="5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; the rail centers and fits itself
to whatever box the host clip gives it. Timeline registers under the literal
`state-chip-rail` key.

## Notes

- Seek-safe snap machine: `tl.set` attribute flips record the prior value on
  first render in timeline order, so backward seeks restore
  `pending` / `active` exactly (the flagship frame 04 pattern).
- State dimming rides color (`color-mix`), never opacity, so it cannot
  collide with the entrance opacity tweens.
- Badges keep their layout slot from mount (held at scale 0), so the rail
  never reflows when they pop.

Golden refs: scramble-reveal (token consumption), toggle-flip (mount-contract
structure).
