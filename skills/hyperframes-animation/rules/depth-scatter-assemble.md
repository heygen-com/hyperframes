---
name: depth-scatter-assemble
description: N elements scatter into / reassemble from a rotating 3D depth-cloud, each starting at a deterministic index-derived 3D offset and settling to a clean flat layout.
metadata:
  tags: 3d, scatter, assemble, depth, cloud, tumble, kinetic, letter, fragment, logo, reassemble
---

# Depth Scatter ↔ Assemble

N elements (glyphs, cards, icons, logo fragments) fly in from a rotating 3D depth-cloud and lock into a clean on-screen layout — or the reverse. Each element starts at a **deterministic** 3D offset (translateZ depth + rotateX/rotateY + an x/y scatter derived from its index), then tweens to its assembled flat position (`z: 0, rotation: 0`). Because every scattered position is computed by trig on the element's index — never `Math.random` — it renders identically every frame.

Distinct from `orbit-3d-entry` (flip-in then a continuous orbit) and `center-outward-expansion` (a flat 2D burst from one shared center): here each element has its **own** point in a 3D cloud, and the resolve is a flat assembled layout, not an orbit or a radial spray.

## How It Works

Each element resolves to a flat layout position (`targetX/Y`, set once in CSS or via `data-*`). Its **scattered** state is derived from its index `i`:

```js
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39943 rad — even angular spread, no clumping
const a = i * GOLDEN; // this element's angle in the cloud
const scatterX = Math.cos(a) * RADIUS; // index-derived, deterministic
const scatterY = Math.sin(a) * RADIUS;
const scatterZ = Z_NEAR - (i / (n - 1)) * (Z_NEAR - Z_FAR); // stepped depth across the cloud
const rotX = Math.sin(a) * TUMBLE; // tumble orientation, also from the angle
const rotY = Math.cos(a) * TUMBLE;
```

A single 0→1 `progress` proxy interpolates each element between scattered and assembled (lerp every channel). At `progress = 0` the elements form the depth-cloud; at `progress = 1` they sit flat in the layout. Run it forward and it's **assemble**; the cloud itself slowly rotates (a stage `rotateY` tween) so the scatter has life before it locks.

Requires `perspective` on the stage and `transform-style: preserve-3d` on the stage AND each element, or the z-depth and tumble flatten to a 2D scale.

## HTML

```html
<div
  class="scene"
  id="assemble-scene"
  data-composition-id="assemble-scene"
  data-start="0"
  data-duration="4"
  data-track-index="0"
>
  <!-- The cloud rotates; the layout lives inside it. targetX/Y = each
       element's FLAT assembled offset from stage center (px). -->
  <div class="cloud-stage">
    <div class="frag" data-target-x="-260" data-target-y="0">{glyph1}</div>
    <div class="frag" data-target-x="-130" data-target-y="0">{glyph2}</div>
    <div class="frag" data-target-x="0" data-target-y="0">{glyph3}</div>
    <div class="frag" data-target-x="130" data-target-y="0">{glyph4}</div>
    <div class="frag" data-target-x="260" data-target-y="0">{glyph5}</div>
  </div>
</div>
```

