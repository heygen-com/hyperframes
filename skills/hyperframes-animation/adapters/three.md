---
name: hyperframes-three
description: Three.js and WebGL adapter patterns for HyperFrames. Use when creating deterministic Three.js scenes, WebGL canvas layers, AnimationMixer timelines, camera motion, shader-driven visuals, or canvas renders that respond to HyperFrames hf-seek events.
---

# Three.js for HyperFrames

HyperFrames supports Three.js through its `three` runtime adapter. The adapter does not own your scene. It publishes HyperFrames time and dispatches a seek event so your composition can render the exact frame.

## Contract

- Create the scene, camera, renderer, materials, and assets synchronously when possible.
- Render from HyperFrames time, not wall-clock time.
- Listen for the `hf-seek` event and render exactly that time.
- Load models, textures, and HDRIs before render-critical seeking. Do not fetch them at seek time.
- Avoid `requestAnimationFrame` or `renderer.setAnimationLoop` as the source of truth for render-critical motion.
- **Always set `data-duration="<seconds>"` on the root `[data-composition-id]` element.** Unlike CSS/WAAPI/Lottie, the `three` adapter has no duration auto-inference — it only forwards time via `hf-seek`/`__hfThreeTime`, it doesn't inspect your scene for an `AnimationClip`/`AnimationMixer` length. Without `data-duration` (and no GSAP timeline), the render engine has no way to know how long to capture and fails with "Composition has zero duration". `npx hyperframes lint` errors on this (`root_composition_missing_duration_source`).

The adapter sets `window.__hfThreeTime` and dispatches `new CustomEvent("hf-seek", { detail: { time } })` on each seek.

## Basic Pattern

```html
<canvas id="three-layer"></canvas>
<script type="module">
  import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/+esm";

  const canvas = document.getElementById("three-layer");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  // Match these to your composition's frame size.
  renderer.setSize(1920, 1080, false);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 100);
  camera.position.set(0, 0, 6);

  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x64d2ff, roughness: 0.38 }),
  );
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));

  function renderAt(time) {
    mesh.rotation.y = time * 0.7;
    mesh.rotation.x = Math.sin(time * 0.6) * 0.16;
    renderer.render(scene, camera);
  }

  window.addEventListener("hf-seek", (event) => {
    renderAt(event.detail.time);
  });

  renderAt(window.__hfThreeTime || 0);
</script>
```

```css
#three-layer {
  width: 100%;
  height: 100%;
  display: block;
}
```

## Loading Addons (`GLTFLoader`, `OrbitControls`, etc.)

For anything under `three/addons/`, use an importmap so bare specifiers resolve. The HyperFrames lint recognizes both this form and the inline `+esm` import above — pick whichever your composition needs.

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/"
    }
  }
</script>
<script type="module">
  import * as THREE from "three";
  import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  // ...
