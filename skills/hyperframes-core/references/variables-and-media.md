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

**Prefer declarative bindings — no script needed** for direct substitution:

```html
<img class="clip" data-start="0" data-duration="5" data-var-src="heroImage" src="fallback.jpg" />
<h1 class="clip" data-start="0" data-duration="5" data-var-text="title">Fallback</h1>
<style>
  .card {
    color: var(--accent);
  }
</style>
```

- `data-var-src="id"` substitutes the element's `src` (URL string or image `{url}`); the authored `src` is the fallback.
- `data-var-text="id"` substitutes the element's own text; element children (nested clips, animated spans) are preserved.
- Every scalar variable is applied automatically as a `--{id}` CSS custom property on the composition root, so `var(--id)` CSS responds to overrides — no `setProperty` boilerplate.
- Bindings resolve identically in preview and render, and per-instance for sub-compositions.
- Caveat: media with audio should keep a real fallback `src` — render audio extraction reads the authored attribute (lint: `media_variable_src_no_fallback`).

For logic beyond direct substitution (loops, conditionals, derived values), read values once during initialization:

```js
const { title, accent } = window.__hyperframes.getVariables();
document.getElementById("title").textContent = title;
```

### Variable Rules

- Supported types and their extra options (consumed by Studio's editing UI):
  - `string` — optional `placeholder`, `maxLength`
  - `number` — optional `min`, `max`, `step`, `unit`
  - `color` — none
  - `boolean` — none
  - `enum` — **required** `options: [{ "value": "...", "label": "..." }, ...]`
- Always provide useful `default` values so preview works without CLI overrides.
- Use `data-variable-values='{"title":"Pro"}'` on sub-composition hosts for per-instance overrides.
- Use `npx hyperframes render --variables '{"title":"Q4 Report"}'` or `--variables-file` for render-time overrides.
- Add `--strict-variables` in CI: turns undeclared keys, type mismatches, and enum values not in `options` into errors instead of warnings.
- Read values once during init, not on every animation tick — variables don't change mid-render.
- Media color grading can use exact variable references inside `data-color-grading` JSON. Use `$gradingPreset` or `${gradingIntensity}` as the whole field value; the runtime resolves it from the current composition's variables before applying shader adjustments, finishing details, blur/pixelate effects, and custom LUTs.

### Two JSON Shapes (Easy to Confuse)

- `data-composition-variables` is an **array of declarations** (the schema): `[{id, type, label, default}, ...]`
- `--variables` and `data-variable-values` are **objects keyed by id** (the values): `{ title: "Q4", accent: "#fff" }`

## Media

**`<video>`/`<audio>` work at any nesting depth, including inside a sub-composition `<template>` or a wrapper `<div>`.** The runtime discovers media with a flat `document.querySelectorAll("video, audio")`, resolves each element's host composition via `element.closest("[data-composition-id]")`, and rebases its local `data-start` by the accumulated absolute start of every ancestor composition (`packages/core/src/runtime/{media,startResolver}.ts`). So a scene-specific clip can live in its scene's sub-comp with scene-local `data-start`, and it seeks/decodes correctly. If a panel renders blank after a render, that is a real bug: capture a per-frame `snapshot` and treat it as render-blocking.

The one real constraint is about **timelines, not media placement**: a sub-composition timeline **cannot reach or animate host elements** — neither `document.querySelector("#host-id")` nor a gsap selector string (`tl.to("#host-id", …)`) resolves across the boundary; a sub-comp timeline only drives its own subtree. So if a media element lives at the host root, **its per-scene motion (scale/opacity/morph/tilt/breathing) must be authored on the MAIN timeline in `index.html`, at GLOBAL time** (scene-local time + the scene slot's `data-start`). Keeping the media inside the scene sub-comp instead lets that sub-comp's own timeline animate it with scene-local time. For 3D tilt without a perspective parent, use gsap `transformPerspective` on the element. See `composition-patterns.md` archetype B.

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
- **Do not** drive host-root media from a sub-comp timeline: a sub-comp timeline cannot reach elements outside its subtree, so it has no effect. Drive host-root media from the main timeline at global time (or keep the media inside the sub-comp whose timeline animates it).
- **Do not** animate timed media element dimensions; animate a non-timed wrapper instead.
- **Do not** nest video inside a timed wrapper. `lint` rejects a `<video data-start>` whose ancestor also carries `data-start` (`video_nested_in_timed_element`, error), and the failure is real: the frame extractor resolves the video's start from its own `data-start` without the wrapper's offset, while visibility uses the wrapper's window. The clip then shows the wrong source frames and disappears partway through its slot. Put the timing on the wrapper **or** on the media element, never both.
- **Sub-compositions are exempt and work.** A `<video>`/`<audio>` inside a sub-composition renders identically to one at the host root, because a composition host propagates its offset. Only plain timed wrappers (a `<section data-start>` around a `<video data-start>`) break.
- **Never** add `crossorigin` to `<video>`/`<audio>`. `lint` rejects it unconditionally (`media_crossorigin_breaks_preview`, error) because a media host without `Access-Control-Allow-Origin` then fails silently in preview while renders still work, hiding the bug. There is no suppression, so this holds even for the canvas/WebGL/WebAudio readback case.
- **Every `<audio>` needs an `id`.** The mixer selects `audio[id][src]`, so an id-less `<audio>` is never mixed and the render is **silent**. `lint` catches it as `media_missing_id`.
- Audio always lives on a separate `<audio>` element — even if its source file is the same as a `<video>`. The `<video>` is muted; the `<audio>` carries sound.
- For volume fades/ducking, animate `volume` on the timeline (`tl.to("#bgm", { volume: 0, duration: 1 }, "outro")`) rather than swapping `data-volume`. The runtime probes the timeline's volume keyframes and applies them identically in preview and render; `data-volume` is the static baseline for elements no tween touches. A tween's values REPLACE that baseline rather than scaling it, so on a clip whose gain is not `1` you scale the tween's targets instead (`{ volume: 1.95 }`, not `{ volume: 1 }`) — `lint` warns with `audio_volume_tween_overrides_gain` when the two disagree.

For media duration: `<video>` and `<audio>` can omit `data-duration` if the media's intrinsic length is known and you want the full clip. Otherwise provide `data-duration` explicitly.

Input codecs: render decodes video via FFmpeg (frames are pre-extracted and injected), so HEVC/H.265 assets (8/10-bit) render correctly everywhere; live preview auto-proxies any browser-hostile asset (transcodes and caches an H.264 copy on first use, opt out with `--no-proxy` or `media.autoProxy: false`), and `lint` emits an info-level `hevc_preview_codec` note naming affected assets.