For a logo lockup, `targetX/Y` describe the parts' resting layout; for kinetic type, one `.frag` per glyph (inject spans from the phrase string at setup so width is exact — see Variations).

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: {bgColor};
  perspective: 1400px; /* REQUIRED — without it, z-depth + tumble read as flat 2D scale */
}
.cloud-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  transform-style: preserve-3d; /* REQUIRED — preserves child 3D context */
  will-change: transform;
}
.frag {
  position: absolute;
  /* Live at stage center; GSAP translates each one to its layout / cloud point. */
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  font-family: {font};
  font-weight: 900;
  font-size: 120px;
  color: {textColor};
  transform-style: preserve-3d; /* each fragment keeps its own 3D context */
  backface-visibility: hidden; /* hides the mirrored face mid-tumble */
  will-change: transform, opacity;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const frags = Array.from(document.querySelectorAll(".frag"));
  const n = frags.length;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39943 — even spread, no clumps

  // RADIUS, Z_NEAR, Z_FAR, TUMBLE, ASSEMBLE_DUR, ASSEMBLE_EASE, STAGGER,
  // CLOUD_SPIN_DEG, CLOUD_SPIN_DUR — named constants per "How to Choose Values".

  // Precompute each fragment's deterministic scattered state from its index.
  const scatter = frags.map((el, i) => {
    const a = i * GOLDEN;
    const depthT = n > 1 ? i / (n - 1) : 0;
    return {
      x: Math.cos(a) * RADIUS,
      y: Math.sin(a) * RADIUS,
      z: Z_NEAR - depthT * (Z_NEAR - Z_FAR),
      rotationX: Math.sin(a) * TUMBLE,
      rotationY: Math.cos(a) * TUMBLE,
    };
  });

  // 1) Park every fragment in the cloud BEFORE any tween fires.
  frags.forEach((el, i) => {
    const s = scatter[i];
    gsap.set(el, {
      xPercent: -50,
      yPercent: -50, // bake self-centering so x/y are offsets from stage center
      x: s.x,
      y: s.y,
      z: s.z,
      rotationX: s.rotationX,
      rotationY: s.rotationY,
      opacity: 0,
    });
  });

  // 2) The cloud rotates so the scatter has life before / during assembly.
  tl.to(
    ".cloud-stage",
    { rotationY: CLOUD_SPIN_DEG, duration: CLOUD_SPIN_DUR, ease: "power1.out" },
    0,
  );

  // 3) ASSEMBLE — each fragment tweens from its cloud point to its flat target.
  frags.forEach((el, i) => {
    tl.to(
      el,
      {
        x: Number(el.dataset.targetX),
        y: Number(el.dataset.targetY),
        z: 0,
        rotationX: 0,
        rotationY: 0,
        opacity: 1,
        duration: ASSEMBLE_DUR,
        ease: ASSEMBLE_EASE, // out-ease — fragments fly in then settle
      },
      i * STAGGER, // index stagger reads as "cloud collapsing inward"
    );
  });

  window.__timelines["assemble-scene"] = tl;
</script>
```

## Variations

### Tumble-swap (mid-shot hand-off between two phrases)

The signature for `kinetic-type-beats` beat changes: one phrase's glyphs scatter **into** the cloud at the same moment the next phrase's glyphs assemble **out** of it — a 3D hand-off between two states, never an empty frame. Two glyph sets share the cloud; drive both with one shared 0→1 `progress` so they cross deterministically.

```js
// outgoing[] and incoming[] are two glyph arrays, each with precomputed scatter[] (above).
const swap = { p: 0 };
tl.to(
  swap,
  {
    p: 1,
    duration: SWAP_DUR,
    ease: "power2.inOut",
    onUpdate: () => {
      const p = swap.p;
      outgoing.forEach((el, i) => {
        // 1 → 0: layout → cloud (scatters AWAY)
        const s = outScatter[i];
        const tx = Number(el.dataset.targetX);
        const ty = Number(el.dataset.targetY);
        el.style.opacity = String(1 - p);
        el.style.transform =
          `translate(-50%,-50%) translate3d(${tx + (s.x - tx) * p}px,${ty + (s.y - ty) * p}px,${s.z * p}px)` +
          ` rotateX(${s.rotationX * p}deg) rotateY(${s.rotationY * p}deg)`;
      });
      incoming.forEach((el, i) => {
        // 0 → 1: cloud → layout (assembles IN)
        const s = inScatter[i];
        const tx = Number(el.dataset.targetX);
        const ty = Number(el.dataset.targetY);
        el.style.opacity = String(p);
        el.style.transform =
          `translate(-50%,-50%) translate3d(${s.x + (tx - s.x) * p}px,${s.y + (ty - s.y) * p}px,${s.z * (1 - p)}px)` +
          ` rotateX(${s.rotationX * (1 - p)}deg) rotateY(${s.rotationY * (1 - p)}deg)`;
      });
    },
  },
  SWAP_AT,
);
```

Inject a per-glyph span set for each phrase at setup (so `targetX` per glyph is the exact laid-out advance width — measure after `document.fonts.ready`), and hide each set's opacity to 0 until its window.

### Radial letter-explode → resolve

A flat-plane special case (the `kinetic-type-beats` "letters explode radially then resolve" GAP): set `Z_NEAR = Z_FAR = 0` and `TUMBLE` small so the cloud is a 2D ring, then reverse the assemble for the explode — fragments fling out to `scatter[i]` then snap back to layout. Pure in-plane, no depth.

### Scatter-OUT (final-frame exit only)

Reverse the assemble (layout → cloud, opacity 1→0) ONLY as the composition's last beat. A scatter-out mid-shot reads as an exit and breaks the shot — keep entrances and hand-offs as assemble or tumble-swap.

### Parallax depth slide-in (logo lockup)

For `logo-assemble-lockup`, give back layers a larger `|Z_FAR|` and a longer `ASSEMBLE_DUR`, foreground parts a shallower depth and shorter duration — parts at different depths slide in at different apparent speeds (parallax) and lock into the lockup.

## How to Choose Values

- **n (ELEMENT_COUNT)** — fragments / glyphs in the cloud
  - Range: 4–14 (glyph sets follow the word length; for fragments/cards stay 4–9)
  - Effects: few reads as deliberate assembly; many reads as a dense swarm condensing
  - Constraints: above ~14 the cloud crowds the center and individual paths stop reading

- **RADIUS** — cloud spread in the x/y plane, px
  - Range: 250–700 px
  - Effects: small = a tight knot that barely separates; large = fragments arrive from the frame edges
  - Constraints: keep the farthest scatter inside frame at the chosen `perspective`, or fragments pop in from off-screen with no travel read

- **Z_NEAR / Z_FAR** — depth band of the cloud, px (front / back)
  - Range: Z_NEAR +150 to +450; Z_FAR −150 to −500
  - Effects: a wide band (e.g. +400 / −400) gives strong fly-toward / recede-from camera depth; a narrow band keeps it nearly flat
  - Constraints: very large `|z|` against a short `perspective` over-distorts (fragments smear huge then tiny) — widen `perspective` to match

- **TUMBLE** — peak rotateX/rotateY of scattered fragments, deg
  - Range: 40–110°
  - Effects: low = fragments drift in nearly upright; high = they tumble through space and rotate upright on arrival
  - Constraints: with `backface-visibility: hidden`, glyphs past 90° show blank mid-tween (intended for the tumble); for cards with content on one face, cap near 80°

- **ASSEMBLE_DUR** — per-fragment cloud → layout tween, s
  - Range: 0.7–1.4 s
  - Effects: short = snappy lock-in; long = a floating condense
  - Constraints: `(n − 1) × STAGGER + ASSEMBLE_DUR` must fit the scene's assembly window

- **ASSEMBLE_EASE** — shared ease across fragments
  - Discrete choice: `power3.out`, `expo.out`, `back.out(1.4)`
  - Selection: `power3.out` default (fly in, settle). `expo.out` snaps hard at the end. `back.out` adds a small overshoot as parts seat. Avoid `in` easings — fragments look sucked backward into the cloud mid-air.

- **STAGGER** — gap between successive fragments' assembly starts, s
  - Range: 0.03–0.09 s
  - Effects: < 0.03 = a single chord (whole cloud collapses at once); > 0.09 = a slow drip that loses the "swarm" read
  - Constraints: `n × STAGGER` should stay below `ASSEMBLE_DUR` so the cloud is collapsing as one motion, not a queue

- **CLOUD_SPIN_DEG / CLOUD_SPIN_DUR** — stage rotateY over the assembly, deg / s
  - Range: 15–60° over a duration ≥ `ASSEMBLE_DUR`
  - Effects: a gentle spin gives the scatter life so it doesn't read as a frozen explosion diagram; too fast competes with the assembly
  - Constraints: keep finite and ending by settle — no `repeat`

- **SWAP_DUR / SWAP_AT** (tumble-swap) — hand-off length / when it fires, s
  - Range: SWAP_DUR 0.5–1.0 s; SWAP_AT on the beat boundary
  - Effects: shorter = a hard cross; longer = a visible dissolve-through-cloud
  - Constraints: outgoing and incoming MUST share one `progress` (one tween) so they cross at the same instant

## Key Principles

- **`perspective` on the scene root + `preserve-3d` on stage AND each fragment** — without all three, z-depth and tumble collapse to a flat scale
- **Every scattered value is index-derived** — `cos/sin(i × GOLDEN)`, stepped `z` by `i/(n−1)`. The golden angle spreads points evenly with no clumps and (critically) **no `Math.random`**, so the cloud is byte-identical every render
- **`gsap.set` the cloud BEFORE adding tweens** — park each fragment at its scatter point with `opacity: 0` first; the assemble tweens FROM there. Skipping the set leaves frame 0 showing the assembled layout, then a teleport when the first tween starts
- **Resolve flat** — the settled state is `z: 0, rotationX: 0, rotationY: 0` in the layout. A cloud that resolves still-tilted reads as unfinished
- **Assemble / hand-off only; scatter-OUT is an exit** — fragments leaving for the cloud mid-shot reads as the shot ending. Use forward assemble for entrances, tumble-swap for beat changes; reserve scatter-out for the final frame
- **Depth ordering is automatic** — inside `preserve-3d`, paint order follows actual Z, so nearer fragments correctly occlude farther ones with no manual z-index (unlike the orbit case, where the orbit is faked in 2D and needs capped z-index)

## Critical Constraints

- **No `Math.random` / `Date.now`** — derive every scatter coordinate from the index (golden-angle trig + stepped depth). This is the whole point of the rule: a randomized cloud renders differently each frame and the seek breaks
- **No CSS `transition`** — all motion is GSAP tweens on the paused timeline
- **No `repeat` / `yoyo` / infinite** — the cloud spin and every assemble are finite, one-shot tweens that end before settle
- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Transform aliases only** — `x`, `y`, `z`, `scale`, `rotation`/`rotationX`/`rotationY`. Never `width`/`height`/`left`/`top`; `x`/`y` compose with the `xPercent/yPercent -50` self-centering
- **`will-change: transform`** on stage + fragments — many simultaneous 3D transforms benefit from compositor hints
- **In tumble-swap, one shared `progress` for both glyph sets** — two separate tweens can drift out of phase under seek and the cross stops looking like a single hand-off

## Combinations

- [orbit-3d-entry.md](orbit-3d-entry.md) — alternative 3D entrance (settles into a continuous orbit instead of a flat lockup); shares the `perspective` + `preserve-3d` stage setup
- [hacker-flip-3d.md](hacker-flip-3d.md) — per-glyph 3D flip/decode as the fragments seat; layer for a "letters tumble in AND decode on arrival" read
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — give the assembled wordmark a stacked extrusion once it locks
- [center-outward-expansion.md](center-outward-expansion.md) — flat 2D cousin (single shared center, no depth) when perspective isn't wanted
- [press-release-spring.md](press-release-spring.md) — a spring settle on the assembled lockup once the cloud resolves
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathe on the resolved layout instead of a frozen hold

## Pairs with HF skills

- `/hyperframes-animation` — timeline + `onUpdate` API (the shared-progress tumble-swap)
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
