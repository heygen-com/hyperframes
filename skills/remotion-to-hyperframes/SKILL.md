---
name: remotion-to-hyperframes
description: 'Port an existing Remotion (React) composition''s source to HyperFrames HTML. Use ONLY on an explicit ask to port/convert/migrate/translate a Remotion source — one-way, Remotion-only. A passing Remotion mention, reference-only code, or "make something like my Remotion video" is a fresh build (/general-video). Unclear → /hyperframes.'
---

# Remotion to HyperFrames

> **Confirm the route before you build.** Use this **only** to port an existing **Remotion** (React) composition's source into HyperFrames. Authoring a **new** composition (even one inspired by a Remotion video) → the creation workflows / `/general-video`. **Out of scope** (one-way, Remotion-only): no reverse export (HyperFrames → Remotion or any framework), and a **non-Remotion** source (After Effects, Framer Motion, plain React / CSS) has no Remotion source to translate → re-create via `/general-video`. Unsure, or only a passing Remotion mention? **Read `/hyperframes` first.**

## Overview

Translate Remotion (React-based) video compositions into HyperFrames (HTML + GSAP) compositions. Most Remotion idioms have direct HyperFrames equivalents — the translation is mechanical for ~80% of typical compositions. This skill encodes the mapping and guards against the lossy 20% by refusing to translate patterns that don't fit HF's seek-driven model and recommending the runtime interop pattern from [PR #214](https://github.com/heygen-com/hyperframes/pull/214) instead.

The skill ships with a **tiered test corpus** (T1–T4, 4 fixtures total) that grades translations against measured SSIM thresholds. Don't translate without running the eval — a translation that "looks right" but renders 0.05 SSIM lower than the validated baseline is silently wrong.

## When to use

**Use this skill ONLY when the user explicitly asks to migrate from Remotion.** Example trigger phrases:

- "port my Remotion project to HyperFrames"
- "convert this Remotion code to HyperFrames"
- "migrate from Remotion"
- "translate this Remotion comp"
- "rewrite this as HyperFrames HTML"

**Do NOT use this skill when:**

- (a) The user is authoring a **new** HyperFrames composition, even if they have or are A/B-testing a similar Remotion video.
- (b) The user mentions Remotion in passing without asking for migration.
- (c) The user shares Remotion code as reference material rather than asking for a translation.
- (d) The user asks for "the same video as my Remotion one" without explicitly asking to migrate the source — treat that as a fresh HyperFrames build.

**NOT SUPPORTED (decline — this is not what this skill does):**

- **The reverse direction.** Exporting a HyperFrames composition back out _to_ Remotion (or to any other framework) is not a workflow — the translation is Remotion → HyperFrames only. Say so plainly.
- **Non-Remotion sources.** An After Effects project (`.aep`), a Framer Motion / plain-React / CSS animation, or any other tool's source is not a Remotion composition — there is no Remotion source to translate. Re-create it natively via `/general-video`, or decline if HyperFrames can't represent it.

When in doubt, default to authoring a native HyperFrames composition with `/general-video` (the general HyperFrames authoring flow) instead.

## Workflow

### Step 1: Lint the source

Run [`scripts/lint_source.py`](scripts/lint_source.py) over the Remotion source directory. The lint detects patterns that can't translate cleanly:

- **Blockers** (refuse + recommend interop): `useState`, `useReducer`, `useEffect`/`useLayoutEffect` with non-empty deps, async `calculateMetadata`, third-party React UI libraries (MUI, Chakra, Mantine, antd, shadcn, Radix, NextUI).
- **Warnings** (translate after dropping the construct): `@remotion/lambda` config, `delayRender`, `useCallback`, `useMemo`, custom hooks.
- **Info** (translate with note): `staticFile`, `interpolateColors`.

If any blocker fires, **stop**. Read [`references/escape-hatch.md`](references/escape-hatch.md) and surface the recommendation message. Warnings don't stop translation — drop the offending construct in step 3 and note the gap in `TRANSLATION_NOTES.md`. `@remotion/lambda` config is the canonical warning case: the skill drops the import + `renderMediaOnLambda(...)` calls but translates the rest of the composition.

### Step 2: Plan the translation

Read [`references/api-map.md`](references/api-map.md) — the index of every Remotion API and its HF equivalent or per-topic reference. Identify which topic references you'll need based on what the source uses:

| Source contains                                                           | Load reference                                |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `Composition`, `defaultProps`, `schema`, `calculateMetadata`              | [`parameters.md`](references/parameters.md)   |
| `Sequence`, `Series`, `Loop`, `AbsoluteFill`, `Freeze`                    | [`sequencing.md`](references/sequencing.md)   |
| `useCurrentFrame`, `interpolate`, `spring`, `Easing`, `interpolateColors` | [`timing.md`](references/timing.md)           |
| `Audio`, `Video`, `Img`, `IFrame`, `staticFile`, `delayRender`            | [`media.md`](references/media.md)             |
| `TransitionSeries`, `@remotion/transitions`                               | [`transitions.md`](references/transitions.md) |
| `@remotion/lottie`                                                        | [`lottie.md`](references/lottie.md)           |
| `@remotion/google-fonts/<Family>`, `Font.loadFont`, `@font-face`          | [`fonts.md`](references/fonts.md)             |

Don't load all of them — load only what the specific source needs.

### Step 3: Generate the HF composition

Emit `index.html` with:

- Root `<div id="stage">` carrying the composition's `data-composition-id`, `data-start="0"`, `data-duration` (in seconds), `data-fps`, `data-width`, `data-height`, plus one `data-*` per scalar prop.
- A flat list of scene divs with `data-start` / `data-duration` / `data-track-index`.
- Inline `<style>` for layout; CSS sets the `from` state of every animated property.
- A single `<script>` tag at the bottom containing one paused `gsap.timeline({paused: true})`. Every Remotion `useCurrentFrame()` derivation becomes a tween on this timeline at the right offset.
- `window.__timelines["<composition-id>"] = tl;` registers the timeline with HF's runtime.

Custom React subcomponents inline as repeated HTML using the prop interface as the template (see [`parameters.md`](references/parameters.md) for the per-instance `data-*` pattern).

### Step 4: Validate

Run the eval harness — [`references/eval.md`](references/eval.md) for the full guide. Quick path:

```bash
# Render Remotion baseline (after npm install in the fixture)
cd remotion-src && npx remotion render <CompositionId> out/baseline.mp4

# Render HF translation
cd ../hf-src && npx hyperframes render --skill=remotion-to-hyperframes --output ../hf.mp4

# SSIM diff
../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
```

Threshold: ~0.02 below `p05` of the source's complexity tier (see `eval.md`'s validated thresholds table). If the diff fails, run [`scripts/frame_strip.sh`](scripts/frame_strip.sh) to see _which_ frames diverged, then re-read the relevant timing/sequencing/media reference.

