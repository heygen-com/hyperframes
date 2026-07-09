---
name: hyperframes-core
description: The HyperFrames composition contract - build one renderable project. Use for composition structure, the `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, deterministic-render rules, and validation. Also covers Tailwind projects and the STORYBOARD.md / SCRIPT.md plan formats. Read before writing composition HTML.
---

# HyperFrames Core

HyperFrames renders video from HTML. A composition is an HTML file whose DOM declares timing with `data-*` attributes, whose animation runtime is seekable, and whose media playback is owned by the framework.

This skill is the **technical contract**: how to build one hyperframes project. The body below is the build guide; per-topic detail lives in `references/` (index next), read on demand. Other concerns live in the sibling domain skills: `hyperframes-animation`, `hyperframes-creative`, `media-use`, `hyperframes-cli`, `hyperframes-registry`. The capability map in `/hyperframes` says what each one covers.

## References

| File                                 | Read it to…                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `references/minimal-composition.md`  | start from the smallest renderable composition skeleton                                                                 |
| `references/composition-patterns.md` | choose monolithic vs modular; structure a modular `index.html`; pick a sub-comp archetype                               |
| `references/data-attributes.md`      | look up any `data-*` (root / clip / sub-comp host / legacy aliases); use `class="clip"`                                 |
| `references/tracks-and-clips.md`     | pick `data-track-index`, handle same-track overlap / z-index, time a clip relative to another                           |
| `references/sub-compositions.md`     | wire a sub-composition (host attrs, `<template>`, per-instance vars) and animate inside it                              |
| `references/variables-and-media.md`  | declare variables; place `<video>`/`<audio>`, set volume, trim                                                          |
| `references/determinism-rules.md`    | build a seekable timeline; determinism bans; the animatable-property allowlist; layout / text fit                       |
| `references/full-screen-motion.md`   | author full-frame motion with shared backgrounds                                                                        |
| `references/storyboard-format.md`    | author a `STORYBOARD.md` plan (+ the parsed manifest)                                                                   |
| `references/brief-contract.md`       | conduct a creation workflow's intake - interaction mode (collaborative / autonomous), shared brief fields, asking rules |
| `references/script-format.md`        | author the optional `SCRIPT.md` locked narration                                                                        |
| `references/subagent-dispatch.md`    | map subagent dispatch verbs (parallel fan-out / background / wait) to your harness                                      |
| `references/tailwind.md`             | work in a Tailwind v4 project (`init --tailwind`; runtime contract differs from Studio's v3)                            |

For animation runtime specifics (anime.js API, GSAP, Lottie, Three.js, etc.) go to `hyperframes-animation` -> `adapters/<runtime>.md`.

## Building a composition

### Two root forms (not interchangeable)

- **Standalone** (top-level `index.html`): root `<div data-composition-id="...">` sits directly in `<body>`, **no `<template>` wrapper** (wrapping it hides all content and breaks rendering).
- **Sub-composition** (loaded via `data-composition-src`): root **must** be wrapped in `<template>`.

> Transport rule: the runtime **only clones `<template>` contents**; everything outside (incl. `<head>` styles/scripts) is discarded. Put `<style>`/`<script>` **inside** the template.
> Host-id rule: the host slot's `data-composition-id` must **exactly equal** the inner template's `data-composition-id` **and** the runtime registration key, for example `hyperframesAnime.register("<id>", tl, ...)`. Do not add `-mount`/`-slot`/`-host` suffixes.

File shape, host wiring, and the pre-render checklist → `references/sub-compositions.md`.

### Root must be sized (silent layout bug)

The standalone root needs an explicit **sized box** (`width`/`height` in px), and every ancestor down to a `height:100%` element must have a resolved height - otherwise a flex/`100%` child collapses to ~0 and content piles into the top-left corner. `lint`/`validate`/`inspect` do **not** catch this. Skeleton → `references/minimal-composition.md`.

### One paused timeline

Anime.js is the first-party default. Each composition builds its seekable timeline **synchronously** at page load, keeps it paused with `anime.createTimeline({ autoplay: false })`, and registers it with `hyperframesAnime.register("<id>", tl, { labels })`, where `<id>` equals the root `data-composition-id`. The labels map uses seconds, while anime.js `.add(..., position)` positions are milliseconds.

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });
  tl.add(".hero", { opacity: [0, 1], duration: 600 }, 0);
  hyperframesAnime.register("main", tl, { labels: { intro: 0 } });
</script>
```

Prefer an explicit root `data-duration`. If omitted, HyperFrames infers length from the longest finite registered anime.js instance. GSAP remains supported as a non-default adapter; use `hyperframes-animation/adapters/gsap.md` when authoring GSAP-specific compositions. Full contract -> `references/determinism-rules.md` + `hyperframes-animation/adapters/`.

### Non-negotiable rules (silent bugs `lint`/`validate`/`inspect` won't catch)

Surfaced here; full rationale in the linked reference. Do not violate:

- No render-time clocks / unseeded `Math.random` / network / input-state; finite loops only unless root `data-duration` is explicit. -> `determinism-rules.md`
- Animate only the visual-property allowlist; never `display`/`visibility`; avoid immediate runtime setters on later-scene clips. -> `determinism-rules.md`
- No `<br>` in body text; transformed elements must be block-level + sized; pulsing absolute decoratives need peak clearance. -> `determinism-rules.md`
- `<video>`/`<audio>` must be a **direct child of the host root** (never inside a sub-comp `<template>`/wrapper); the framework owns playback. -> `variables-and-media.md`
- Every `id` must be unique across the **assembled** page; inside a sub-comp, prefix ids with the composition id (`#<id>-hero`). Duplicate `<video>`/`<img>` ids render **blank** because the producer injects frames by `getElementById`, and cross-file dupes slip past `lint`. -> `composition-patterns.md`
- A full-screen scene fill goes on a full-bleed **child** (`position:absolute; inset:0`), never on the composition root itself. The producer's frame compositing can drop the root element's own `background` (the frame renders **black**) even though preview/`snapshot` show it correctly. -> `composition-patterns.md`

## Editing existing compositions

- Read the files first. Preserve unrelated timing, tracks, IDs, variables, media paths.
- Match existing composition IDs and timeline keys.
- Adding a clip: pick a non-overlapping `data-track-index` or adjust surrounding timing intentionally.
- `data-hidden` on any composition element hides it in BOTH preview and render, overriding its time window; it is non-destructive/reversible and toggled by Studio's timeline eye icon.
- Adding a sub-composition: verify its internal `data-composition-id` before wiring the host.

## Validation

Use `hyperframes-cli` for command details

- [ ] `npx hyperframes lint` passes (0 errors)
- [ ] `npx hyperframes validate` passes (0 console errors)
- [ ] `npx hyperframes inspect` passes (0 errors)
- [ ] Projects with sub-compositions: `npx hyperframes snapshot --at <midpoints>` and eyeball each frame
- [ ] `npx hyperframes preview` for review (the user can edit anything in Studio's timeline)
- [ ] `npx hyperframes render` only after the user approves
