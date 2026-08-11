---
name: gpu-particle-field
description: Deterministic GPU-scale particle systems — THREE.Points with index-seeded attributes and a vertex shader computing position as a pure function of uTime. Thousands to hundreds of thousands of particles that survive the seek-shuffle gate. States the DOM→Canvas→GPU escalation ladder.
metadata:
  tags: particles, gpu, points, shader, vertex, field, confetti, dissolve, assemble, deterministic, three
---

# GPU Particle Field

Confetti storms, glyph dissolves at per-particle density, ambient dust atmospheres,
swarm assembles — **thousands to hundreds of thousands** of particles, all seek-safe.
One law makes GPU particles HyperFrames-native:

> **Position is a pure function of `uTime` and per-index seeds.**
> The GPU evaluates the SAME formula the DOM lane uses — it just evaluates it 100,000
> times in parallel. No simulation state ever advances frame-to-frame.

## The escalation ladder

| lane           | count          | when                                                                         | recipe                                        |
| -------------- | -------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| **DOM**        | ≤ ~40          | discrete garnish particles: confetti pops, dot bursts                        | [particle-burst](particle-burst.md)           |
| **Canvas 2D**  | ~40–2,000      | per-pixel dissolves, procedural texture, mid-density swarms                  | `../techniques.md` § Canvas 2D Procedural Art |
| **GPU points** | 2,000–100,000+ | fields, atmospheres, dense dissolves/assembles, anything lit or depth-sorted | this rule                                     |

Escalate only when the lane below runs out: DOM dies on per-frame style writes past ~40;
Canvas 2D dies on JS loop cost past ~2,000. Never reach for the GPU lane for a
12-piece confetti pop — the vendored-three cost isn't justified.

## How It Works

1. **Index-seeded attributes, built once at setup.** Same `prand` hash as the DOM rung
   ([particle-burst](particle-burst.md)); the Canvas rung's recipe carries its own
   deterministic integer hash (`../techniques.md` § Canvas 2D Procedural Art):

   ```js
   const prand = (n) => {
     const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
     return x - Math.floor(x);
   };
   const N = 20000;
   const aSeed = new Float32Array(N),
     aSeed2 = new Float32Array(N);
   for (let i = 0; i < N; i++) {
     aSeed[i] = prand(i * 3 + 1);
     aSeed2[i] = prand(i * 3 + 2);
   }
   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3)); // dummy — shader owns position
   geo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
   geo.setAttribute("aSeed2", new THREE.BufferAttribute(aSeed2, 1));
   geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12); // shader-positioned: authored bounds
   ```

2. **Vertex shader computes position from (uTime, seeds).** Ballistic example — the
   exact particle-burst formula, lifted into GLSL:

   ```glsl
   uniform float uTime, uBurstAt, uFlight, uGravity, uSize;
   attribute float aSeed, aSeed2;
   varying float vFade;
   void main() {
     float angle = aSeed * 6.28318;
     float speed = mix(0.6, 1.9, aSeed2);
     float t = clamp((uTime - uBurstAt) / uFlight, 0.0, 1.0) * uFlight;
     vec3 p = vec3(cos(angle), sin(angle), (aSeed2 - 0.5) * 0.6) * speed * t;
     p.y += 0.5 * uGravity * t * t;
     vFade = 1.0 - smoothstep(0.7, 1.0, t / uFlight);
     vFade *= 1.0 - step(uTime, uBurstAt); // pre-burst guard: visible only when uTime > uBurstAt (strict edge, like the DOM guard)
     vec4 mv = modelViewMatrix * vec4(p, 1.0);
     gl_PointSize = mix(2.0, 7.0, aSeed) * (uSize / -mv.z); // perspective attenuation, sized in px (uSize ≈ camera distance)
     gl_Position = projectionMatrix * mv;
   }
   ```

   The guard line is load-bearing: WITHOUT it, `t` clamps to 0 before the burst and
   every particle sits at the origin at `vFade = 1.0` — with additive blending that is
   a saturated white dot for the whole pre-burst stretch and at every seek before the
   event. The strict edge (`1.0 - step(uTime, uBurstAt)`) keeps even the
   `uTime == uBurstAt` frame dark — the exact GLSL form of particle-burst's
   `drive.T === 0` guard: particles start AND end at zero alpha. (The reference build
   gates the equivalent state with a timeline-ramped `uFade` uniform at scene entry —
   forge-lab, 2026-08-11.)

   Swirls/atmospheres: sum-of-sines pseudo-curl of `(seed, uTime)` — analytic, stateless.
   Assembles: add an `aTarget` vec3 attribute — sample shape outlines at build time with
   `shape.getSpacedPoints(n)` (arc-length-even; sample holes too) — and
   `mix(scatterPos, aTarget, ease(t))`. NEVER `extractPoints()`: it gives straight
   segments only their endpoints, starving stems at assemble time (forge-lab, 2026-08-11).

3. **Respawn without state.** Looping fields derive per-cycle life from
   `fract((uTime + aSeed * LIFE) / LIFE)` — respawn is itself a pure function, so a seek
   into cycle 7 renders cycle 7 exactly.

