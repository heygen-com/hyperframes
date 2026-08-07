# screen-flow-carousel

Two to five app screens ride a horizontal rail. One screen is primary at center while its neighbors recede (smaller and dimmer). On each cue the whole rail advances one screen with a velocity-matched throw: a fast lateral translate that sheds speed quickly, then a smooth long-tail catch onto the next center (the velocity-throw-snap motion law with the snap softened to the smooth register: no overshoot, both sides always moving the same direction). A mono caption under the rail swaps with each advance.

5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `screens` | number | `3` | 2 to 5 screens on the rail. |
| `captions` | string | `""` | Comma-separated caption per screen. Blank entries use the authored defaults (Overview, Details, Insights, Activity, Settings). |
| `cues` | string | `""` | Comma-separated advance times in seconds from mount start (`screens - 1` advances). Blank entries use the authored even rhythm; values are clamped inside the hold and kept far enough apart that throws never overlap. |
| `accent` | enum | `green` | Active ring, caption dot, and skeleton accents: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds the final screen until the cut; `fade` departs opacity-only; `up` fades while rising. |

## Screen slots

Screens are slots. Place inert templates anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so slots live at document level):

```html
<template data-slot="screen-flow-carousel-screen-1">
  <img src="./shots/dashboard.png" alt="" />
</template>
<template data-slot="screen-flow-carousel-screen-2">
  <video src="./shots/flow.mp4" muted></video>
</template>
```

Slot content may be an `<img>`, a muted `<video>`, or arbitrary HTML; direct img/video children are stretched to cover the screen. Any screen without a slot renders a token-styled skeleton; the four variants (list, cards, chart, detail) cycle by index so adjacent defaults never repeat.

## Mount

```html
<div
  class="clip"
  data-composition-id="screen-flow-carousel"
  data-composition-src="./screen-flow-carousel.html"
  data-variable-values='{"screens":4,"captions":"Capture,Compose,Render,Publish","cues":"1.3,2.4,3.5","accent":"blue"}'
  data-start="0"
  data-duration="5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `screen-flow-carousel` key.

## Notes

- Rail position is CSS-owned through the numeric `--sfc-pos` custom property; GSAP tweens only that number plus per-screen scale/opacity with explicit endpoints, so any seek order lands identical frames.
- The active ring is opacity-only over a CSS accent border, so no `var()` color string is ever GSAP-tweened.
- Envelope: fixed IN (0.9s settle) and OUT (0.45s, only when `exit` is not `none`) with an elastic HOLD; all advances live inside the hold and the last throw always lands with stillness left before the cut. Never time-scaled.