</script>
```

Pin the `three` version in both entries to the same value. Mixing versions across the map and bare imports causes silent breakage.

## AnimationMixer Pattern

For GLTF or authored clip animation, seek the mixer directly:

```js
function renderAt(time) {
  mixer.setTime(time);
  renderer.render(scene, camera);
}
```

If several mixers exist, seek all of them from the same `time`.

## Text: Font Ingestion

three ships no fonts. For real extruded text, ingest a font at init — never hand-author
letterform Shapes (a prior build's stopgap — lit-logo-sting, 2026-08-04 — retired by
the `3d-text-true-extrude` rule):

- **opentype.js (default)** — parse a vendored TTF/OTF/WOFF, walk each glyph's path
  commands into a `THREE.ShapePath` (negate `y` — opentype is y-down), then
  `.toShapes(true)` → `ExtrudeGeometry`. Per-glyph meshes, real kerning
  (`font.getKerningValue`), per-glyph pivots for staggered entrances. Variable fonts:
  opentype.js ignores `gvar` — pre-instance offline (`fonttools varLib.instancer`) for
  any non-default weight (forge-lab, 2026-08-11).
- **typeface JSON** — `FontLoader` + `TextGeometry` for a single static title; requires
  offline facetype.js conversion, no per-glyph control.

Ship the font as a local SYNCHRONOUS include — never `fetch()`: async load races
first-frame capture (forge-lab, 2026-08-11). opentype lane: base64 include
(`window.__FONT_B64`), decode + `parseFont` at module top; typeface JSON lane: include
the JSON synchronously and `FontLoader.parse()` it. Build geometry
once at setup. Full recipe,
proven bevel/material constants, and traps: `../rules/3d-text-true-extrude.md`.

## Good Uses

- Deterministic 3D objects, product spins, particles with seeded data, and shader plates.
- Particle fields at `THREE.Points` scale (thousands+, one draw call): `../rules/gpu-particle-field.md`.
- Camera moves derived from `time`.
- GLTF animation clips when assets are local and loaded before validation completes.

## Scene Performance Checklist

The render lane's rasterizer is **host-dependent**: some hosts batch-render on
SwiftShader (software rasterization — the "GPU" is CPU cores; a prior build —
lit-logo-sting, 2026-08-04 — rendered under it), others on hardware GL (forge-lab, 2026-08-11: ANGLE Metal on Apple M4).
Check and log the actual GL renderer string (`gl.getParameter(gl.RENDERER)` /
debug-renderer-info) before budgeting. Every frame is still a direct seek with no
temporal reuse — shadow/RT passes must re-render every frame for seek safety — so treat every budget below as a measure-first default, and apply the
software-raster cost multiplier only on hosts where SwiftShader is confirmed in play.
Hardware-GL rendering measured deterministic (forge-lab, 2026-08-11: 720/720
double-render framemd5) — determinism is not a reason to assume or force SwiftShader —
but keep the double-render framemd5 comparison in every batch pipeline: it caught a
transient divergent render. Run this checklist before the first full render, and log
the two `renderer.info` numbers in the project notes:

1. **Draw calls** — read `renderer.info.render.calls` after a representative seek.
   Budget **≤ ~100** (measure-first default). Every repeated geometry (particles,
   tiles, crowd of glyphs) should be ONE call: `THREE.Points`, `InstancedMesh`, or
   `BufferGeometryUtils.mergeGeometries` for static clusters. Hundreds of individual
   `Mesh` objects is the #1 silent cost — naive is 1 call PER mesh; instancing
   collapsed 1,500 boxes to 1 call / 18,000 tris from live `renderer.info`
   (forge-lab, 2026-08-11).
2. **Triangles** — `renderer.info.render.triangles`, budget **≤ ~300k**
   (measure-first default). Extruded/
   beveled text multiplies fast (`bevelSegments: 5, curveSegments: 24` is the proven
   ceiling for close-ups — constants owned by `../rules/3d-text-true-extrude.md`;
   background elements take 12 or less).
3. **Lights** — every light adds per-fragment shading work to the material shader
   (Three is single-pass forward: lights unroll into compile-time loops inside one
   shader execution, plus a one-time recompile when the count changes), and every
   shadow-casting light adds a depth pass — six for a point light. The override test's
   material/lighting share is one shader-complexity number, not a per-light pass
   multiplier (forge-lab, 2026-08-11: −28%). The 3-directional studio rig
   (key/fill/rim) is the ceiling for lit scenes. Shadows: only the key casts;
   `shadow.mapSize` 1024 proven. **No point-light shadows** — they render the scene six
   times.
4. **Per-frame passes** — count every render-target pass that runs per seek (contact
   shadow depth + its 2 blur passes, composer Render/Bokeh/Bloom/Output). For scale:
   a prior full-WebGL build's pipeline (lit-logo-sting, 2026-08-04: 7 per-seek RT
   passes) ran ~1.7× the DOM pipeline's wall clock under SwiftShader on that host — a whole-pipeline,
   host-specific datum, not a pass-stack budget. Measure pass cost with the per-seek
   probe below. Keep utility RTs small (contact shadow at 256² proven).
5. **Textures** — cap 2048², power-of-two, uploaded once at init (never per frame).
6. **Allocation discipline** — no `new` in the seek path (`renderAt`): reuse Vector3s/
   Matrix4s/Colors created at setup. GC pauses read as frame-time spikes in batch logs.
7. **Disposal in multi-scene compositions** — when a Three scene's clip window ends and
   another begins, `.dispose()` geometries, materials, and render targets you drop.
   Leaks compound across a batch render.
8. **Pinned output** — `setPixelRatio(1)`, fixed `setSize` (adapter contract); DPR-
   dependent cost is also DPR-dependent output.

Measure with the in-page per-seek probe, not wall clock: dispatch `hf-seek` in a loop —
~10 warmup seeks, then ~60 timed seeks, with a 1×1 `readPixels` after each seek to
force GL completion (without the flush, timings exclude queued GPU work) — and divide
for ms/seek. Keep `npx hyperframes render` wall clock only as an end-to-end sanity
check: it is a pipeline-total metric that can read flat on fast hosts even at 20×
per-seek differences (forge-lab, 2026-08-11: all six bench configs rendered in ~5s
wall clock while per-seek cost spanned 2.34–46.26 ms). Probe before and after any fix;
numbers go in the project notes, never into runtime adaptation — the render must stay
deterministic, so all tuning is authored constants.

## Two-Step Bound Diagnosis (GPU-bound vs CPU-bound)

When a Three scene renders slow, do NOT guess — two probe measurements plus the
remainder classify the bottleneck. The rubric is GRADED, not binary: partial
reductions are the expected result, each test carves off its share, and the ms/seek
that survives both tests names the bound.

1. **Resolution test.** Quarter the output (`renderer.setSize(960, 540)` temporarily)
   and re-time with the probe.
   - **Large drop →** fragment/fill-rate bound — heavy overdraw/blending and
     multi-pass post FX are the usual fill-rate suspects, a hypothesis this test
     checks, not a given. Fix: fewer/smaller RT passes, less overdraw and blending,
     simpler fragment work, smaller bloom radius.
   - **Small drop →** fill rate is secondary; go to step 2.
2. **Override test.** At full resolution, set
   `scene.overrideMaterial = new THREE.MeshBasicMaterial()` and re-time. The drop is
   the material/lighting share (shader complexity × lights): reduce lights, swap
   Standard→Lambert/Basic for background meshes, drop env-map work on things that
   never glint.
3. **Attribute the remainder.** Whatever ms/seek still stands at full resolution with
   Basic materials is scene-graph/JS side: per-mesh draw submission + traversal
   (merge/instance per item 1), per-seek allocations (item 6), or CPU work in
   `renderAt` itself. A large remainder is a draw-submission verdict even when step 2
   showed a real drop. Worked example (forge-lab, 2026-08-11): 30k-mesh field at
   46.26 ms/seek — resolution test −10% (not fill-bound), override test −28%
   (material cost real but secondary), ~33 ms remainder → draw-submission bound;
   instancing fixed it, 46.26 → 2.34 ms/seek (20×).

Run the tests in this order (the resolution test is one line and rules out half the
space). Both are temporary instrumentation — revert before rendering; findings become
authored changes, never runtime switches.

## Avoid

- Using `Date.now()`, `performance.now()`, or clock deltas to update scene state.
- Leaving render-critical work inside a free-running animation loop.
- Loading remote models or textures at render time.
- Device-pixel-ratio dependent output. Pin renderer size and pixel ratio for video renders.
- Post-processing passes that depend on previous frame history unless you can reconstruct state from time.

## Validation

After editing a Three.js composition:

```bash
npx hyperframes lint
npx hyperframes check
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/three.ts`.
- Why `data-duration` is required here specifically (no auto-inference for this adapter): `packages/core/src/runtime/init.ts` (`resolveAdapterDurationFloorSeconds`) and the CSS/WAAPI/Lottie adapters' `getInferredDurationSeconds`, which the `three` adapter deliberately does not implement.
- Three.js `WebGLRenderer` docs: https://threejs.org/docs/pages/WebGLRenderer.html
- Three.js `AnimationMixer.setTime()` docs: https://threejs.org/docs/pages/AnimationMixer.html
