# scroll-camera-story

A compressed forced-scroll cinematic pass. A tall authored scene (four depth layers: far washes, mid hairline geometry, content sections, foreground accent motes) travels past the camera top to bottom. Layers move at different rates (far slowest, foreground fastest), each section rises softly as the camera reaches it, and the pass decelerates into a held final section that is byte-still.

5.5s authored, elastic HOLD, exit `none` by default. Camera-servo law: one plain state object, one `applyCamera()` writer, micro-drift built from integer sine cycles that end at exactly zero when the final section lands. No cq units inside tweens (world height is set once at mount; all tweened transforms are percent-based).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `sections` | number | `3` | Skeleton section count, 2 to 4. A sections slot overrides it with its own child count. |
| `travel` | number | `220` | Total camera travel in cqh. The world is `100 + travel` cqh tall; sections spread evenly along the travel. |
| `cues` | string | `""` | Comma-separated seconds: arrival times for the sections AFTER the first (the first is on screen at mount). A list with one extra leading value drops it as the mount section's. Empty keeps the authored default rhythm. |
| `accent` | enum | `green` | green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds the final section until the cut; `fade`; `up`. |

## Sections slot

Place an inert template at HOST document level; each direct child becomes one section's card content, in order (clamped to 2 to 4 sections; sections without a slot child keep their token skeleton default, and the card shell stays so slot content inherits the token chrome):

```html
<template data-slot="scroll-camera-story-sections">
  <div>first section content</div>
  <div>second section content</div>
  <div>third section content</div>
</template>
```

## Mount

```html
<div
  class="clip"
  data-composition-id="scroll-camera-story"
  data-composition-src="./scroll-camera-story.html"
  data-variable-values='{"sections":4,"travel":300,"cues":"1.7,2.9,4.0","accent":"blue"}'
  data-start="0"
  data-duration="5.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `scroll-camera-story` key.

## Notes

- Camera segments never overlap (each move starts after the previous ends), so seeks in any order reproduce the exact frame; the quiet register is the only register (Wave K L2).
- Keep `travel` near `100 x (sections - 1)` cqh for a continuous pass; much larger spacing gives decor-only interstitials between sections (the depth layers keep those frames alive, but no card is on screen).
- Longer host durations stretch the final hold only; the default arrival rhythm scales from the mount duration, explicit `cues` are absolute seconds.
- The hold is truly still: camera, drift, and the last section rise all end on the final arrival cue.
