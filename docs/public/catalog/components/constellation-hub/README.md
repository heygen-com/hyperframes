# constellation-hub

Feature nodes orbit one fixed hub. Each connector draws from the hub to its node in narration order (real `getTotalLength` dash draws) while that node brightens, then everything settles into one readable lockup that holds until the frame cuts.

4.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `hub_label` | string | `Product` | Text inside the fixed central hub. |
| `nodes` | string | `Capture,Compose,Render,Share` | Comma-separated feature labels, introduced first to last. |
| `cues` | string | `` (empty) | Comma-separated seconds (from mount start) for each node's reveal, e.g. `0.5,1.2,1.9,2.6`. Nodes beyond the list extrapolate at the list's own gap. Empty keeps the authored even spread. |
| `accent` | enum | `green` | Hub, connector, and active-node color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` is the scale-down fade (the pre-Wave-J default ending); `up` departs with a rise and fade. |

## Mount

```html
<div
  class="clip"
  data-composition-id="constellation-hub"
  data-composition-src="./constellation-hub.html"
  data-variable-values='{"hub_label":"HyperFrames","nodes":"Author,Check,Render,Publish","cues":"0.6,1.4,2.2,3.0"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `constellation-hub` key.

## Notes

- Cue N starts node N's connector draw and brighten. Reveals clamp so the group settle finishes before any exit.
- Connector dash values come from each path's real `getTotalLength()` read synchronously at build; never `pathLength`, never `non-scaling-stroke`.
