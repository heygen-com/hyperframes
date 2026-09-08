---
name: baked-sim
description: Organic physics (a rope, flag, cloth, debris, a flock) never runs at render time — a build script steps the simulation at dt = 1 / fps with a seeded PRNG and writes per-frame data; playback is one `ease:"none"` driver whose onUpdate does `frames[Math.round(t × fps)]`, an index lookup and nothing else. Seek-safe and deterministic by construction; shipped as a synchronous script include, never fetched.
metadata:
  tags: physics, simulation, baked, offline, verlet, rope, cloth, flag, pennant, debris, seeded, prng, replay, frame-index, deterministic
---

# Baked Sim

A hanging pennant catching wind, a rope settling, a cloud of debris tumbling: motion that comes from a **simulation** — integration, constraints, forces — not from an ease. A simulation is stateful by nature (frame N depends on frame N−1), which is exactly what a seeked renderer cannot run. So the simulation runs **once, offline**, at build time, and the composition replays its output by frame index. The renderer sees a lookup, never an integrator.

Boundaries: [particle-burst.md](particle-burst.md) needs no bake — each particle is a closed-form ballistic function of time and evaluates directly. Bake when the bodies **interact** (constraints, collisions, wind on a chain, flocking) or the step is iterative. A [sine-wave-loop.md](sine-wave-loop.md) idle is neither; keep it analytic.

## How It Works

1. **Bake** — a build script (`bake/bake-<name>.mjs`) steps the sim at `dt = 1 / FPS` for `PRE_ROLL + FRAMES` steps with a seeded PRNG (`mulberry32(SEED)`, never `Math.random`), fixed iteration counts, and per-frame forces computed from the frame number. It writes one entry per composition frame: an SVG path `d`, an array of transforms, a list of points.
2. **Ship synchronously** — the output is a script that assigns one global (`window.__PENNANT = {...}`), loaded with a plain `<script src>` before the composition script. Never `fetch()`: an async load races the renderer's first-frame capture, and a seek to t=0 can land on empty data.
3. **Replay** — one `ease: "none"` proxy tween spans the clip; its `onUpdate` computes `i = clamp(Math.round(proxy.f))` and applies `frames[i]`. No integration, no accumulated state, no RNG at runtime — a seek to any frame reads the same entry every time.
4. **Pre-roll** — the bake runs `PRE_ROLL` steps (≈ 60 frames) before frame 0 and discards them, so the system is already hanging or settled at the first captured frame instead of falling into place.

## Recipe

```js
// bake/bake-pennant.mjs — BUILD TIME ONLY.  `node bake/bake-pennant.mjs` → assets/baked/pennant.js
import { writeFileSync } from "node:fs";
const FPS = 30,
  DURATION_S = 7,
  FRAMES = FPS * DURATION_S,
  PRE_ROLL = 60;
const N = 16,
  SEG = 26,
  GRAV = 210,
  DT = 1 / FPS,
  ITER = 15,
  SEED = 42;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const gust = Array.from({ length: 24 }, () => (rand() - 0.5) * 2); // seeded gust knots, interpolated per frame
const windAt = (f) => {
  const t = f / FPS,
    k = (f / FRAMES) * (gust.length - 1),
    i = Math.floor(k),
    x = k - i;
  const base =
    680 + 260 * Math.sin((2 * Math.PI * t) / 3.6) + 140 * Math.sin((2 * Math.PI * t) / 1.3 + 1.2);
  return base + (gust[i] * (1 - x) + gust[Math.min(i + 1, gust.length - 1)] * x) * 320;
};
const pts = Array.from({ length: N }, (_, i) => ({
  x: i * SEG * 0.6,
  y: i * 6,
  px: i * SEG * 0.6,
  py: i * 6,
}));
const frames = [];
for (let f = -PRE_ROLL; f < FRAMES; f++) {
  const wind = windAt(Math.max(0, f));
  for (let i = 1; i < N; i++) {
    // verlet step, slight drag
    const p = pts[i],
      vx = (p.x - p.px) * 0.985,
      vy = (p.y - p.py) * 0.985;
    p.px = p.x;
    p.py = p.y;
    p.x += vx + wind * DT * DT;
    p.y += vy + GRAV * DT * DT;
  }
  for (let it = 0; it < ITER; it++) {
    // distance constraints, head pinned at the origin
    pts[0].x = 0;
    pts[0].y = 0;
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6,
        diff = (d - SEG) / d,
        wa = i === 0 ? 0 : 0.5,
        wb = i === 0 ? 1 : 0.5;
      a.x += dx * diff * wa;
      a.y += dy * diff * wa;
      b.x -= dx * diff * wb;
      b.y -= dy * diff * wb;
    }
  }
  if (f >= 0) frames.push(toPathD(pts));
}
function toPathD(pts) {
  // a smooth quadratic through the segment midpoints: "M x0 y0 Q x1 y1 mx my … L xN yN"
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
    const my = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx} ${my}`;
  }
  return d + ` L ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;
}
writeFileSync(
  new URL("../assets/baked/pennant.js", import.meta.url),
  `window.__PENNANT=${JSON.stringify({ fps: FPS, frames })};\n`,
);
```

