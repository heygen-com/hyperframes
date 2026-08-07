# browser-device-stage

A generic app surface presented in token-native device chrome. The stage settles in once (rise + soft scale, smooth ease-out), holds readable, and can optionally swap to a second screen at `swap_at` (a brief fade through the bare stage, so no frame shows two screens at partial opacity). The chrome is drawn entirely from contract tokens: hairline borders, surface mixes, muted dots, no traffic-light colors, no fake product branding.

- 5s authored, elastic HOLD (the envelope never time-scales).
- Timeline registered at `window.__timelines["browser-device-stage"]`.
- Elastic root: no `data-width`/`data-height`, sized by the host clip, `cqmin` units.

## Variables

| Variable  | Type   | Default           | Notes                                                                      |
| --------- | ------ | ----------------- | -------------------------------------------------------------------------- |
| `chrome`  | enum   | `browser`         | `browser` (toolbar dots + address pill), `window` (title bar), `phone` (notch, portrait inset, centered). |
| `title`   | string | `app.example.com` | Address pill text (browser) or title bar text (window). Phone shows no title. |
| `swap_at` | number | `0`               | Seconds from mount start to swap to the second screen. `0` disables. Clamped inside the hold so it never fights the entrance or exit. |
| `accent`  | enum   | `green`           | `green` rides `--brand`, `blue` rides `--accent`, `violet` rides `--accent-2`. Colors the skeleton mark, chip, and one card block. |
| `exit`    | enum   | `none`            | `none` holds the final frame (frame roots own transitions), `fade`, or `up`. |

## The screen slot

The screen area is a slot. Callers supply content by placing inert `<template>` elements anywhere in the **host page** (typically next to the mount clip). Templates never render on their own, and the runtime clears the host clip's children on mount, so the slot deliberately lives at document level:

```html
<template data-slot="browser-device-stage-screen"> ...first screen... </template>
<template data-slot="browser-device-stage-screen-b"> ...second screen (used when swap_at > 0)... </template>
```

Slot content can be an `<img>`, a `<video>`, or arbitrary HTML. Direct `img`/`video` children of the screen are stretched to `object-fit: cover`. When no `screen` slot exists, the primitive renders a token-styled skeleton app (header bar, sidebar, content cards). When `swap_at > 0` and no `screen-b` slot exists, the second screen is a rearranged skeleton state so the swap still reads.

Notes:

- Slot lookup is by the fixed names above, so two slotted instances on one page share the same slot content. Give multiple instances distinct content by mounting them from different host frames.
- A `<video>` in the slot is not seek-synced by the framework (framework-owned media playback applies to clips, not slot children). Prefer a still image or HTML for deterministic renders; if you need synced footage, use a media clip composition instead of this stage.
- Slot HTML inherits the composition's fonts and tokens; style it inline or with your own host CSS.

## Worked examples

Mount host (any chrome):

```html
<div
  class="clip"
  data-composition-id="browser-device-stage"
  data-composition-src="./components/browser-device-stage.html"
  data-variable-values='{"chrome":"browser","title":"dash.acme.dev","swap_at":2.4,"accent":"blue"}'
  data-start="0"
  data-duration="5"
  data-track-index="0"
  style="position:absolute; inset:0; container-type:size;"
></div>
```

### browser: product screenshot with a swap

```html
<template data-slot="browser-device-stage-screen">
  <img src="./assets/dashboard-before.png" alt="" />
</template>
<template data-slot="browser-device-stage-screen-b">
  <img src="./assets/dashboard-after.png" alt="" />
</template>
```

Set `swap_at` to the moment the narration lands the change; the stage fades the first screen out, then rises the second in over the bare stage.

### window: custom HTML screen

```html
<template data-slot="browser-device-stage-screen">
  <div style="position:absolute; inset:0; display:grid; place-items:center; background:var(--surface); color:var(--fg); font-family:var(--font-mono); font-size:3cqmin;">
    $ hyperframes render scene.html
  </div>
</template>
```

Mount with `{"chrome":"window","title":"terminal"}` for a titled desktop window around your own markup.

### phone: portrait screen

```html
<template data-slot="browser-device-stage-screen">
  <img src="./assets/mobile-feed.png" alt="" />
</template>
```

Mount with `{"chrome":"phone"}`. The device renders portrait and centered with a notch; leave roughly the top 8% of your artwork clear of critical content so the notch does not cover it. With no slot at all, the phone shows the skeleton in a single-column layout.

## Motion envelope

- IN 0.9s: one settle (rise from 4.5cqh + scale 0.965 to 1 + fade, power ease-out).
- HOLD: elastic; a barely-there vertical drift, then authored stillness.
- Swap (optional): 0.55s fade-through at `swap_at` (A empties, then B rises with a 1.6cqh slide), clamped into the hold.
- OUT 0.5s only when `exit` is `fade` or `up`; the default `none` holds to the last frame.
