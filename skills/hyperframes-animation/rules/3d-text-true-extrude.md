---
name: 3d-text-true-extrude
description: Arbitrary text as real extruded 3D geometry — ingest a font file (opentype.js per-glyph outlines or typeface JSON), build THREE.Shape outlines, extrude with proven bevel constants, light with the studio glint rig. Text is a parameter, not hand-authored geometry; the camera can move around it.
metadata:
  tags: text, 3d, extrude, bevel, three, typography, font, metal, glint, sting
---

# 3D Text True Extrude

Real extruded, beveled, lit 3D typography from **any string and any font file** — the
MotionVFX-style "text keeps its 3D characteristics as the camera animates around it"
category. Runs on the `three` adapter (`../adapters/three.md`), inherits its full
determinism contract.

Boundaries: [3d-text-depth-layers](3d-text-depth-layers.md) is the cheap DOM lane — a
stacked-copy illusion that only survives a fixed viewpoint. Use TRUE extrusion when the
camera orbits/flies, when light must rake across bevels, or when the piece is a logo
sting / hero title with reflective material. If the text never leaves a frontal
viewpoint, stay in DOM.

## How It Works

1. **Ingest a font, don't hand-author geometry.** Two lanes:
   - **opentype.js lane (default)** — parses TTF/OTF/WOFF at setup, gives per-glyph
     outlines + real advance widths + kerning. Per-glyph meshes enable staggered
     entrances and per-letter pivots.
   - **typeface JSON lane** — three's own `FontLoader` + `TextGeometry` (a thin
     `ExtrudeGeometry` wrapper). One mesh per string, no per-glyph control, requires
     pre-converting the font (facetype.js). Fine for a single static title.
   - **Variable-font trap** — opentype.js ignores `gvar` and parses only a variable
     font's DEFAULT instance. Pre-instance offline (`fonttools varLib.instancer
wght=700`) for any other weight; keep the variable TTF as a separate asset for
     the CSS `wdth` lane. Two artifacts, two lanes. (forge-lab, 2026-08-11)
     Either way the font is a **local vendored SYNCHRONOUS include** — never `fetch()`:
     async load races first-frame capture (forge-lab, 2026-08-11). opentype lane: a
     classic script sets `window.__FONT_B64`, decode + `parseFont` at module top — ~1.3×
     size cost (121 KB static instance → 158 KB include); no subsetting needed. typeface
     JSON lane: include the JSON synchronously (plain JS/JSON include) and
     `FontLoader.parse()` it — no base64, no opentype.

2. **Outline → THREE.Shape.** opentype.js path commands map 1:1 onto a
   `THREE.ShapePath` (`M`→`moveTo`, `L`→`lineTo`, `C`→`bezierCurveTo`,
   `Q`→`quadraticCurveTo`, `Z`→close). Two traps:
   - opentype.js emits **y-down** canvas coordinates — negate `y` while building (or
     the text extrudes mirrored);
   - counters (the holes in A/O/R…) resolve by winding — build one `ShapePath` per
     glyph and call `.toShapes(true)`; never sort sub-paths by hand.

3. **Extrude with the proven constants** (SHIP-validated in lit-logo-sting, 2026-08-04; H = world
   letter height — normalize with `Box3` so constants scale with any font):

   ```js
   const H = 1.55; // world letter height after normalize
   const extrude = {
     depth: 0.06 * H,
     bevelEnabled: true,
     bevelThickness: 0.12 * H * 0.35,
     bevelSize: 0.1 * H * 0.35,
     bevelSegments: 5,
     curveSegments: 24,
   };
   ```

4. **Glint is material + environment + OBJECT motion — lights never move.**

   ```js
   const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd8, metalness: 0.9, roughness: 0.25 });
   scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
   scene.environmentIntensity = 0; // reveal dial — timeline ramps 0 → 0.85
   ```

   Studio rig: warm key 3.0 / cool fill 1.0 (3:1) fixed; rim ramped by the timeline.
   The specular glint travels across the bevels because the **object** rotates.

## Recipe

```html
<canvas id="three-layer"></canvas>
<script type="importmap">
  {
    "imports": { "three": "./vendor/three/three.module.js", "three/addons/": "./vendor/three/jsm/" }
  }
