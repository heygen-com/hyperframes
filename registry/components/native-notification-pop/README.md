# native-notification-pop

One system-faithful notification banner drops in over any scene: fast
arrival, soft overshoot, settled mass. The `os` enum picks the chrome
geometry (`ios` is a wide centered banner with a large radius, `macos` is a
compact top-right banner). The banner carries an app dot, a small-caps app
label, a title, and one body line over a backdrop blur; it holds at rest and
tucks away only via the `exit` variable. Distinct from notification-stack:
this is overlay chrome, faithful to the OS, one banner.

Arrival is a closed-form underdamped spring sampled from a linear driver, so
the banner's position is a pure function of timeline time: seeks in either
direction land on identical frames, and the motion is interruptible in the
Wave K L1 sense (banner y has exactly one owner at any moment; nothing ever
snaps to zero velocity mid-flight).

## Files

- `native-notification-pop.html`: the mountable sub-composition (install
  target: `compositions/components/native-notification-pop.html`).
- `registry-item.json`: registry metadata and the variables block.

## Variables

| id          | type   | default                              | notes                                                                     |
| ----------- | ------ | ------------------------------------ | ------------------------------------------------------------------------- |
| `title`     | string | `Render complete`                    | the notification title line                                               |
| `body`      | string | `launch-cut.mp4 is ready to preview` | one body line; long lines truncate with an ellipsis                       |
| `app_label` | string | `HyperFrames`                        | small-caps app name row; empty string hides the row                       |
| `os`        | enum   | `ios`                                | `ios` = wide centered banner, `macos` = compact top-right banner          |
| `at`        | number | `0.3`                                | seconds after mount start when the drop begins (clamped before any exit)  |
| `accent`    | enum   | `green`                              | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`      | enum   | `none`                               | `none` holds; `up` tucks the banner back off the top; `fade` fades it     |

Envelope: IN = `at` + 0.9s spring drop (first contact with rest at `at` +
~0.31s), OUT = 0.45s only when `exit` is `fade` or `up`, HOLD is the sole
elastic phase and the banner rests dead still. The `banner-land` sync point
(`hf:sfx` id `notification-pop`) fires at first contact with rest, 0.61s at
defaults. `exit` moves only the banner; the scene slot holds regardless
(frame roots own scene transitions).

## The slot mechanism

The primitive ships one named slot inside its `<template>`:

```html
<div class="nnp-slot" data-slot="scene"> ... </div>
```

The slot's default children are a token backdrop (soft color fields plus a
skeleton card, saturated enough that the banner blur visibly reads), so an
untouched mount still works as a complete overlay demo. To drop the banner
over your own scene, install the component and **replace the children of the
`[data-slot="scene"]` element in your installed copy** (the runtime clones
only the primitive's own template on mount, so slot content lives in the
component file, not on the host clip).

Rules:

- The slot is full-bleed. Direct `img`/`video` children are automatically
  sized to cover the frame (`object-fit: cover`). Arbitrary HTML works too;
  size it in `cqw`/`cqh`.
- Keep the banner and its anchor alone; they render above slot content.
- The banner backdrop blur samples whatever the slot shows; busy, colorful
  scenes read best. If your host compositor flattens the blur, the
  translucent surface fill underneath carries the banner on its own.

## Worked example

Install, then fill the slot with a product screenshot:

```bash
npx hyperframes add native-notification-pop
```

In `compositions/components/native-notification-pop.html`, replace the
slot's default block:

```html
<div class="nnp-slot" data-slot="scene">
  <img src="../../assets/editor-timeline.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="native-notification-pop"
  data-composition-src="./components/native-notification-pop.html"
  data-variable-values='{"title":"Export finished","body":"reel-final.mov saved to Renders","app_label":"Conveyor","os":"macos","accent":"blue"}'
  data-start="6"
  data-duration="3"
  data-track-index="1"
></div>
```

The macOS banner springs in at the top right 0.3s after the clip mounts,
settles with a soft overshoot, and holds at rest for the remainder of the
clip window (`exit` defaults to `none`; frame roots own scene transitions).
