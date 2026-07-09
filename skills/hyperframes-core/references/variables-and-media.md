# Variables and Media

Two separate concerns, grouped because both control "what flows in from outside the HTML": runtime parameters (variables) and external media files (video/audio).

## Variables

Declare variables on the `<html>` element with `data-composition-variables`. Each declaration needs `id`, `type`, `label`, and `default`:

```html
<html
  data-composition-variables='[
    {"id":"title","type":"string","label":"Title","default":"Hello"},
    {"id":"accent","type":"color","label":"Accent","default":"#66d9ef"}
  ]'
></html>
```

Read resolved values once during initialization:

```js
const { title, accent } = window.__hyperframes.getVariables();
document.getElementById("title").textContent = title;
document.documentElement.style.setProperty("--accent", accent);
```

### Variable Rules

- Supported types and their extra options (consumed by Studio's editing UI):
  - `string`: optional `placeholder`, `maxLength`
  - `number`: optional `min`, `max`, `step`, `unit`
  - `color`: none
  - `boolean`: none
  - `enum`: **required** `options: [{ "value": "...", "label": "..." }, ...]`
- Always provide useful `default` values so preview works without CLI overrides.
- Use `data-variable-values='{"title":"Pro"}'` on sub-composition hosts for per-instance overrides.
- Use `npx hyperframes render --variables '{"title":"Q4 Report"}'` or `--variables-file` for render-time overrides.
- Add `--strict-variables` in CI: turns undeclared keys, type mismatches, and enum values not in `options` into errors instead of warnings.
- Read values once during init, not on every animation tick. Variables don't change mid-render.
- Media color grading can use exact variable references inside `data-color-grading` JSON. Use `$gradingPreset` or `${gradingIntensity}` as the whole field value; the runtime resolves it from the current composition's variables before applying shader adjustments, finishing details, blur/pixelate effects, and custom LUTs.

### Two JSON Shapes (Easy to Confuse)

- `data-composition-variables` is an **array of declarations** (the schema): `[{id, type, label, default}, ...]`
- `--variables` and `data-variable-values` are **objects keyed by id** (the values): `{ title: "Q4", accent: "#fff" }`

## Media

**NON-NEGOTIABLE: `<video>`/`<audio>` must be a DIRECT child of the host composition root (`index.html`).** The runtime only registers + drives media that is a direct root child. Media placed inside a sub-composition `<template>`, or wrapped in any intermediate `<div>`, is never seeked/decoded and renders blank (paper/white) or black. `lint`/`validate`/`inspect` do not catch this; per-frame `snapshot` shows the blank panel.

Consequences:

- A scene-specific clip still lives at the host root, not in the scene's sub-comp. The sub-comp keeps only the frame/shell; the media is a sibling host element positioned over it.
- A sub-composition **cannot reach or animate host elements**. Neither `document.querySelector("#host-id")` nor runtime target selectors such as `tl.add("#host-id", ...)` resolve across the boundary; a sub-comp timeline only drives its own subtree. So **all per-scene motion on host media (scale/opacity/morph/tilt/breathing) must be authored on the MAIN timeline in `index.html`, at GLOBAL time** (scene-local time + the scene slot's `data-start`). For 3D tilt, set CSS `perspective` on a parent and `transform-style: preserve-3d` on the tilted element, then tween `rotateX` / `rotateY` from the main timeline. See `composition-patterns.md` archetype B.

Video elements must be muted and inline. Audio must be a separate `<audio>` element, even when it uses the same source file.

```html
<video
  id="a-roll"
  class="clip"
  src="assets/demo.mp4"
  data-start="0"
  data-duration="12"
  data-track-index="0"
  muted
  playsinline
></video>

<audio
  id="a-roll-audio"
  src="assets/demo.mp4"
  data-start="0"
  data-duration="12"
  data-track-index="10"
  data-volume="1"
></audio>
```

### Media Rules

- **Do not** call `video.play()`, `audio.play()`, pause, or seek in composition code. HyperFrames owns playback.
- **Do not** place media inside a sub-comp `<template>` or any wrapper `<div>`; direct host-root child only (see above), else it never decodes.
- **Do not** drive host media from a sub-comp timeline. It has no effect. Drive it from the main timeline at global time.
- **Do not** animate timed media element dimensions; animate a non-timed wrapper instead.
- **Do not** nest video inside a timed wrapper. Put timing on the media element or keep the wrapper untimed.
- Add `crossorigin="anonymous"` for external media that needs canvas capture or pixel inspection.
- Audio always lives on a separate `<audio>` element, even if its source file is the same as a `<video>`. The `<video>` is muted; the `<audio>` carries sound.
- For volume fades/ducking, animate `volume` on the registered timeline (`tl.add("#bgm", { volume: [1, 0], duration: 1000 }, 9000)`) rather than swapping `data-volume`. The runtime probes the timeline's volume keyframes and applies them identically in preview and render; `data-volume` is the static baseline for elements no tween touches.

For media duration: `<video>` and `<audio>` can omit `data-duration` if the media's intrinsic length is known and you want the full clip. Otherwise provide `data-duration` explicitly.