</script>
<script src="./fonts/{font}-b64.js"></script>
<!-- classic sync script: sets window.__FONT_B64 -->
<script type="module">
  import * as THREE from "three";
  import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
  // vendored, no CDN at render time; the importmap is mandatory — addons bare-import "three"
  import { parse as parseFont } from "./vendor/opentype/opentype.module.js";

  // synchronous ingestion — never fetch(): async load races first-frame capture
  // (forge-lab, 2026-08-11)
  const bytes = new Uint8Array(
    atob(window.__FONT_B64)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
  const font = parseFont(bytes.buffer);

  function glyphShapes(text, size) {
    const out = [];
    let x = 0;
    let prev = null;
    const scale = size / font.unitsPerEm;
    for (const glyph of font.stringToGlyphs(text)) {
      if (prev) x += font.getKerningValue(prev, glyph) * scale;
      const sp = new THREE.ShapePath(); // moveTo/lineTo/… delegate to the current sub-path
      for (const c of glyph.getPath(x, 0, size).commands) {
        if (c.type === "M") sp.moveTo(c.x, -c.y);
        else if (c.type === "L") sp.lineTo(c.x, -c.y);
        else if (c.type === "C") sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
        else if (c.type === "Q") sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
        // "Z" closes automatically when the next subpath starts / shapes are built
      }
      out.push(sp.toShapes(true));
      x += glyph.advanceWidth * scale;
      prev = glyph;
    }
    return out;
  }

  const group = new THREE.Group();
  for (const shapes of glyphShapes("{TEXT}", 1)) {
    const geo = new THREE.ExtrudeGeometry(shapes, extrude);
    geo.computeBoundingBox(); // per-glyph pivot: recenter so scale/rotate pops from glyph center
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(c.x, c.y, c.z);
    mesh.castShadow = true;
    group.add(mesh);
  }
  // normalize: Box3 → center at origin, height = H (constants above assume this)
  const box = new THREE.Box3().setFromObject(group);
  group.scale.setScalar(H / box.getSize(new THREE.Vector3()).y);
  new THREE.Box3().setFromObject(group).getCenter(group.position).multiplyScalar(-1);

  window.addEventListener("hf-seek", (e) => renderAt(e.detail.time));
  renderAt(window.__hfThreeTime || 0); // catch-up: the adapter may have seeked before module init
</script>
```

Entrances: per-glyph `rotation.y` / `position.z` staggered on the master timeline
(evaluate every mesh's transform as a pure function of `time` inside `renderAt`, or
tween proxy objects on the paused GSAP timeline and consume them inside `renderAt` —
in that case first force proxy freshness with `tl.time(t, true)` before reading them,
so a direct `hf-seek` arriving before the adapter's timeline seek can never render
stale proxies; seek-order idempotence (forge-lab, 2026-08-11)).

## Variations

- **Single-mesh title (typeface JSON lane)** — `new TextGeometry(text, { font, size,
depth, bevel… })`; only when per-glyph motion is not needed.
- **Per-glyph cascade** — offset each glyph's entrance by a constant `i × ~0.14s` with
  snappy spring pops (forge-lab scene 1, 2026-08-11); pivots are already per-glyph
  centers. The alternative is waterfall-entry's shrinking-gap pacing (accelerating
  cascade, velocity varied by weight) — that rule treats a constant identical-entrance
  stagger as an anti-pattern, so cite it only when you actually shrink the gaps.
- **Depth as the beat** — tween a `depthScale` proxy and `mesh.scale.z` 0.2 → 1 on the
  hit; bevels catch the key light as depth grows.

## Values

| token          | range            | notes                                                                                             |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| depth          | 0.04–0.10 × H    | 0.06 proven; >0.12 reads as a brick, not type                                                     |
| bevelThickness | 0.12 × H × 0.35  | proven pair with bevelSize — the "machined edge" read                                             |
| bevelSize      | 0.10 × H × 0.35  | >0.05 × H rounds thin strokes into blobs                                                          |
| bevelSegments  | 4–6              | 5 proven; higher wastes triangles (see the Scene Performance Checklist in `../adapters/three.md`) |
| curveSegments  | 16–24            | 24 proven for close-ups; 12 fine for background text                                              |
| metalness      | 0.85–0.95        | chrome/metal read; drop to 0.2 + roughness 0.6 for matte                                          |
| roughness      | 0.2–0.35         | lower = sharper glints, more aliasing under motion                                                |
| envIntensity   | ramp 0 → 0.7–1.0 | the reveal dial; 0.85 proven                                                                      |

## Critical Constraints

- **Vendor everything**: three ≥ 0.180 npm ships **no example fonts** and needs BOTH
  `build/three.module.js` and `build/three.core.js` vendored; vendor opentype.js and the
  font file too. No CDN fetches at render time.
- **Negate opentype.js `y`** when building shapes (y-down → y-up) or text mirrors.
- **`.toShapes(true)` for counters** — hand-sorting holes breaks on nested counters.
- **Variable fonts: pre-instance offline** — opentype.js ignores `gvar` and reads only
  the DEFAULT instance; run `fonttools varLib.instancer` for the weight you extrude and
  keep the variable TTF for the CSS `wdth` lane (forge-lab, 2026-08-11).
- **Font ingestion is synchronous by design** — never `fetch()`: async load races
  first-frame capture (forge-lab, 2026-08-11). opentype lane: base64 include (classic
  script sets `window.__FONT_B64`); JSON lane: synchronous include +
  `FontLoader.parse()`. Register the paused GSAP timeline synchronously too. The
  three adapter still needs its **duration anchor**: `data-duration` + a no-op paused
  GSAP tween (`tl.to({}, { duration: N })`).
- **Lights never move** — glint animation comes from object rotation / env ramp.
- **Geometry is built once at setup** — never re-extrude per frame; per-frame work is
  transforms + render only. Check the scene against the adapter's Scene Performance
  Checklist before render (extruded bevels multiply triangles fast).
- **License note for vendored fonts** — OFL/openly-licensed faces only in registry-bound
  work.

## See also

`3d-text-depth-layers` (DOM lane — fixed viewpoint) · `orbit-3d-entry` /
`3d-camera-flight` (DOM-lane choreography analogues — in this lane drive the
`THREE.PerspectiveCamera` directly: eased azimuth/radius arc, or a CatmullRom waypoint
path with lookAhead, both SHIP-validated) · `../adapters/three.md` (contract +
font-ingestion section + Scene Performance Checklist for the triangle/draw-call cost
this rule creates).