```html
<!-- inside a standard scene clip; the baked data is a synchronous include BEFORE the composition script -->
<svg width="700" height="700" viewBox="-20 -40 700 700">
  <path id="rope" d="" fill="none" stroke="{accent}" stroke-width="14" stroke-linecap="round" />
</svg>
<script src="assets/baked/pennant.js"></script>
```

```js
const PEN = window.__PENNANT; // present before this script runs — no load event, no race
const rope = document.getElementById("rope");
const LAST = PEN.frames.length - 1;
const apply = (i) => rope.setAttribute("d", PEN.frames[i]);
apply(0); // structural frame 0: the first captured frame never depends on the driver having fired
const proxy = { f: 0 };
tl.to(
  proxy,
  {
    f: LAST,
    duration: LAST / PEN.fps, // f === k at every sampled frame k / fps — an off-by-one here shows the previous entry on half the frames
    ease: "none",
    onUpdate: () => apply(Math.max(0, Math.min(LAST, Math.round(proxy.f)))), // an index lookup, nothing else
  },
  SCENE_AT,
);
```

## Variations

- **Transform arrays** — bake `[x, y, rot]` per body per frame (debris, a flock) and write each element's `transform` in the same `onUpdate`; the pool is fixed at setup.
- **Canvas draw** — bake point lists and draw them with `ctx` inside the driver: the canvas becomes a pure function of the frame index (paint frame 0 at setup).
- **Two-rate bake** — simulate at a finer `dt` (`1 / (FPS × 2)`) for stiff constraints and write every second step; the composition still indexes at its own fps.
- **Re-bake for direction** — a physically correct sim is not yet art-directed: the reference pennant hung limp until wind ≈ 3 × gravity, and streams at that ratio. Budget one bake iteration for the look, then freeze the seed.
- **Designed motion on top** — the baked object still takes ordinary tweens (a fade-in, a settle, an exit); the bake owns only what the sim owns.

## Values

| token     | range                          | notes                                                                                |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| FPS       | = the composition's `data-fps` | one entry per composition frame; the driver's `round()` then never straddles two     |
| PRE_ROLL  | 30–90 frames (default 60)      | enough for the system to hang / settle before frame 0                                |
| ITER      | 8–20 constraint passes         | stiffness; more = stiffer rope, longer bake, same file size                          |
| SEED      | any fixed integer              | change it to change the gusts; commit it with the data                               |
| data size | ≲ 100–300 KB per baked object  | a 210-frame, 16-point path is ~75 KB; past ~1 MB decimate the path or the body count |

## Critical Constraints

- **No integration at runtime** — the composition never steps, accumulates, or reads a previous frame; `frames[i]` is the whole runtime. A per-frame `+=` on baked state re-introduces the race the bake removed.
- **Synchronous include** — the baked script is a `<script src>` that runs before the composition script; never `fetch()` / dynamic `import()` at runtime.
- **Seeded and pinned** — a seeded PRNG in the bake, fixed `dt`, fixed iteration counts; no `Math.random`, no wall-clock, no host-dependent step. Re-running the bake reproduces the file byte for byte.
- **Frame 0 is structural** — call the apply function once at setup; a tween evaluated exactly at its start edge may not fire `onUpdate` on the first seek.
- **To change the motion, re-bake** — never a runtime knob that alters replayed data.
- The bake script and its inputs ship beside the composition (`bake/`) so the data has provenance; the data file is what renders.

## See also

`particle-burst` (closed-form particles — no bake needed) · `svg-path-draw` (drawing a baked path over time) · `sine-wave-loop` (analytic idle, not a sim) · `../adapters/three.md` (seeded particles and shader plates on the GPU lane).