4. **`uTime` comes from `hf-seek`, nothing else:**

   ```js
   window.addEventListener("hf-seek", (e) => {
     mat.uniforms.uTime.value = e.detail.time;
     renderer.render(scene, camera);
   });
   // initial render — the adapter may have dispatched before this module ran
   mat.uniforms.uTime.value = window.__hfThreeTime || 0;
   renderer.render(scene, camera);
   ```

## Recipe (material + draw)

```js
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uSize: { value: 8.0 }, // ≈ camera distance (uRef) — build-proven at camera z 6.7–7.6 (forge-lab, 2026-08-11)
    uGravity: { value: -1.6 },
    uBurstAt: { value: 1.0 },
    uFlight: { value: 2.2 },
  },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false, // glow fields: no depth fighting
  blending: THREE.AdditiveBlending, // or NormalBlending for paper confetti
});
const points = new THREE.Points(geo, mat);
scene.add(points); // ONE draw call for the entire field
```

Fragment: round sprite via `length(gl_PointCoord - 0.5)` discard/smoothstep; multiply
alpha by `vFade`.

## Variations

- **Confetti (colored quads)** — `InstancedMesh` of small planes instead of Points when
  particles need rotation/aspect; same purity law, rotation from
  `aSeed * spinRate * uTime`. Still one draw call.
- **Glyph dissolve at density** — for solid dissolves, sample the glyph's canvas alpha
  at build time for `aOrigin` positions (thousands of samples); outline targets use
  `getSpacedPoints` per the assemble bullet. Scatter outward as f(uTime); the DOM
  40-particle version sells small text, this sells a full-frame hero word.
- **WebGPU / TypeGPU lane** — same attributes-and-pure-formula shape in WGSL when the
  composition is already on the `typegpu` adapter. The purity law is identical; register
  completion with `waitUntil` per that adapter.

## Values

| token         | range                    | notes                                                                                                                                                                                                                                                          |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N (points)    | 2,000–100,000            | measure-first — budget depends on the actual render lane (forge-lab host: hardware ANGLE Metal; SwiftShader multiplier applies only where SwiftShader is actually in play); gate with the in-page per-seek probe, not wall clock (forge-lab bench, 2026-08-11) |
| gl_PointSize  | 2–8 px (attenuated)      | > ~12 px reads as sprites, not particles                                                                                                                                                                                                                       |
| blending      | Additive / Normal        | Additive glows (dark stages); Normal for paper/solid                                                                                                                                                                                                           |
| uSize         | ≈ camera distance (uRef) | build-proven 8.0 at camera z 6.7–7.6; a wrong constant is a 40× size blowout that additive blending turns into a white wall (forge-lab, 2026-08-11)                                                                                                            |
| flight / life | 1.5–4 s                  | taste floor — a GPU field briefer than ~1.5s doesn't read; lane choice stays count-driven                                                                                                                                                                      |

## Critical Constraints

- **NO stateful simulation.** No transformFeedback, no compute-into-texture ping-pong,
  no reading last frame's positions. Stateful sims **shuffle under seek** — the exact
  failure this rule exists to prevent. If the motion genuinely needs integration
  (collisions, flocking), **bake it** into a texture/attribute indexed by `uTime`
  (`baked-sim` — staged rule, not yet upstream).
- **`uTime` only from `hf-seek` / `__hfThreeTime`** — never rAF deltas, never
  `performance.now()`.
- **Particles start AND end at zero alpha.** Gate fade with `step(uBurstAt, uTime)` (or
  an equivalent timeline-ramped fade uniform) so seeks to before the event render
  nothing — the GPU form of particle-burst's `drive.T === 0` guard. A clamped-`t`
  formula without the gate stacks the whole field at the origin at full alpha
  pre-burst (forge-lab, 2026-08-11).
- **Attributes are built once** at setup from the index hash; buffers are never written
  per frame (`DynamicDrawUsage` is a smell — the shader owns motion).
- **Dummy `position` attribute still required** — three validates its presence even
  when the vertex shader ignores it.
- **Author the bounds.** Shader-owned positions mean THREE's computed bounding sphere
  (radius 0 at the origin, from the dummy buffer) is wrong — the whole field
  frustum-culls the moment the origin leaves view. Set `geo.boundingSphere` explicitly
  (or `points.frustumCulled = false`) (forge-lab, 2026-08-11).
- **`depthWrite: false` for transparent/additive fields** or particles z-fight; keep
  `depthTest: true` so geometry still occludes them.
- **One field = one draw call.** If you're adding Points objects per burst, merge them
  and window each burst's life inside the shader (`uBurstAt` uniforms or an `aDelay`
  attribute).
- **Budget before render**: run the Scene Performance Checklist + Two-Step Bound
  Diagnosis in `../adapters/three.md`, measured with the in-page per-seek probe (`hf-seek`
  loop + 1×1 `readPixels` flush) — wall clock stays flat while per-seek cost varies
  20×, so it serves only as an end-to-end sanity metric; budgets depend on the actual
  render lane, not an assumed SwiftShader path (forge-lab bench, 2026-08-11).

## See also

`particle-burst` (DOM rung + the shared hash) · `baked-sim` (staged rule — when motion
needs real integration) · `../adapters/three.md` (contract; Scene Performance Checklist +
Two-Step Bound Diagnosis for budgeting) · `../adapters/typegpu.md` (WGSL rung).
