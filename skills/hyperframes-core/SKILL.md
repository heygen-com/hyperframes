---
name: hyperframes-core
description: The HyperFrames composition contract — build one renderable project. Use for composition structure, the `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, deterministic-render rules, and validation. Also covers Tailwind projects and the STORYBOARD.md / SCRIPT.md plan formats. Read before writing composition HTML.
---

# HyperFrames Core

HyperFrames renders video from HTML. A composition is an HTML file whose DOM declares timing with `data-*` attributes, whose animation runtime is seekable, and whose media playback is owned by the framework.

This skill is the **technical contract** — how to build one hyperframes project. The body below is the build guide; per-topic detail lives in `references/` (index next), read on demand. Other concerns live in the sibling domain skills — `hyperframes-animation`, `hyperframes-creative`, `media-use`, `hyperframes-cli`, `hyperframes-registry`. The capability map in `/hyperframes` says what each one covers.

## References

| File                                    | Read it to…                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references/minimal-composition.md`     | start from the smallest renderable composition skeleton                                                                                                                            |
| `references/composition-patterns.md`    | choose monolithic vs modular; structure a modular `index.html`; pick a sub-comp archetype                                                                                          |
| `references/data-attributes.md`         | look up any `data-*` (root / clip / sub-comp host / legacy aliases); use `class="clip"`                                                                                            |
| `references/tracks-and-clips.md`        | understand what `data-track-index` does (and does not) control, z-index, time a clip relative to another                                                                           |
| `references/creator-editing-recipes.md` | copy truthful cut/trim/reorder/retime/freeze/camera/mask/crossfade/audio editing recipes and their limits                                                                          |
| `references/sub-compositions.md`        | wire a sub-composition (host attrs, `<template>`, per-instance vars) and animate inside it                                                                                         |
| `references/variables-and-media.md`     | declare variables; place `<video>`/`<audio>`, set volume, trim                                                                                                                     |
| `references/determinism-rules.md`       | build a seekable timeline; determinism bans; layout / text fit                                                                                                                     |
| `references/full-screen-motion.md`      | author full-frame motion with shared backgrounds                                                                                                                                   |
| `references/storyboard-format.md`       | author a `STORYBOARD.md` plan (+ the parsed manifest)                                                                                                                              |
| `references/review-loop.md`             | run the plan → sketch → build review passes on a live board — shared by every storyboard-planning workflow                                                                         |
| `references/production-loop.md`         | take an approved plan to a delivered video — the stage dependencies (audio, frames, assembly, transitions, captions, verify, deliver) a freeform build follows directly            |
| `references/brief-contract.md`          | the brief's ground rules — mode derivation (collaborative / autonomous), shared field registry, question invariants (the asking itself lives in `/hyperframes` → the intent layer) |
| `references/brief-format.md`            | author `BRIEF.md` — the confirmed intent document a workflow's Setup writes and every later step reads                                                                             |
| `references/script-format.md`           | author the optional `SCRIPT.md` locked narration                                                                                                                                   |
| `references/subagent-dispatch.md`       | map subagent dispatch verbs (parallel fan-out / background / wait) to your harness                                                                                                 |
| `references/frame-worker-core.md`       | the shared frame-worker role contract — each narrative workflow's packet builder prepends it to that workflow's `sub-agents/frame-worker.md` delta                                 |
| `references/tailwind.md`                | work in a Tailwind v4 project (`init --tailwind`; runtime contract differs from Studio's v3)                                                                                       |

For animation runtime specifics (GSAP API, Lottie, Three.js, etc.) go to `hyperframes-animation` → `adapters/<runtime>.md`.

## Building a composition

### Two root forms (not interchangeable)

- **Standalone** (top-level `index.html`): root `<div data-composition-id="…">` sits directly in `<body>`, **no `<template>` wrapper**. Wrapping a standalone root hides all content and `lint` rejects it (`standalone_composition_wrapped_in_template`, error).
- **Sub-composition** (loaded via `data-composition-src`): wrap the root in `<template>`. This is the shape to write: the loader also accepts a plain full document and falls back to its `<body>`, but the templated form is what the examples and tooling assume.

> ⚠ Transport rule: for a **templated** sub-composition the assembler drops the file's own `<head>` `<style>`/`<script>` (`packages/core/src/compiler/compositionAssembly.ts`, the `hasTemplate` gate), so put `<style>`/`<script>` **inside** the template. `<link>` is hoisted either way.
> ⚠ Host-id convention: give the host slot, the inner template, and the `window.__timelines["<id>"]` key the **same** id. A different local id is supported (the assembler falls back to the first root in the file) but the mismatch is silent, so match them unless you have a reason not to.

File shape, host wiring, and the pre-render checklist → `references/sub-compositions.md`.

### Root must be sized (silent layout bug)

The standalone root needs an explicit **sized box** (`width`/`height` in px), and every ancestor down to a `height:100%` element must have a resolved height — otherwise a flex/`100%` child collapses to ~0 and content piles into the top-left corner. Do not rely on automated gates alone to catch this; inspect a snapshot. Skeleton → `references/minimal-composition.md`.

### One paused timeline

Each composition registers **exactly one** `gsap.timeline({ paused: true })` at `window.__timelines["<id>"]` (key = root `data-composition-id`). Building it inside an async callback (`document.fonts.ready`) is supported; what matters is that you **register only after the build completes**. Render length is the root's `data-duration`, **not** the timeline's length: a timeline that runs past it is cut off, and one that ends early holds its last frame. Omit the root `data-duration` and the length is inferred instead (timeline, media window, or adapter). You do not need `window.__timelines = window.__timelines || {}`: the runtime creates the registry before your inline scripts run, and `lint` no longer asks for it. Don't manually nest sub-timelines into the host; the runtime auto-nests registered child timelines. Full contract (incl. non-GSAP runtimes) → `references/determinism-rules.md` + `hyperframes-animation/adapters/`.

### First-pass lint gotchas (a guaranteed first build failure)

Rules that `lint` **does** catch, but only after the fact. Write them right the first time:

- Never pair a CSS initial `transform` with a GSAP tween on the **same** property — the CSS value and the tween's start fight and `lint` rejects it with `gsap_css_transform_conflict`. Set the initial state inside the tween with `gsap.fromTo(el, { x: -40 }, { x: 0 })` instead of a CSS `transform: translateX(-40px)`.
- Never put `crossorigin` on `<video>`/`<audio>`. `lint` rejects it unconditionally with `media_crossorigin_breaks_preview` (error), including for canvas/WebGL/WebAudio readback. There is no suppression.
- Never give a `<video data-start>` an ancestor that also carries `data-start`. `lint` rejects it with `video_nested_in_timed_element` (error). Time the wrapper **or** the video, not both.
- Every `<audio>` needs an `id`. `lint` rejects it with `media_missing_id`, and an id-less `<audio>` is never picked up by the mixer, so the render is **silent**.

A lint **error** also switches off the layout and contrast audits: `check` then reports `0 sample(s)` and `0/0 text checks`, which reads like a clean file but means nothing ran. Clear lint errors before you trust those numbers.

### Non-negotiable rules (silent bugs automated gates may miss)

Surfaced here; full rationale in the linked reference. Do not violate:

- No render-time clocks / unseeded `Math.random` / network / input-state; no `repeat: -1` (use a finite count). → `determinism-rules.md`
- Never tween `display` or raw `visibility` on a clip element. The framework owns clip visibility, and `lint` rejects it. Use GSAP `autoAlpha` or a zero-duration boundary `set`. (Tweening ordinary visual properties on a clip element is fine; what lint forbids is taking over its visibility.) → `determinism-rules.md`
- No `<br>` in body text; transformed elements must be block-level + sized; pulsing absolute decoratives need peak clearance. → `determinism-rules.md`
- `<video>`/`<audio>` are found by a flat document query, so the framework seeks and decodes them at **any nesting depth** (including inside a sub-comp `<template>` or wrapper). One hard limit: `lint` errors if a `<video data-start>` sits inside another **plain** element that also has `data-start`, and the failure is real (wrong source frames, then the clip vanishes mid-slot), so put the timing on the wrapper or on the video, never both. Sub-composition hosts are exempt: media inside a sub-composition renders correctly. The other caveat is timelines, not placement: a sub-comp timeline can't animate host-root elements. → `variables-and-media.md`
- Keep every `id` unique across the **assembled** page (prefix sub-comp ids with the composition id, `#<id>-hero`) so your own `#id` CSS and `getElementById` calls resolve. Frame injection no longer depends on it: the compiler stamps a document-unique `data-hf-render-id` on every `video[src]`/`audio[src]`/`img[src]`. Media that uses `<source>` children instead of a `src` attribute is **not** stamped, so unique ids still matter there. → `composition-patterns.md`
- A full-screen fill on the composition **root** is fine on a normal render. It is dropped only on the layered-composite path (HDR content, or a composition using shader transitions), where the engine forces every composition root transparent so the layer beneath shows through. If your composition uses shader transitions or HDR media, put the fill on a full-bleed **child** (`position:absolute; inset:0`). → `composition-patterns.md`

## Editing existing compositions

- Read the files first. Preserve unrelated timing, tracks, IDs, variables, media paths.
- Match existing composition IDs and timeline keys.
- Adding a clip: set its `data-start`/`data-duration` intentionally against the clips around it. `data-track-index` is a Studio display lane, not a timing constraint, so it does not need to be free.
- `data-hidden` on any composition element hides it in BOTH preview and render, overriding its time window; it is non-destructive/reversible and toggled by Studio's timeline eye icon.
- Adding a sub-composition: verify its internal `data-composition-id` before wiring the host.

## Validation

Use `hyperframes-cli` for command details

- [ ] `npx hyperframes check` passes (0 findings across lint, runtime, layout, motion, and contrast)
- [ ] Projects with sub-compositions: `npx hyperframes snapshot --at <midpoints>` and eyeball each frame
- [ ] `npx hyperframes preview --background` for review (the user can edit anything in Studio's timeline, and the server survives the invoking command)
- [ ] `npx hyperframes render` only after the user approves
