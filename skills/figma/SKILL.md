---
name: figma
description: Import Figma content into a HyperFrames composition — rendered assets, brand tokens, components, and Figma Motion animations — via the Figma MCP connector. Use when the user pastes a figma.com link or asks to bring a Figma design, frame, logo, brand, or animation into a video/composition.
---

# Figma → HyperFrames

Bring the user's Figma work into a composition. **MCP-first:** you (the agent) call the Figma MCP tools, then hand their output to the pure helpers in `@hyperframes/core/figma`, freezing every asset locally so renders stay deterministic.

## Auth

Requires the Figma MCP connector (one-click OAuth). If tools error unauthenticated, tell the user to connect Figma and stop.

## Routing

Parse the user's figma link with `parseFigmaRef`. Then by intent:

- "use this layer / logo / image" → **Asset import**
- "import this animation / motion" → **Motion import**
- brand tokens / components → not in this skill version (see the design spec roadmap).

## Asset import

1. `get_metadata(fileKey, nodeId)` → confirm the node, capture width/height.
2. Export it: `download_assets` (or node image export) for PNG; prefer SVG for vectors.
3. Freeze: write the bytes with `freezeBytes(bytes, join(typeDirPath(projectDir,"image"), id + ext))` where `id = nextId(projectDir,"image")`.
4. Ledger: `appendRecord(projectDir, { id, type:"image", path, source:"figma", width, height, provenance:{ source:"figma", fileKey, nodeId, format } })`.
5. Emit `buildAssetSnippet(record).html` into the composition. Re-import guard: `findByFigmaNode` before re-fetching.

## Motion import

1. `get_motion_context(fileKey, nodeId)` → read the `codeSnippets.motionDev` (and `.css`).
2. Normalize it into a `MotionDoc`: for each animated property build a `MotionTrack` { property (motion.dev name), values, times (0..1), ease[] (named strings or `[x1,y1,x2,y2]` bezier arrays), duration, repeat }. Selector = the target element's stable id (`#<id>` from the component's `data-figma-id`/`id`).
3. `const spec = motionToGsap(doc);`
4. `const script = emitTimelineScript(spec);` → inject as a `<script>` in the composition (after the GSAP + CustomEase CDN tags). The timeline is paused, finite, registered on `window.__timelines`.
5. If a track uses shader/spring/effect props with no GSAP mapping, bake instead: `export_video` → freeze MP4 → embed as `<video class="clip">`. Say which path you used.

## Determinism

Never leave a Figma URL in the composition — freeze first. Never emit `repeat: -1`. Timelines paused.
