# Section 11 — 3D and Parallax

CSS 3D transforms (`transform-style: preserve-3d`, `perspective`, rotateX/Y/Z), parallax depth layers, card-stack fan-out, Three.js scenes. Adds dimensionality to compositions without leaving the browser.

**When to study this section:** any beat where flat 2D feels insufficient — premium feel, product showcases, depth metaphors.

---

## Scenes

| Scene | Duration | Technique | Why study |
|-------|----------|-----------|-----------|
| [`scene-01-css-3d-torus/`](scene-01-css-3d-torus/) | 1.2s | 16-segment orbital ring of pastel rounded squares (rose, sage, taupe, mauve) rotating through 3D space. Uses `transform-style: preserve-3d` + `perspective`. Ground shadow follows the rotation. Studio-lit aesthetic on warm cream backdrop. | The pattern for CSS-only 3D objects. No Three.js library required — pure CSS transforms achieve the depth effect. Demonstrates how rotation + perspective + transformY combine. |
| [`scene-02-vercel-triangle-roll/`](scene-02-vercel-triangle-roll/) | 5.5s | Three.js pyramid rotating through 6 distinct orientations with multi-material grayscale faces. Camera locked; geometry rolls with timed `tl.to(rotation, ...)` segments. | Reference for Three.js inside a HyperFrames scene with deterministic rotation. Note the `gsap.ticker.add()` render pattern reading `tl.time()` — necessary for seekable rendering under `tl.seek()`. |
| [`scene-03-card-flyby-deck/`](scene-03-card-flyby-deck/) | 6s | CSS 3D card tumble + clip-path wipe reveal across 6 colored cards. Each card enters from depth, rotates into frame, then clips upward to expose the next. | The "fan out a deck of cards" motion pattern. Useful for revealing a list of features as discrete cards rather than a static grid. |
| [`scene-04-anamorphic-text-crt/`](scene-04-anamorphic-text-crt/) | 15s | Three.js 3D text morphing MOTION ↔ DESIGN with CRT HUD overlay (scan lines, corner markers, telemetry). Long-duration showcase. | Demonstrates 3D text geometry with a deterministic morph. Use sparingly — high cost per second to render but visually distinctive. |
| [`scene-05-iphone-device-gesture/`](scene-05-iphone-device-gesture/) | 6.5s | CSS 3D iPhone frame with tap/swipe gesture overlays animating across a composed app screen. No screenshots — the screen content is divs/CSS. | Use when a beat needs to show a user interacting with an app, not just showing the app. The gesture overlay (finger circle + ripple) is the load-bearing detail. |

---

## QC log

- scene-01: **PASS** — 6 frames; ring tilts and rotates around Y axis. Frame 1 shows 30° Y + 25° X initial tilt; mid-frames show side-on view; final frame shows ~310° rotation (inverse of frame 1). Ground shadow visible. Lifted from `launch-video/compositions/flex-threejs.html` (despite the name, it's pure CSS 3D, not Three.js library).
- scene-02: **PASS** — Three.js pyramid rotates through 6 orientations; deterministic seekable. Lifted from team archive `vercel-triangle-roll/`.
- scene-03: **PASS** — 6 cards tumble with stagger; CSS 3D + clip-path. Lifted from team archive `card-flyby/`.
- scene-04: **PASS** — Three.js text morph with CRT HUD; 15s showcase. Lifted from team archive `anamorphic-text-crt/`.
- scene-05: **PASS** — CSS 3D iPhone + animated gesture overlay; pairs well with section 07 device mockups for "interaction" beats vs section 07's "showcase" beats.
