# Sub-Compositions

A sub-composition is a separate HTML file embedded in a host composition. HyperFrames loads it, seeks it independently, and composites the result into the host at `data-start`.

## Host Wiring

In the host composition, the sub-composition appears as a clip with `data-composition-src`:

```html
<div
  id="chart"
  data-composition-id="data-chart"
  data-composition-src="compositions/data-chart.html"
  data-start="2"
  data-duration="8"
  data-track-index="2"
  data-width="1920"
  data-height="1080"
></div>
```

- `data-composition-id` on the host must match the internal `data-composition-id` of the file at `data-composition-src`.
- The host clip needs its own `data-start`, `data-duration`, `data-track-index`, `data-width`, `data-height`.

## Sub-Composition File Structure

### Mental model — what the runtime actually does

When a host loads a sub-composition via `data-composition-src`, the runtime:

1. `fetch`es the HTML file.
2. Parses it with `DOMParser`.
3. **Finds the `<template>` element and clones ONLY its contents into the host slot.**
4. Everything **outside** the `<template>` (including the entire `<head>`) is **discarded**.

So `<template>` is not just a wrapper — it is the **transport container**. If a node needs to exist in the live render, it must be inside `<template>`. Full stop.

### File shape

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <!-- head is metadata for the source file only; the runtime ignores it -->
  </head>
  <body>
    <template>
      <!-- EVERYTHING the runtime needs goes here: styles, markup, scripts -->
      <style>
        .chart-root {
          position: absolute;
          inset: 0;
          color: #fff;
        }
        /* ... */
      </style>

      <div class="chart-root" data-composition-id="data-chart" data-width="1920" data-height="1080">
        <!-- sub-composition markup -->
      </div>

      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        // ... build timeline ...
        window.__timelines["data-chart"] = tl;
      </script>
    </template>
  </body>
</html>
```

Contrast with **standalone** compositions, which put the root directly in `<body>` with no `<template>` wrapper.

## Common pitfalls that pass static checks but break at render

`lint`, `validate`, and `inspect` evaluate each file in isolation. These two failures live in the **cross-file mount contract** and cannot be caught until the runtime actually tries to mount the sub-composition. Watch for them at author time and verify with the pre-render checklist below.

### Pitfall 1 — `<style>` in `<head>` instead of inside `<template>`

```html
<!-- ❌ WRONG — looks normal, ships catastrophically broken -->
<head>
  <style>
    .chart-root { font-size: 88px; ... }
  </style>
</head>
<body>
  <template>
    <div class="chart-root" ...>...</div>
  </template>
</body>

<!-- ✅ RIGHT — styles are inside the template -->
<head></head>
<body>
  <template>
    <style>
      .chart-root { font-size: 88px; ... }
    </style>
    <div class="chart-root" ...>...</div>
  </template>
</body>
```

**Why this happens:** standard HTML conventions tell you to put `<style>` in `<head>`. In a standalone HTML file that's correct. In a HyperFrames sub-composition it is **not** — the runtime only clones `<template>` contents, so `<head><style>` is dropped on the floor.

**Symptom:** the composition lints / validates / inspects clean, the render completes, but every text element shows up as tiny unstyled default text in the top-left and SVGs blow up to canvas-size because none of the CSS reached the live DOM. The same trap applies to `<script>` blocks, `<link rel="stylesheet">`, custom-element registrations — anything that needs to execute or apply in the render must be inside `<template>`.

### Pitfall 2 — Host `data-composition-id` ≠ inner template `data-composition-id`

```html
<!-- ❌ WRONG — host renames the slot; runtime can't find the timeline -->
<!-- host file (e.g. index.html) -->
<div data-composition-id="chart-mount" data-composition-src="compositions/chart.html" ...></div>

<!-- chart.html -->
<template>
  <div data-composition-id="data-chart" ...>...</div>
  <script>
    window.__timelines["data-chart"] = tl;
  </script>
</template>

<!-- ✅ RIGHT — both ids match, and the timeline key matches them too -->
<div data-composition-id="data-chart" data-composition-src="compositions/chart.html" ...></div>
<!-- chart.html template root: data-composition-id="data-chart" -->
<!-- timeline: window.__timelines["data-chart"] = tl; -->
```

**Why this happens:** it feels natural to give the host slot a different name like `chart-mount` ("the mount point") vs `data-chart` ("the actual chart"). HyperFrames does not work that way — **the host's `data-composition-id` is the lookup key the framework uses to find the registered timeline**. Lint passes because each file's ids are individually valid; the cross-file mismatch only blows up at render.

**Symptom:** the render logs `Sub-composition timelines not registered after 45000ms: <host-id>` for every mismatched slot, waits 45s per scene, then captures static initial-state frames (so the video is full-length but no animation plays).

### Verification checklist before render

```bash
# For every sub-composition file in compositions/:
#   1) <style> + <script> + main markup all live INSIDE <template>
grep -n "<style\|<script\|<template" compositions/<scene>.html
#      → first <style>/<script>/<div data-composition-id> should be AFTER <template>, before </template>

#   2) host data-composition-id == internal data-composition-id == window.__timelines key
grep "data-composition-id" index.html
grep "data-composition-id\|__timelines\[" compositions/<scene>.html
#      → all three strings must match exactly per scene
```

For the runtime end-to-end check (a fast `snapshot` pass + per-scene frame eyeball), see the **Visual smoke test** step in `hyperframes-cli`'s Minimum Completion Gate — that is the only gate that catches these two pitfalls.

## What HyperFrames Does With the Sub-Composition

- Loads the file and registers its timeline under its internal `data-composition-id`.
- Seeks the sub-composition's timeline independently from the host's playhead.
- Plays the sub-composition's content from `data-start` of the host clip, for `data-duration` seconds.

**Do not** manually `master.add(child)` a sub-composition timeline into the host timeline. HyperFrames already drives them independently — nesting them in GSAP causes double-seeks.

## Animations Inside Sub-Compositions

Prefer `gsap.fromTo()` over `gsap.from()` for entrance tweens. The host re-seeks the sub-composition every time its clip becomes visible; `gsap.from()` records the starting state at registration and can desync on seek-back, while `gsap.fromTo()` declares both endpoints explicitly and replays cleanly.

## Per-Instance Variables

If the sub-composition declares variables on its `<html>` element (`data-composition-variables`), the host can override values per instance:

```html
<div
  data-composition-id="data-chart"
  data-composition-src="compositions/data-chart.html"
  data-variable-values='{"title":"Q4 Revenue","accent":"#66d9ef"}'
  data-start="2"
  data-duration="8"
  data-track-index="2"
  data-width="1920"
  data-height="1080"
></div>
```

The host can render the same sub-composition multiple times with different `data-variable-values` to produce per-instance variations. See `variables-and-media.md` for variable declaration syntax.
