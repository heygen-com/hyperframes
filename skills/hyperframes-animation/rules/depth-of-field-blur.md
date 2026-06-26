---
name: depth-of-field-blur
description: Selective-focus rack-focus — pull the eye to a focal element by GSAP-tweening filter blur (+ a small opacity dim) on the off-focus layers while the focal one stays sharp. Drive blur via a `--dof` CSS var; finite tweens, no CSS transition, deterministic. Covers single focal pull, rack-focus between two depth planes, and blur-the-cluster-while-pushing-in.
metadata:
  tags: blur, focus, depth-of-field, dof, rack-focus, filter, dim, spotlight, cinematic, push-in
---

# Depth-of-Field Blur (Selective Focus / Rack Focus)

Pulls the eye to one focal element by **blurring** (and slightly **dimming**) everything around it while the focal layer stays sharp — the camera's depth-of-field falling off the background, or a rack-focus shifting which plane is in focus. The motion is `filter: blur(Npx)` plus a small `opacity` dim, tweened from sharp(0) to blurred over the focus-shift window — both seek-safe, since `filter` and `opacity` are paint-only properties HF interpolates correctly frame-by-frame.

This is the backing rule for the focus-falloff beat the blueprints keep reaching for: the outer nodes blurring during the push-in (`constellation-hub`), the rack-focus across a parallax card stack (`cursor-ui-demo`), and the non-highlighted cards dimming + blurring to spotlight the hero metric (`dataviz-countup`). Each of those flags "no backing rule" for the DoF half of the move — this is it.

## How It Works

Every layer carries a `--dof` custom property (px of blur), read by `filter: blur(var(--dof))`, plus its own `opacity`. A single GSAP tween advances each layer's `--dof` from `0` to its target blur and its opacity from `1` to a dim level, over the focus-shift window. The focal layer's tween targets `--dof: 0` (stays sharp); the off-focus layers target a positive blur.

Three mechanics, same primitive:

1. **Focal pull** — one window: off-focus layers go sharp(0) → blurred while the focal layer holds at 0. The eye is pulled to the only thing still crisp.
2. **Rack focus** — two adjacent windows on the same property: focus releases plane A (its blur ramps 0 → max) at the same position plane B's blur ramps max → 0. State continuity matters exactly as in `press-release-spring`: A's resting blur after the rack must be the value B held before it, so authoring the two as adjacent tweens on the same `--dof` is what makes the hand-off seamless.
3. **Blur-the-cluster-while-pushing-in** — the DoF tween runs concurrently with a camera push-in (`multi-phase-camera` / `coordinate-target-zoom`): the surrounding cluster blurs + dims on the SAME timeline position as the camera scales toward the focal core, so "the world recedes" and "we push in" read as one move.

Because the blur is a tween target (not a CSS `transition`), the renderer can land it at any frame — and because each layer's target is derived from its index / a data attribute (never `Math.random`), the falloff is identical on every seek.

## HTML

