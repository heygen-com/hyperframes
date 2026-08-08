# ui-focus-zoom

A full app surface establishes with one settle, then the camera zooms and pans to an anchored region on its cue and holds the zoomed state. An optional focus halo blooms softly at the anchor as the camera arrives. The camera-servo law applies: all camera motion is ONE world wrapper transform, and the micro-drift is built from integer sine cycles that end at exactly zero before the authored stillness, so the hold is dead still.

- 4.5s authored, elastic HOLD (the envelope never time-scales).
- Timeline registered at `window.__timelines["ui-focus-zoom"]`.
- Elastic root: no `data-width`/`data-height`, sized by the host clip, `cqmin` units.

## Variables

| Variable   | Type   | Default | Notes                                                                       |
| ---------- | ------ | ------- | ---------------------------------------------------------------------------- |
| `anchor_x` | number | `64`    | Focus anchor, percent from the left edge of the surface (0 to 100).          |
| `anchor_y` | number | `36`    | Focus anchor, percent from the top edge of the surface (0 to 100).           |
| `zoom`     | number | `1.6`   | Camera scale at the focused state (1 to 3). At `1` the camera cannot pan.    |
| `zoom_at`  | number | `1.4`   | Seconds from mount start when the camera departs. Clamped inside the hold so the move never fights the entrance or the exit. |
| `halo`     | enum   | `show`  | `show` blooms a soft accent glow at the anchor as the camera arrives; `hide` removes it. |
| `accent`   | enum   | `green` | `green` rides `--brand`, `blue` rides `--accent`, `violet` rides `--accent-2`. Colors the halo and the skeleton accent elements. |
| `exit`     | enum   | `none`  | `none` holds the final frame (frame roots own transitions), `fade`, or `up`. |

## The surface slot

The app surface is a slot. Callers supply content by placing an inert `<template>` element anywhere in the **host page** (typically next to the mount clip). Templates never render on their own, and the runtime clears the host clip's children on mount, so the slot deliberately lives at document level:

```html
<template data-slot="ui-focus-zoom-screen"> ...full app surface... </template>
```

Slot content can be an `<img>`, a `<video>`, or arbitrary HTML. Direct `img`/`video` children of the surface are stretched to `object-fit: cover`. When no slot exists, the primitive renders a token-styled skeleton app (header bar, sidebar, content cards; hairline borders, surface mixes, one accent element, no branding).

Notes:

- Slot lookup is by the fixed name above, so two slotted instances on one page share the same slot content. Give multiple instances distinct content by mounting them from different host frames.
- A `<video>` in the slot is not seek-synced by the framework (framework-owned media playback applies to clips, not slot children). Prefer a still image or HTML for deterministic renders.
- Aim `anchor_x`/`anchor_y` at the region of your artwork the story lands on; the camera centers it as closely as the edge clamp allows.

## The camera

The camera lives on one world wrapper as `translate(x, y) scale(S)`. Translate percentages resolve against the world's own box, so no pixel measurement is needed and the primitive stays fully elastic to its host. The pan is clamped so the scaled world always covers the viewport: with an extreme edge anchor or a low `zoom`, the camera centers the anchor as closely as it can without revealing background. At `zoom: 1` there is no pan at all (nothing to zoom into).

## Worked examples

Mount host with a skeleton surface (no slot):

```html
<div
  class="clip"
  data-composition-id="ui-focus-zoom"
  data-composition-src="./components/ui-focus-zoom.html"
  data-variable-values='{"anchor_x":72,"anchor_y":30,"zoom":1.8,"zoom_at":1.6,"accent":"blue"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
  style="position:absolute; inset:0; container-type:size;"
></div>
```

### Zoom into a product screenshot

```html
<template data-slot="ui-focus-zoom-screen">
  <img src="./assets/dashboard.png" alt="" />
</template>
```

Set `anchor_x`/`anchor_y` to the feature's position in the artwork (percent of the image after cover-fit) and `zoom_at` to the narration beat that names it.

### Quiet establish, late push

Mount with `{"zoom_at":2.6,"zoom":1.5,"halo":"hide"}` for a long readable establish and a restrained late push with no halo.

## Motion envelope

- IN 0.9s: one settle (rise from 4.5cqh + scale 0.965 to 1 + fade, power ease-out).
- Camera 1.1s at `zoom_at` (clamped): one servo move to the anchor, power2.inOut.
- Halo (optional): 0.75s soft bloom starting halfway through the camera move.
- HOLD: elastic; micro-drift from integer sine cycles (2 and 3 full cycles) ends at exactly zero, then 0.35s authored stillness.
- OUT 0.5s only when `exit` is `fade` or `up`; the default `none` holds to the last frame.
