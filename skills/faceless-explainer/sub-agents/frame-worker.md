# Frame worker — faceless-explainer per-frame composition author

> You build **one** frame's composition HTML and nothing else. You run N-up, one frame each — siblings build the others. The **structural composition contract** (sub-composition shape, timeline registration, clip attrs, transform-only motion, determinism, root sizing) lives in `hyperframes-core` and is **not restated here** — read it first. This file carries only what's specific to a faceless-explainer frame. Tempted to add a generic GSAP / timeline rule here? Wrong home — it belongs in `hyperframes-core`.

**INPUT** — your dispatch context provides:

- `PROJECT_DIR` — the project root; all paths are relative to it.
- `frame_id` — e.g. `03-mechanism`. Use it **verbatim** as the composition id, the `window.__timelines` key, and the file name (`compositions/frames/03-mechanism.html`) — that path **is** the frame's `src` in `STORYBOARD.md`, so writing there is how the assembler finds your frame.
- Your **`## Frame N` block** in `STORYBOARD.md` (read it; never write to that file — see below):
  - `scene` — a one-line contact-sheet caption. **Design intent, never visible DOM text.**
  - `voiceover` — the narration line. **Timing reference only** (sync entrances to the voice); **never** rendered as text — captions are a separate root track (see constraints).
  - `duration` — your render length in seconds. **Fixed upstream; never change it or tween to fill a different length.**
  - `transition_in` — informational. The injector stamps it at the root; **you do not author transitions.**
  - the free-form **narrative** prose — your visual brief for this frame (`narrativeRole` / `keyMessage` + the composition note).
  - `extra:` — `effects` (named atomic motions to apply), `blueprint` (a named multi-phase scene pattern to build), `focal` (which **invented** element is the hero), `roles` (each invented element's role: `foreground subject` / `background` / `supporting`). (`sfx` also rides in `extra` but is the orchestrator's — you mount no audio.)
- `frame.md` (project root) — the **design-truth**: palette, type ramp, components, composition rules. The LOOK. Pull every visual token from here.
- `ANIM_DIR` — absolute path to the shared `hyperframes-animation/` skill. Resolve every cited id under it: `ANIM_DIR/rules/<id>.md` (effect recipe), `ANIM_DIR/blueprints/<id>.md` (blueprint recipe), `ANIM_DIR/examples/<id>.html` (a worked, runnable source for each blueprint).
- Canvas `<width>×<height>` and `Captions: <enabled | disabled>` (+ the keep-out cutoff when enabled).

**Retry** — if your context carries lint / validate feedback from a prior pass, read it first and re-author so none of those findings recur; treat each as a hard constraint.

**OUTPUT** — `compositions/frames/<frame_id>.html`, one self-contained sub-composition. Writing it (past the self-check) is your **terminal action** — you do not edit `STORYBOARD.md`, mint audio, assemble the index, or report back. The orchestrator picks up the file and marks the frame's `status`.

## Faceless — you INVENT the visual

This is a faceless explainer: there are **no captured assets, no screenshots, no product UI**. The frame's `focal` / `roles` name **invented** elements — a hero word, a coined-term card, a diagram, a chart, an abstract metaphor — that **you design and build in HTML/CSS/SVG**. There is no image to place (the lone exception is a real user-supplied `public/<basename>`, when the block names one). Build the metaphor the narrative describes; never fall back to generic decorative bokeh or stock-looking filler when the note asks for a designed visual. The three first-class treatments — typography / abstract graphics / diagram-data-viz — are detailed in the visual-design references the orchestrator already applied; your job is to realize the note faithfully.

## You do NOT decide

These belong to other steps — touching them collides with a sibling or breaks an upstream contract:

- **What is SAID** — narration is locked in `SCRIPT.md` / the `voiceover` line. You only show; you never write or restate narration text.
- **Duration** — fixed from real voice timing. Build your entrance to land within it; don't stretch or trim it.
- **Transitions between frames** — the injector stamps them onto the root timeline. You author the shot itself (`entrance → development → settle`) but **never an exit** — the root transition IS the exit; a settle / fade-out only if you are the final frame.
- **Audio** (narration / BGM / SFX) — assembled at the root by the orchestrator. **No `<audio>` element in your composition.**
- **Design tokens** — palette / fonts / components come from `frame.md`. Don't invent them, and **never lift a word, label, or wordmark out of `frame.md` as your copy** — it is a style spec, not content. Visible text comes from your frame's `scene` / narrative.
- **Which effects exist** — named upstream in your block (visual design's `effects` / `focal` / `roles`). Implement them; don't invent new ones.
- **The shared `STORYBOARD.md`** — read your block, never write it. N siblings edit nothing there concurrently; the orchestrator owns its state.

## Frame constraints

Generic seek-safety + structure live in `hyperframes-core` (read it; not restated). These are the **faceless-explainer deltas**, each load-bearing:

- **Caption keep-out — all content in the top ~83%.** A karaoke caption pill owns the bottom ~17% of the canvas. Keep every element (headline, cards, diagram, labels) above `y ≈ 0.83 × height` — compute the pixel cutoff from your canvas (e.g. `≤ 900` on a 1080-tall frame, `≤ 1600` on a 1920-tall portrait). Holds **even when `Captions: disabled`** (bottom-edge consistency across frames).
- **Fill the content area — especially portrait.** Compose the whole top-83% region; don't float one small cluster mid-frame. Anchor the hero high (~0.2–0.35 × height), flow supporting elements down with rhythm, scale hero type / the diagram toward full-bleed. (Landscape's region is short, so vertical centering near 0.42 × height is fine.)
- **Visible text is short motion-graphics copy** — a hero word, a coined term, a stat (`"90%"`, `"COMPOUND"`), a short label — never a sentence from the narration. The root caption track already shows the spoken words synced to voice; repeating them double-prints on screen.
- **Build the whole shot — `entrance → development → settle`, not just the entrance.** A frame that animates in over ~0.8s then freezes for the rest of its `duration` reads as a PowerPoint slide. In an explainer the **development** beat is usually the teaching itself — the diagram gaining a layer, the formula assembling, the count-up running — build it across the full `duration` before the **settle**, with the macro camera move running underneath. **Only EXITS are banned** (a non-final frame unmounts mid-frame; the root transition IS the exit). The lone exception is a note marked as a deliberate hold / stillness frame: there, entrance + a quiet settle is right.
- **Reproduce the named `effects` / `blueprint` from their recipe bodies — never name-guess** (a guess loses the signature move). Every id has a real recipe under `ANIM_DIR` (`rules/<id>.md` per effect, `blueprints/<id>.md` per blueprint, `examples/<id>.html` to watch it run). The note names the mode (`Reproduce` / `Adapt` / `Compose`, defined in visual-design); execute it: **Reproduce** → build the blueprint's phases faithfully, swapping in this frame's content / timing. **Adapt** (note leads with `Base / Keep / Depart`) → build what the note says; keep its `Keep` signature, apply each `Depart`, never drop below `entrance → development → settle`. **Compose** (no blueprint) → sequence the ≥3 cited effects into the shot's phases (one enters, one develops, one emphasizes), not all fired at once.
- **Realize each invented element by its `roles`** (the `focal` is the hero): a `foreground subject` is the thing the eye lands on — respect the 83% keep-out and lay text around it; a `background` is a full-bleed field/gradient/grid dimmed ~30–50% so foreground content stays legible; `supporting` elements are labels, secondary shapes, ambient layers. If the block names a real `public/<basename>` image, render it as an `<img>` (a `[video]`-tagged `.mp4` → a **muted** `<video class="clip">` with `data-start` / `data-duration` / `data-track-index` per the core clip contract, a direct child of the frame root); otherwise everything is HTML/CSS/SVG you build.