```html
<div
  class="scene"
  id="dof-scene"
  data-composition-id="dof-scene"
  data-start="0"
  data-duration="DURATION"
  data-track-index="0"
>
  <div class="world" id="world">
    <!-- Focal layer — stays sharp -->
    <div class="layer focal" id="focal" data-dof="0">{FocalLabel}</div>

    <!-- Off-focus layers — blur + dim. data-depth orders them near→far
         so the falloff can scale blur by depth (see Variations). -->
    <div class="layer ctx" data-depth="1">{Context A}</div>
    <div class="layer ctx" data-depth="2">{Context B}</div>
    <div class="layer ctx" data-depth="3">{Context C}</div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: {bgGradient};
}
.world {
  /* Single wrapper so a concurrent camera push-in (multi-phase-camera)
     transforms everything together; DoF is independent of the camera. */
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: 50% 50%;
}
.layer {
  /* --dof is the px of blur; filter reads it. Starts sharp. */
  --dof: 0px;
  filter: blur(var(--dof));
  /* will-change: filter — promotes the layer so the blur is cheap to
     re-rasterize each frame. See the perf note in Key Principles. */
  will-change: filter;
  font-family: {font};
  font-weight: 900;
  color: {textColor};
}
.focal {
  /* Sits above the context layers and never blurs. */
  z-index: 2;
  font-size: FOCAL_FONT_SIZE;
}
.ctx {
  /* The off-focus plane(s). Smaller / grouped so the blur radius can
     stay modest yet still read — blurring a small layer is cheap. */
  z-index: 1;
  font-size: CTX_FONT_SIZE;
  opacity: 1;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const ctx = gsap.utils.toArray(".ctx");

  // ── Mechanic 1: FOCAL PULL ─────────────────────────────────────────
  // Off-focus layers blur + dim from sharp to defocused over the
  // focus-shift window. Blur scales with data-depth so far planes blur
  // more than near ones (deterministic — derived from the attribute,
  // never Math.random).
  ctx.forEach((el) => {
    const depth = Number(el.dataset.depth) || 1;
    const targetBlur = BLUR_PER_DEPTH * depth; // px
    tl.to(
      el,
      {
        "--dof": `${targetBlur}px`,
        opacity: DIM_LEVEL, // e.g. 0.55 — dim, not gone
        duration: FOCUS_DUR,
        ease: "power2.inOut",
      },
      FOCUS_START,
    );
  });
  // Focal layer is already sharp (--dof:0, opacity:1) and untouched.

  window.__timelines["dof-scene"] = tl;
</script>
```

## Variations

### Rack focus between two depth planes (foreground ⇄ background)

Two adjacent tweens on the same `--dof` per plane — focus leaves plane A as it lands on plane B. State continuity: B's _resting_ blur before the rack equals what A holds after, so the hand-off has no jump.

```js
// Start: A sharp, B pre-blurred (set BEFORE the rack so there's no pop).
gsap.set("#planeA", { "--dof": "0px", opacity: 1 });
gsap.set("#planeB", { "--dof": `${MAX_BLUR}px`, opacity: DIM_LEVEL });

// Rack: A defocuses while B comes into focus, same position + duration.
tl.to(
  "#planeA",
  { "--dof": `${MAX_BLUR}px`, opacity: DIM_LEVEL, duration: RACK_DUR, ease: "power2.inOut" },
  RACK_START,
);
tl.to(
  "#planeB",
  { "--dof": "0px", opacity: 1, duration: RACK_DUR, ease: "power2.inOut" },
  RACK_START,
);
```

### Blur the cluster while pushing in (DoF + camera, one beat)

Run the focal-pull tween at the **same timeline position** as a camera push-in so the surrounding cluster recedes into blur exactly as the camera scales toward the core. The camera transforms `.world`; the DoF tweens the layers — independent properties, no conflict.

```js
// Camera push-in toward the focal core (see multi-phase-camera / coordinate-target-zoom).
tl.to(
  "#world",
  { scale: PUSH_SCALE, x: PUSH_X, y: PUSH_Y, duration: FOCUS_DUR, ease: "power2.inOut" },
  FOCUS_START,
);
// Cluster blurs + dims on the SAME position — "the world recedes as we push in."
ctx.forEach((el) => {
  const depth = Number(el.dataset.depth) || 1;
  tl.to(
    el,
    {
      "--dof": `${BLUR_PER_DEPTH * depth}px`,
      opacity: DIM_LEVEL,
      duration: FOCUS_DUR,
      ease: "power2.inOut",
    },
    FOCUS_START,
  );
});
```

### Spotlight a hero metric in a card grid (dim + blur the rest)

The `dataviz-countup` beat: a subset of grid cards stays sharp (the hero metric) while the remainder dim + blur. Tag the hero(es) and skip them; everything else defocuses on one shared window.

```js
gsap.utils.toArray(".card:not(.hero)").forEach((el) => {
  tl.to(
    el,
    { "--dof": `${GRID_BLUR}px`, opacity: DIM_LEVEL, duration: FOCUS_DUR, ease: "power2.out" },
    FOCUS_START,
  );
});
```

### Refocus / settle (release the blur before the scene ends)

If the beat resolves back to "everything visible" (or hands off to a crossfade that needs a clean outgoing frame), ramp the blur back to 0 over the tail so the scene settles sharp instead of mid-defocus.

