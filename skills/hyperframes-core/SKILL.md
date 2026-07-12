---
name: hyperframes-core
description: The HyperFrames composition contract — build one renderable project. Use for composition structure, the `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, deterministic-render rules, and validation. Also covers Tailwind projects and the STORYBOARD.md / SCRIPT.md plan formats. Read before writing composition HTML.
---

# HyperFrames Core

HyperFrames renders video from HTML. A composition is an HTML file whose DOM declares timing with `data-*` attributes, whose animation runtime is seekable, and whose media playback is owned by the framework.

This skill is the **technical contract** — how to build one hyperframes project. The body below is the build guide; per-topic detail lives in `references/` (index next), read on demand. Other concerns live in the sibling domain skills — `hyperframes-animation`, `hyperframes-creative`, `media-use`, `hyperframes-cli`, `hyperframes-registry`. The capability map in `/hyperframes` says what each one covers.

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
| `references/brief-contract.md`       | conduct a creation workflow's intake — interaction mode (collaborative / autonomous), shared brief fields, asking rules |
| `references/script-format.md`        | author the optional `SCRIPT.md` locked narration                                                                        |
| `references/subagent-dispatch.md`    | map subagent dispatch verbs (parallel fan-out / background / wait) to your harness                                      |
| `references/tailwind.md`             | work in a Tailwind v4 project (`init --tailwind`; runtime contract differs from Studio's v3)                            |

For animation runtime specifics (GSAP API, Lottie, Three.js, etc.) go to `hyperframes-animation` → `adapters/<runtime>.md`.

## Building a composition

### Two root forms (not interchangeable)

- **Standalone** (top-level `index.html`) — root `<div data-composition-id="…">` sits directly in `<body>`, **no `<template>` wrapper** (wrapping it hides all content and breaks rendering).
- **Sub-composition** (loaded via `data-composition-src`) — root **must** be wrapped in `<template>`.

> ⚠ Transport rule: the runtime **only clones `<template>` contents**; everything outside (incl. `<head>` styles/scripts) is discarded — put `<style>`/`<script>` **inside** the template.
> ⚠ Host-id rule: the host slot's `data-composition-id` must **exactly equal** the inner template's `data-composition-id` **and** the `window.__timelines["<id>"]` key — no `-mount`/`-slot`/`-host` suffix.

File shape, host wiring, and the pre-render checklist → `references/sub-compositions.md`.

### Root must be sized (silent layout bug)

The standalone root needs an explicit **sized box** (`width`/`height` in px), and every ancestor down to a `height:100%` element must have a resolved height — otherwise a flex/`100%` child collapses to ~0 and content piles into the top-left corner. `lint`/`validate`/`inspect` do **not** catch this. Skeleton → `references/minimal-composition.md`.

### One paused timeline

Each composition registers **exactly one** `gsap.timeline({ paused: true })` at `window.__timelines["<id>"]` (key = root `data-composition-id`), built **synchronously** at page load. Render duration = root `data-duration`, not timeline length. Don't manually nest sub-timelines into the host. Full contract (incl. non-GSAP runtimes) → `references/determinism-rules.md` + `hyperframes-animation/adapters/`.

### Non-negotiable rules (silent bugs `lint`/`validate`/`inspect` won't catch)

Surfaced here; full rationale in the linked reference. Do not violate:

- No render-time clocks / unseeded `Math.random` / network / input-state; no `repeat: -1` (use a finite count). → `determinism-rules.md`
- Animate only the visual-property allowlist; never `display`/`visibility`; no `gsap.set` on later-scene clips. → `determinism-rules.md`
- No `<br>` in body text; transformed elements must be block-level + sized; pulsing absolute decoratives need peak clearance. → `determinism-rules.md`
- `<video>`/`<audio>` must be a **direct child of the host root** (never inside a sub-comp `<template>`/wrapper); the framework owns playback. → `variables-and-media.md`
- Every `id` must be unique across the **assembled** page; inside a sub-comp, prefix ids with the composition id (`#<id>-hero`). Duplicate `<video>`/`<img>` ids render **blank** — the producer injects frames by `getElementById`, and cross-file dupes slip past `lint`. → `composition-patterns.md`
- A full-screen scene fill goes on a full-bleed **child** (`position:absolute; inset:0`), never on the composition root itself — the producer's frame compositing can drop the root element's own `background` (the frame renders **black**) even though preview/`snapshot` show it correctly. → `composition-patterns.md`

## Editing existing compositions

- Read the files first. Preserve unrelated timing, tracks, IDs, variables, media paths.
- Match existing composition IDs and timeline keys.
- Adding a clip: pick a non-overlapping `data-track-index` or adjust surrounding timing intentionally.
- `data-hidden` on any composition element hides it in BOTH preview and render, overriding its time window; it is non-destructive/reversible and toggled by Studio's timeline eye icon.
- Adding a sub-composition: verify its internal `data-composition-id` before wiring the host.

## Validation

Use `hyperframes-cli` for command details

- [ ] `npx hyperframes check` passes (0 findings across lint, runtime, layout, motion, and contrast)
- [ ] Projects with sub-compositions: `npx hyperframes snapshot --at <midpoints>` and eyeball each frame
- [ ] `npx hyperframes preview` for review (the user can edit anything in Studio's timeline)
- [ ] `npx hyperframes render` only after the user approves
