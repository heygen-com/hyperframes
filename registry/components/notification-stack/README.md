# notification-stack

Product-demo primitive: 1 to 5 token notification cards (accent icon dot,
title, one body line) slide-settle into a vertical stack on cues, newest on
top. Each new card drops into the top slot with a fade and a smooth long-tail
settle while the cards already present shift down one slot. After the last
card lands, one card (the `expand` index) grows slightly and brightens to
resolve as the focus while the rest dim by stack position (deeper cards dim
more). Then the frame holds perfectly still.

Authored at 4s with an elastic HOLD: arrivals plus the resolve are fixed,
everything after is still frame until the (optional) exit. Type sizes ride
`cqmin` with card-height caps so the stack stays readable at 1920x1080 and
legible when the stage is mounted small.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `titles` | string | `Build queued,Checks passed,Deploy live` | Comma list of card titles, 1 to 5 cards; extras past 5 are dropped. |
| `bodies` | string | `Pipeline started for main,All 42 checks green,Now serving version 2.4` | Comma list of body lines matched to titles by index. A missing or blank entry hides that card's body line. |
| `expand` | number -1 to 4 | `-1` | Index of the focus card in the `titles` list. `-1` (or any out-of-range value) focuses the newest card, which sits on top of the stack. |
| `cues` | string | `""` | Comma-separated per-card arrival times in seconds relative to mount start. Blank or invalid entries fall back to that card's default rhythm slot (~0.55s gap). Times are kept non-decreasing and clamped so every card lands before the resolve. |
| `accent` | enum `green` \| `blue` \| `violet` | `green` | Icon dot family: green rides `--brand`, blue `--accent`, violet `--accent-2`. |
| `exit` | enum `none` \| `fade` \| `up` | `none` | Frame roots own transitions; the default hold ends the film. |

## Usage

```html
<div
  class="clip"
  data-composition-id="notification-stack"
  data-composition-src="./components/notification-stack.html"
  data-variable-values='{"titles":"Upload received,Transcode started,Draft ready","bodies":"clip_final_v3.mp4 landed,1080p and 4K in flight,Storyboard open for review","expand":2,"accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Golden refs: scramble-reveal (token consumption), grid-card-assemble
(stagger and dim discipline), toggle-flip (mount-contract structure).
