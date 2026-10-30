---
name: figma
description: Bring Figma into a HyperFrames video - rendered assets, brand tokens, components, storyboard frames as reconstructed motion (frames read as states, not slides), shaders and connector-assisted motion. Use when the person pastes a figma.com link or asks to use a Figma design, frame, logo or brand.
---

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin.

# Figma → HyperFrames

Every import happens at build time and freezes a local file with its source recorded under `.media/`, so renders never call Figma and re-running a command re-imports only what changed. Assets, tokens and components go over REST with a token; motion and shader data need a Figma connector, or a native export from the person.

## Access

`FIGMA_TOKEN` in the shell or the project `.env`. Check it exists before the first command; if not, tell the person how to make one and stop: figma.com → Settings → Security → Personal access tokens, read-only **File content** and **File metadata**, plus **Library content** for `tokens` on non-Enterprise plans. They set it themselves; never ask them to paste it into the chat.

| Error | Meaning |
| --- | --- |
| `BAD_TOKEN` (401) | Expired or revoked: make a new one |
| `FORBIDDEN` (403) | The message names the missing scope, or the file isn't visible to the account |
| `REQUIRES_ENTERPRISE` (403, variables) | Not a failure: the published-styles fallback already ran |
| `RATE_LIMITED` (429) | Already retried with backoff; wait a minute or import fewer nodes per call |

## Commands

- A layer, logo or image: `npx hyperframes figma asset '<url or fileKey:nodeId>' [more refs] --format svg|png --scale 2 --description "<what it is>" [--entity "<brand mark>"]`. SVG for vectors and logos, PNG at 2x for raster. Several nodes of one file in one call render in a single request; `--entity` lets `/media-use` find a brand mark later.
- Brand colours and type: `npx hyperframes figma tokens <fileKey>`. Run it before `component` and paste the printed entries into `data-composition-variables`. Without Enterprise it falls back to published styles. A connector can supply variables there instead: cache its raw response in `.media/figma-cache/` and write the bindings to `.media/figma-bindings.jsonl` (`{kind:"binding", figmaId, sourceFileKey, compositionVariableId:"figma:<name>", version}`).
- A frame as editable HTML at exact geometry: `npx hyperframes figma component '<url or fileKey:nodeId>'`, packaged under `compositions/components/<name>/`. A fill bound to an imported token comes out as `var(--slug, #literal)`, so one variable re-brands every import; an unknown token stays a literal marked `data-figma-unresolved`: import that library's tokens and re-import. Ask once which file a library is; never match by hex.
- Check hero components against Figma's pixels (`figma asset <same node> --format png`). Text drift is the usual cause; report drift you can't fix instead of hand-tweaking the import.

## Motion (connector)

Usage beacon: these phases have no CLI touchpoint, so run `npx hyperframes events --skill=figma-motion` when you begin and `npx hyperframes events --skill=figma-motion --event=skill_completed --outcome=success|error` when done. Same for shaders (`figma-shaders`) and storyboards (`figma-storyboard`).

1. Fetch motion context for the parent frame in one recursive request; cache the raw JSON in `.media/figma-cache/`.
2. Normalise with `motionContextToDocs(raw, { selectorFor, repeat })` from `@hyperframes/core/figma`, never by transcribing keyframes. It reads the motion.dev snippets (the CSS snippets stretch durations), drops loop-wrap tail keyframes and keeps bezier eases. `selectorFor` returns the ids from the component import.
3. `motionToGsap(doc)` → `emitTimelineScript(spec)`, injected after the GSAP and CustomEase tags: paused, finite, a literal `window.__timelines` key. Named eases outside the mapped set fall back to linear; say so.
4. Verify against Figma's own export: `node <SKILL_DIR>/scripts/verify-motion.mjs --reference <export.mp4> --render <render.mp4> --crop WxH+X+Y`. It compares motion between samples, so static drift cancels out, and fails under 15 dB (faithful ≈ 20+, diverging ≈ 5). Measure `--crop` from the render's card edges. A fail means fix the translation, not the threshold.
5. A track that won't translate: export it, freeze the MP4 and place it as `<video class="clip">`.

## Shaders

Figma's export path flattens shaders to their base colour, and shader source is only reachable for library-published styles. Ask the person for a native export of that frame (PNG or MP4) and place it as an asset or clip.

## Storyboards: frames are KEYFRAMES, not slides

Two frames holding the same element describe that element's state through time: animate the element between the states. Playing the frames back to back as stills is the failure mode.

1. Scenes are every frame-sized node in the section, named frames and loose full-frame rectangles alike: filter by size, not type or name. Order by `absoluteBoundingBox.x`.
2. Match children across neighbouring frames by name first, then by similar size and position. Tween geometry between states; crossfade two exports in place when the pixels changed. Export one asset per element, not one still per frame. Unmatched children enter or exit at their scene's beat.
3. Text nodes below the strip are motion notes for the scene above them, not on-screen copy. A note about motion inside a scene ("lines reveal one after another") means import that frame as a component and animate it.
4. Export in batches of about 4 scene frames per call: past about 12 ids `/v1/images` times out.
5. Frames that are one product UI in successive states: rebuild the UI as live DOM: code what changes state, freeze what doesn't, and treat each frame change as an interaction to perform (the cursor moves, clicks, the screen responds), not a tween to apply.
6. Stills are the fallback, only for frames with no shared elements.

Never leave a Figma URL in the composition.
