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
        /* Root: style by #root, never a class. (At render the CSS is scoped to
           data-composition-id, so a class on the root stops matching — see Pitfall 3.) */
        #root {
          position: absolute;
          inset: 0;
          color: #fff;
        }
        /* .label, #bar, … — descendants, plain selectors */
      </style>

      <div id="root" data-composition-id="data-chart" data-width="1920" data-height="1080">
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
    #root { font-size: 88px; ... }
  </style>
</head>
<body>
  <template>
    <div id="root" data-composition-id="data-chart" ...>...</div>
  </template>
</body>

<!-- ✅ RIGHT — styles are inside the template, root styled by #root (see Pitfall 3) -->
<head></head>
<body>
  <template>
    <style>
      #root { font-size: 88px; ... }
    </style>
    <div id="root" data-composition-id="data-chart" ...>...</div>
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

### Pitfall 3 — Styling the root by a class instead of `#root`

```html
<!-- ❌ WRONG — class on the root, stylesheet keyed off it -->
<template>
  <style>
    .frame {
      position: absolute;
      inset: 0;
      background: #faf9f5;
    }
    .frame .title {
      font-size: 120px;
    }
  </style>
  <div id="root" class="frame" data-composition-id="03-scene" ...>
    <div class="title">…</div>
  </div>
</template>

<!-- ✅ RIGHT — root styled by #root, descendants by plain selectors -->
<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
      background: #faf9f5;
    }
    .title {
      font-size: 120px;
    }
  </style>
  <div id="root" data-composition-id="03-scene" ...>
    <div class="title">…</div>
  </div>
</template>
```

**Why this happens:** when sub-compositions are inlined into one composited render, the compiler **scopes each file's CSS to its own `data-composition-id`** so scenes can't leak styles into each other — every rule `S` becomes `[data-composition-id="<id>"] S` (a _descendant_ selector). A rule whose leftmost selector is the **root's own class** (`.frame`) therefore becomes `[data-composition-id="<id>"] .frame`, which cannot match the root (the root _is_ the scoped element, not a descendant of it), so **every `.frame…` rule silently drops**. `#root` is special-cased by the scoper and keeps matching the root; plain descendant selectors (`.title`) match normally. The per-scene class namespace is also just redundant — the `data-composition-id` scope already isolates each scene's styles.

**Symptom:** _identical_ to Pitfall 1 — tiny unstyled text in the top-left, images at natural size, inline styles (e.g. a card background) the only thing surviving. The trap: this passes `lint`/`validate`/`inspect` (they evaluate the file in isolation, unscoped) **and looks perfect in `preview`** (Studio mounts each scene in its own iframe, also unscoped) — it only breaks in the composited MP4 render. Lint rule `subcomposition_root_styled_by_class` flags it; the registry blocks (e.g. `apple-money-count`) model the `#root` pattern.

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

#   3) the root is styled by #root, not by a class on the data-composition-id element
grep -n 'data-composition-id=' compositions/<scene>.html
#      → that element should NOT also carry a class="…" that the <style> keys off
#        (e.g. `.frame { … }`); scoping drops it. Style the root via #root. See Pitfall 3.
```

For the runtime end-to-end check (a fast `snapshot` pass + per-scene frame eyeball), see the **Visual smoke test** step in `hyperframes-cli`'s Minimum Completion Gate — that is the only gate that catches these three pitfalls.

## What HyperFrames Does With the Sub-Composition

- Loads the file and registers its timeline under its internal `data-composition-id`.
- Seeks the sub-composition's timeline independently from the host's playhead.
- Plays the sub-composition's content from `data-start` of the host clip, for `data-duration` seconds.

**Do not** manually `master.add(child)` a sub-composition timeline into the host timeline. HyperFrames already drives them independently — nesting them in GSAP causes double-seeks.

### The host clip's `data-duration` is the slot's visible window

`data-duration` on the host clip defines **how long the slot is visible**, and it takes precedence over the sub-composition's internal GSAP timeline length. Two consequences follow:

- **Internal timeline shorter than the slot → the slot holds.** If the sub-composition's GSAP timeline finishes before `data-duration` elapses, the slot keeps showing its final frame for the rest of the window. You do **not** need to pad the timeline with empty tweens.
- **`data-duration` shorter than the host composition → the slot ends (and goes blank) when its own `data-duration` elapses.** This is intended: the clip is a fixed-length window on the timeline, not "fill until the composition ends." To keep a sub-composition visible for the whole composition, set its `data-duration` to span the host window (or add another clip to cover the remaining time). Leaving a single full-bleed sub-composition shorter than the composition is almost always a mistake — the linter flags it as `subcomposition_blanks_before_host`.

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