```js
ctx.forEach((el) =>
  tl.to(
    el,
    { "--dof": "0px", opacity: 1, duration: REFOCUS_DUR, ease: "power2.inOut" },
    REFOCUS_START,
  ),
);
```

### Bounded focus-breathing on the focal layer (optional)

For a subtle "rack settling" feel, let the focal layer's blur breathe a hair around 0 during its hold — a _finite_ `ease:"none"` driver writing `sin()` into `--dof` (never `repeat:-1`, never a CSS animation). Keep the amplitude well under 1px or it reads as "still focusing."

```js
const drift = { p: 0 };
tl.to(
  drift,
  {
    p: Math.PI * 2 * BREATH_CYCLES,
    duration: BREATH_DUR,
    ease: "none",
    onUpdate: () => {
      const b = Math.max(0, Math.sin(drift.p)) * FOCAL_BREATH_PX; // ≤ ~0.6px
      document.getElementById("focal").style.setProperty("--dof", `${b}px`);
    },
  },
  BREATH_START,
);
```

## How to Choose Values

### Geometry / layout

- **FOCAL_FONT_SIZE / CTX_FONT_SIZE** — focal vs context sizing.
  - Range: focal is the visual lead; context layers smaller so a modest blur radius still reads as "out of focus."
  - Effects: small context layers let you use a smaller `BLUR_PER_DEPTH` (cheaper) yet still look soft.
- **z-index** — focal `z-index: 2`, context `z-index: 1`.
  - Constraints: the sharp focal layer must sit **above** the blurred ones, or its crisp edges read as bleeding into the haze.

### Blur amounts

- **BLUR_PER_DEPTH** — px of blur added per depth step (`data-depth`).
  - Range: 3-6 px per step (a 3-plane stack tops out at ~9-18 px)
  - Effects: low → gentle DoF; high → strong miniature/tilt-shift falloff
  - Constraints: keep **per-layer blur ≤ ~24 px on large layers** — radius cost grows with both blur and area; large radius over a full-frame element is the expensive case (see Key Principles)
- **MAX_BLUR** — terminal blur for a fully-defocused plane (rack / focal-pull peak).
  - Range: 8 (soft) → 16 (default) → 24 (heavy) px
  - Constraints: above ~24 px on a big surface, prefer scaling the layer down or grouping its contents so the blurred footprint shrinks
- **GRID_BLUR** — blur on dimmed grid cards (spotlight variation).
  - Range: 6-12 px — enough to push them back without losing the grid's shape

### Dim amounts

- **DIM_LEVEL** — opacity of off-focus layers at full defocus.
  - Range: 0.4 (strong push-back) → 0.55 (default) → 0.7 (subtle)
  - Effects: lower → context recedes hard / near-spotlight; higher → still legibly present, just secondary
  - Constraints: rarely below 0.35 — fully dark off-focus layers read as "removed," not "defocused"

### Timing

- **FOCUS_START / FOCUS_DUR** — when the focal pull begins and how long the rack takes.
  - Range: `FOCUS_DUR` 0.5-1.2 s — a rack/pull is a deliberate move, not a snap
  - Effects: shorter → urgent "snap focus"; longer → languid cinematic rack
- **RACK_START / RACK_DUR** — rack-focus window (foreground ⇄ background).
  - Constraints: both planes' tweens share `RACK_START` and `RACK_DUR` so they cross at the midpoint; `gsap.set` the pre-blurred plane BEFORE `RACK_START`
- **REFOCUS_START / REFOCUS_DUR** — settle-back window.
  - Constraints: `REFOCUS_START + REFOCUS_DUR ≤ DURATION` so the scene actually reaches sharp before it ends / hands off
- **PUSH_SCALE / PUSH_X / PUSH_Y** (cluster-while-pushing-in variation) — camera move on `.world`.
  - Constraints: shares `FOCUS_START` + `FOCUS_DUR` with the DoF tween so move and defocus read as one beat; counter-translate math lives in `coordinate-target-zoom` / `viewport-change`
- **BREATH_CYCLES / BREATH_DUR / FOCAL_BREATH_PX** (focus-breathing variation).
  - Range: `FOCAL_BREATH_PX ≤ 0.6` px; period 2-3 s; this is a barely-there nicety, default to omitting it

