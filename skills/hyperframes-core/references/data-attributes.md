# Data Attributes Reference

Every HyperFrames composition uses `data-*` attributes to declare timing and structure to the framework. This is the full attribute table — pair with `tracks-and-clips.md` for the rules behind `data-track-index`.

## Composition Root

Every renderable composition needs one root element:

| Attribute                    | Required      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-composition-id`        | Yes           | Unique ID. Must match the animation registry key on `window.__timelines`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `data-width` / `data-height` | Yes           | Pixel frame size. Common values: `1920x1080`, `1080x1920`, `1080x1080`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `data-duration`              | Conditional\* | Render duration in seconds (total length / frame count), not the GSAP timeline length. **Read once at compile time, like `data-width` / `data-height`**: a static root `data-duration` is locked before scripts run, so a script (`root.setAttribute("data-duration", ...)`) or a `--variables`-driven value cannot change the render length. To vary length per render, author the root `data-duration` directly. (A clip's `data-duration` is different: re-read from the live DOM, so scripts/variables can drive it.) Only when the root omits `data-duration` does the renderer derive total length from the live DOM / timeline after scripts run. |
| `data-fps`                   | No            | Optional frame rate hint. CLI render flags can override output fps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `data-composition-variables` | No            | JSON array of variable declarations (on `<html>`). See `variables-and-media.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

\*`data-duration` is optional whenever the runtime can auto-infer duration: a registered GSAP timeline, a finite CSS animation, a finite WAAPI `element.animate()`, or a registered Lottie animation. It is **required** for Three.js (no auto-inference), for infinite/unbounded CSS or WAAPI animations, and for any composition with no GSAP timeline and no animation signal at all. `npx hyperframes lint` enforces this (`root_composition_missing_duration_source`). See `determinism-rules.md` → "Duration Contract For Non-GSAP Runtimes" for the per-runtime breakdown.

The root should be `position: relative`, have explicit pixel dimensions, and hide overflow unless intentionally composing outside the frame.

## Clip Attributes

Timed child elements are clips. **`class="clip"` is required on visible timed elements** (`<div>`, `<img>`, etc.) — without it the runtime keeps the element visible for the whole composition, ignoring `data-start` / `data-duration`. Omit on `<video>` (framework manages visibility directly) and `<audio>` (no visual).

**Visual clips (`class="clip"`) must be DIRECT children of the composition root.** A clip nested inside a wrapper `<div>` is not registered as a clip, so its `data-start`/`data-duration` are ignored and it stays visible the whole composition. To wrap/transform a clip, put the wrapper _inside_ the clip, or animate the clip element itself; do not wrap the clip. (This is a clip-_visibility_ rule. `<video>`/`<audio>` are exempt: the framework drives their playback via a flat DOM query, so they seek/decode at any depth, including inside a sub-comp `<template>` — see `variables-and-media.md`.)

| Attribute          | Required                                        | Meaning                                                                                                                           |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Yes                                             | Stable DOM ID for linting, timeline targets, and debugging.                                                                       |
| `data-start`       | Yes                                             | Start time in seconds, or a supported clip-time reference.                                                                        |
| `data-duration`    | Required for `div`, `img`, and sub-compositions | Duration in seconds. Video/audio can default to media duration when known.                                                        |
| `data-track-index` | Yes                                             | Timeline track. Clips on the same track must not overlap.                                                                         |
| `data-media-start` | No                                              | Offset into the media source, in seconds.                                                                                         |
| `data-volume`      | No                                              | Static audio volume, `0` to `1`, default `1`. For fades, animate `volume` on the timeline instead (see `variables-and-media.md`). |
| `data-has-audio`   | No (`<video>` only)                             | `"true"` to declare the video carries an audio track when auto-detection would miss it.                                           |

**Visibility window is inclusive of both ends.** A clip shows while `start ≤ t ≤ start + duration` — it still renders at exactly `t = start + duration`, so the final frame holds the animation's resolved end state (the runtime does not hide it one frame early). A reveal/entrance that lands on `data-duration` is therefore visible on the last frame; you do not need to finish it _before_ `data-duration` just to guarantee the end state renders. (Climax-dwell guidance in `/hyperframes-animation` is about pacing, not this boundary.)

## Sub-Composition Host Attributes

When a clip is a sub-composition host (loads another composition file):

| Attribute                    | Required | Meaning                                                                                                  |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `data-composition-id`        | Yes      | The internal composition ID of the loaded file.                                                          |
| `data-composition-src`       | Yes      | Path to the sub-composition HTML file.                                                                   |
| `data-width` / `data-height` | Yes      | Render dimensions for the sub-composition instance.                                                      |
| `data-variable-values`       | No       | Per-instance variable overrides as JSON. See `variables-and-media.md`.                                   |
| `data-var-src`               | No       | Binds the element's `src` to a declared variable id (media/image substitution, authored src = fallback). |
| `data-var-text`              | No       | Binds the element's own text to a scalar variable id; children are preserved.                            |

See `sub-compositions.md` for the full wiring pattern.

## Authoring Hints

- `id="root"` — template convention used by scaffolds and the transition catalog so CSS can target the composition root with `#root` instead of `[data-composition-id="main"]`. Not required by the runtime, but consistent with the rest of the ecosystem.
- `class="clip"` — required runtime visibility marker on visible timed elements (`<div>`, `<img>`, …). See Clip Attributes above.
- `data-layout-allow-overflow` — tells `hyperframes check` that overflow on this element (or its descendants) is intentional. Notes:
  - The `check` layout audit measures `getBoundingClientRect` at sampled timestamps, not rendered pixels. `overflow: hidden` clips the visual but does **not** suppress a layout finding. This attribute is the escape hatch; CSS overflow is not.
  - Can be set on the composition **root** as well as on any child. When the cited offender is `div.<comp>-root inside div.<comp>-root` (the root reports its own children's union as overflowing), the fix goes on the root, not on individual text descendants — shrinking font sizes will not converge.
  - In a multi-scene `group_wN.html` (continue runs), every scene-local element stays in the DOM during the other scenes' time windows; the layout-box union almost always overflows the canvas during morph seams. Mark the root and every scene-local primary/supporting element with this attribute **at construction**, not after `check` flags it.
  - **Blast radius — it silences more than the overflow audit.** The attribute is inherited down the subtree (the perception probe walks ancestors), so it also suppresses the rendered-perception checks `text-clipping`, `content-cramped-container`, and `foreground-over-panel` for every descendant. Putting it on a persistent panel that also hosts real foreground content disables collision checks on that content for the panel's whole lifetime. Prefer the narrowest opt-out: scope it to the smallest decorative wrapper, or use per-element `data-layout-bleed="true"` for one intentional primary-text crop. The two canvas/edge checks `primary-offscreen` and `foreground-over-panel` deliberately run **even under** allow-overflow, so it cannot hide a wordmark sliced by the frame or text bleeding onto a panel edge.
- `data-layout-ignore` — exclude this element from layout audits entirely.

## Legacy / Removed Attributes

These names appear in older projects and examples. Use the current names when authoring or editing:

| Legacy name  | Use instead        |
| ------------ | ------------------ |
| `data-layer` | `data-track-index` |
| `data-end`   | `data-duration`    |