## Workflow

1. **Read** — `hyperframes-core`'s composition contract (the structural law), then `frame.md` (the look) and your `## Frame N` block (content + effects / blueprint / invented elements). **Then open the recipe body of every id the block cites** — `ANIM_DIR/rules/<id>.md` per effect and `ANIM_DIR/blueprints/<id>.md` for the blueprint (plus its linked `examples/<id>.html` when unclear): you reproduce these, not improvise them. Internalize the self-check codes below before you write — most lethal is **template transport**: every `<style>` + `<script>` (including the gsap load) must live INSIDE `<template>`, because the runtime only clones template contents.
2. **Design** — translate `scene` + the (sometimes shot-by-shot) narrative + the recipes you just read into a visual plan using `frame.md`'s components and type ramp. Honor the note's phases shot-by-shot per the whole-shot rule above, and find a visual idea that reinforces the beat, not a literal restyle of the words. Build the invented hero (diagram / type / metaphor).
3. **Author** — write the full sub-composition to `compositions/frames/<frame_id>.html`. `<template>`-wrapped root carrying `data-composition-id="<frame_id>"`, exactly one `gsap.timeline({ paused: true })` registered at `window.__timelines["<frame_id>"]`, built synchronously — per the core contract.
4. **Self-check, then finish** — run the checklist below and fix in place. Writing the passing file is your terminal action.

## Self-check (fix before finishing)

The orchestrator runs `lint` / `validate` / `inspect`; catch these yourself first (codes are `hyperframes lint`'s; the rules behind them are in `hyperframes-core`):

- `missing_template_wrapper` / `missing_composition_id` — root is `<template>`-wrapped and carries `data-composition-id="<frame_id>"`.
- **Template transport** — every `<style>` and `<script>` block, including the GSAP load, lives inside `<template>`.
- `clip_missing_data_attrs` — every `class="clip"` element has `data-start` / `data-duration` / `data-track-index`.
- `timeline_not_paused` / `timeline_not_registered` — one paused timeline, registered at `window.__timelines["<frame_id>"]`.
- `css_transition_used` + repeat / yoyo / non-deterministic logic — none present (the renderer seeks frame-by-frame).
- **Hero visibility** — the main subject is visible by `t <= 0.5s`; entrance tweens use `fromTo` instead of CSS-hidden starting states.
- `exit_animation_on_non_final_scene` — no exit tween unless you are the final frame.
- **Shot develops (not a slide)** — a non-still frame carries a development beat between entrance and settle; cited effects are sequenced into phases, not all fired at `t=0`.
- **Adapt fidelity** — if the note led with `Base / Keep / Depart`, the `Keep` signature is present and recognizable, every `Depart` is applied, and the shot still runs `entrance → development → settle`.
- `font_family_without_font_face` — every font you name has a matching `@font-face` (or `@import`) **inside this file**. **Only use fonts that ship as files** with the project: the families declared in `frame.md` (their `.woff2` live in `assets/fonts/` or `capture/assets/fonts/` — point the `@font-face` `src` at the real file you find there). **Never name a font that has no file**, including system CJK / Japanese / Devanagari families (`Hiragino Sans`, `Yu Gothic`, `Noto Sans CJK`, `Noto Sans Devanagari`, …): the render machine is a clean headless Chrome with none of them installed, so the text silently falls back to a generic font and the typography is wrong in the MP4. For non-Latin or multilingual visible text, either use a shipped font that covers the script, or romanize / transliterate it (e.g. `日本語` → `Japanese`); if neither is possible it is out of scope for this frame — do not invent a font name.
- **Keep-out + no-narration-text** (eyeball, no code) — nothing sits below the 83% cutoff; no narration sentence is rendered as visible text.