### Tokens

- **{bgGradient}** — typically dark so the sharp focal layer reads as lit and forward
- **{textColor}** — high-contrast on `{bgGradient}`; the blur softens edges, so don't rely on hairline contrast
- **{font}** — display weight; blurred copy needs heavy weight to stay shape-legible when defocused

## Key Principles

- **`--dof` drives the blur; tween the variable, never a CSS `transition`.** Reading `filter: blur(var(--dof))` and animating `--dof` on the GSAP timeline keeps the blur on the HF seek clock. A CSS `transition` on `filter` interpolates on the browser's own clock and flickers/desyncs under frame-by-frame seek.
- **Blur the SMALL / GROUPED layers, not the giant one.** Filter-blur cost scales with both radius and the blurred element's pixel area. A 20 px blur on a full-frame background is the worst case; the same blur on a smaller context card, or on a single grouped wrapper, is cheap. Prefer pushing the focal plane _forward and sharp_ over cranking the background blur radius.
- **`will-change: filter`** on every layer that animates its blur — promotes it to its own layer so the re-rasterization each frame is cheap. Drop it once the blur settles if the layer also does heavy transform work.
- **Keep the radius modest.** ≤ ~24 px on large surfaces; lean on the `opacity` **dim** to do the "push it back" work alongside a smaller blur, rather than blur alone. Dim + modest blur reads more like real DoF than blur cranked to the max.
- **Focal layer stays genuinely sharp** — its `--dof` is `0` and untouched (or breathes ≤0.6 px). Any visible blur on the focal element kills the "this is the thing" read.
- **State continuity on a rack** — the plane coming OUT of focus must start the rack at the blur the incoming plane _was_ holding, and vice-versa; author both as tweens on the same `--dof` at the same position so the cross is seamless (same rule as `press-release-spring`'s press↔release).
- **DoF is independent of the camera** — blur the layers, transform `.world` for the push-in. They're different property channels, so they compose without fighting. Don't try to fake DoF with the camera transform or vice-versa.
- **Settle sharp before a hand-off** — if the next beat is a crossfade/push, refocus to `--dof:0` in the tail so the outgoing frame is crisp; handing off mid-defocus reads as "the render glitched."

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on `filter` / `opacity` — animate `--dof` and `opacity` on the timeline instead
- **No `repeat` / `yoyo` / infinite tweens** — the focus pull is a finite tween; any breathing is a bounded `onUpdate` reading the driver phase (or a finite tween), never `repeat:-1`
- **No `Math.random` / `Date.now`** — per-layer blur is derived from `data-depth` / element index so every seek is identical
- **Tween `filter` (blur) + `opacity` only here** — both paint-only and seek-safe. Use GSAP transform aliases (`x`, `y`, `scale`) for any concurrent camera move; never tween `width` / `height` / `left` / `top`
- **`will-change: filter`** on layers whose blur animates; keep the blurred footprint small
- **Per-layer blur radius ≤ ~24 px on large surfaces** — beyond that the cost (and visible banding) climbs; shrink/group the layer instead

## Combinations

- [multi-phase-camera.md](multi-phase-camera.md) — the push-in / push-through whose focus-falloff this rule supplies; run the DoF tween at the same position as the PUSH phase
- [coordinate-target-zoom.md](coordinate-target-zoom.md) — zoom onto the focal core while the off-center layers blur (the `constellation-hub` hook)
- [viewport-change.md](viewport-change.md) — pan across a tilted card plane with a rack-focus between near and far cards (the `cursor-ui-demo` focus-pull)
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — the hero metric counts up sharp while the surrounding cards dim + blur (the `dataviz-countup` spotlight)
- [3d-page-scroll.md](3d-page-scroll.md) — the parallax card stack whose planes you rack focus between
- [sine-wave-loop.md](sine-wave-loop.md) — the focal layer idle-breathes after the rack settles (keep idle amplitude and focus-breath both tiny)

## Pairs with HF skills

- `/hyperframes-animation` — tweening a CSS custom property + multi-tween coordination
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