**Critical**: both renders must use matching pixel format. Set `Config.setVideoImageFormat("png")` + `Config.setColorSpace("bt709")` in the Remotion source's `remotion.config.ts` — otherwise the diff measures encoder differences (~0.05 SSIM hit), not translation fidelity.

### Step 5: Document gaps

Anything that didn't translate cleanly (volume ramps dropped, custom presentations approximated, fonts substituted) gets a `TRANSLATION_NOTES.md` written next to the HF output. See [`references/limitations.md`](references/limitations.md) for the format.

## What this skill explicitly does NOT do

- **Translate React state machines.** Compositions that drive animation via `useState` + `useEffect` are not deterministic frame-capture targets in HyperFrames' seek-driven model. Recommend the runtime interop pattern.
- **Run Remotion's render pipeline alongside HyperFrames.** That's the runtime interop pattern from [PR #214](https://github.com/heygen-com/hyperframes/pull/214) — a separate solution for compositions that fail this skill's lint.

(`@remotion/lambda` is _not_ a blocker — Lambda config is deployment, not animation. The skill drops it as a warning and translates the rest. See [`references/escape-hatch.md`](references/escape-hatch.md).)

## How to grade your own translation

Run the test corpus orchestrator:

```bash
./assets/test-corpus/run.sh
```

It runs T1, T2, T3 (render + diff) and T4 (lint validation), prints a per-tier pass/fail table, and emits an aggregate JSON report. Use this to verify the skill is working end-to-end on a clean checkout — and as a regression check after editing any reference.

Validated baseline (as of 2026-04-27):

| Tier | Composition shape                           | Mean SSIM | Threshold |
| ---- | ------------------------------------------- | --------- | --------- |
| T1   | single-element fade-in                      | 0.974     | 0.95      |
| T2   | multi-scene + spring + audio + image        | 0.985     | 0.95      |
| T3   | data-driven, custom subcomponents, count-up | 0.953     | 0.90      |
| T4   | escape-hatch (8 lint cases)                 | 8/8 pass  | n/a       |
