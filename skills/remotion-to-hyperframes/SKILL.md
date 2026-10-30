---
name: remotion-to-hyperframes
description: Bring existing video code or footage into HyperFrames and verify it frame by frame against the original - Remotion first, also Motion Canvas, Lottie, Three.js, p5.js, canvas or plain HTML/CSS animation, or renders from Manim, After Effects or Blender. Use to port, convert, migrate or reuse work made with another tool.
---

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin.

# Import into HyperFrames

HyperFrames is the container: its tracks, sub-compositions and variables are editable in Studio whatever runs inside a clip. Bring each part in at the highest level it supports and record which level you used.

| Level | For | How | Editable in Studio afterwards |
| --- | --- | --- | --- |
| Native | code that can become HTML + GSAP: most Remotion, HTML/CSS/GSAP animation, simple Motion Canvas | translate it, then verify frame by frame | every element; variables, catalog, presets apply |
| Hosted | code that can draw any requested frame in a browser: canvas, p5.js, Three.js, Lottie, WebGL, other JS animation | keep the code and drive it from HyperFrames time | timing, position, exposed parameters |
| Media | anything that outputs video or frames: Manim, After Effects, Blender, PIL, moviepy | render to a file and use it as a clip | cut, place, layer; not the pixels inside |

Code that depends on wall-clock time, live physics or the network can only come in as media.

## Native: translate, then verify

1. For Remotion, run `python3 <SKILL_DIR>/scripts/lint_source.py <source dir>` first. Blockers (`useState`, `useReducer`, `useEffect` with dependencies, async `calculateMetadata`, React UI kits such as MUI, Chakra, Mantine, antd, shadcn, Radix, NextUI) don't translate: host them or refactor them out, never approximate (`references/escape-hatch.md`). Warnings (`@remotion/lambda` config, `delayRender`, `useMemo`, custom hooks) are dropped and noted.
2. Translate to the `/hyperframes` contract: one sub-composition per scene, times in seconds (`frame / fps`), asset paths root-relative. Each Remotion API's equivalent is in `references/api-map.md`. Put Remotion's render-page rule `* { box-sizing: border-box; }` once in the root `index.html` `<style>`: without it every bordered or padded element grows by its border and padding.
3. Keep it editable: the source's props become `data-composition-variables` bound with `data-var-text`, `data-var-src` or `var(--id)`; each `Sequence` becomes a timed clip or a sub-composition; a reused component becomes one sub-composition mounted several times with `data-variable-values`.
4. Compare frame by frame: `npx hyperframes snapshot --at <t,…> --against <original.mp4>` saves the original's frame at each time next to yours. Sample every scene and both sides of every cut; look for one late or recoloured element, not only the overall picture. For a scored check, `scripts/render_diff.sh <original.mp4> <hf.mp4> <out>` gives SSIM per frame and `scripts/frame_strip.sh` shows which frames diverged (thresholds per complexity tier in `references/eval.md`). Render the Remotion side with `Config.setVideoImageFormat("png")` and `Config.setColorSpace("bt709")`, or the diff measures the encoders (about 0.05 SSIM).
5. Write what didn't translate cleanly (dropped volume ramps, approximated presentations, substituted fonts) to `TRANSLATION_NOTES.md`.

| Remotion | Read |
| --- | --- |
| `Composition`, `defaultProps`, `schema`, `calculateMetadata` | `references/parameters.md` |
| `Sequence`, `Series`, `Loop`, `AbsoluteFill`, `Freeze` | `references/sequencing.md` |
| `useCurrentFrame`, `interpolate`, `spring`, `Easing`, `interpolateColors` | `references/timing.md` |
| `Audio`, `Video`, `Img`, `IFrame`, `staticFile`, `delayRender` | `references/media.md` |
| `TransitionSeries`, `@remotion/transitions` | `references/transitions.md` |
| `@remotion/lottie` | `references/lottie.md` |
| `@remotion/google-fonts`, `Font.loadFont`, `@font-face` | `references/fonts.md` |
| What can't be ported | `references/limitations.md` |

Before hand-building a named visual the source used, search `npx hyperframes catalog --query "<the visual, in English>" --json`: it ranks the whole registry with nothing installed.

## Hosted

Keep the code and let HyperFrames own the clock: it draws the frame for the time it is given. The seek protocol and the built-in adapters for Lottie, Three.js, anime.js, WAAPI and CSS animations are in `../hyperframes/references/runtimes.md`. No `requestAnimationFrame` loop or timer as the time source, seeded randomness only, and `data-duration` on the root when nothing else defines the length.

## Media

`<video class="clip" data-has-audio="true" src="assets/x.mp4" ...>`, or `muted` when it is silent. Nothing else is needed.

In the final message, list each imported part with its level, what a person can change in Studio, and how the frame-by-frame comparison came out.
