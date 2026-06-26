---
name: ambient-glow-bloom
description: Un-triggered soft radial glow that blooms in behind a hero element and holds with a bounded idle breathe, or a single-pass traveling sweep across a surface. No click, no word-sync — it just blooms. Finite, deterministic, seek-safe.
metadata:
  tags: glow, bloom, ambient, radial, sweep, hero, presence, finite, un-triggered
---

# Ambient Glow Bloom

A soft radial glow that **blooms in behind a hero element** (card, logo, metric) and holds, giving it presence. Unlike `press-release-spring`'s click-triggered burst or `asr-keyword-glow`'s word-timed envelope, this glow is **un-triggered** — it simply blooms on the hero's settle and stays lit. Two forms: a **hero bloom** that swells behind a settling element and then breathes, and a **traveling glow sweep** that translates a soft highlight across a surface exactly once. Both are finite, deterministic, and seek-safe.

## How It Works

A radial-gradient layer sits **behind** the hero (`z-index` below it), starting at `opacity: 0`. Over the bloom-in window it ramps `opacity: 0 → peak` with a gentle `scale` swell (the halo "inflates" into place), timed to land on the hero's settle so the two read as one beat.

Two forms diverge after bloom-in:

1. **Hero bloom** — once lit, the glow does a **bounded idle breathe** during the hold. Drive it with an `onUpdate` reading `tl.time()` (NOT a `repeat: -1` yoyo): a `Math.sin` of elapsed time nudges `opacity` and `scale` a hair around their peak. At `sin(0) = 0` the breathe starts exactly at the bloom's resting state — no jump.
2. **Traveling sweep** — a narrow highlight gradient at one edge of the surface translates **once** across to the other edge (`x` from off-surface to off-surface), a single finite pass. No loop, no return. The sweep layer is clipped to the surface so the highlight only reads where it overlaps.

Peak opacity stays restrained (≤ ~0.45) so the glow gives presence without washing the frame; the glow color is darker / more saturated than the element it backs.

## HTML

```html
<div
  class="scene"
  id="bloom-scene"
  data-composition-id="bloom-scene"
  data-start="0"
  data-duration="DURATION"
  data-track-index="0"
>
  <div class="bloom-stage">
    <!-- Glow layer sits BEHIND the hero -->
    <div class="bloom-glow" id="bloom-glow"></div>
    <div class="hero-card" id="hero-card">{HeroLabel}</div>
  </div>
</div>
```

For the traveling-sweep form, the sweep layer is clipped to the surface it crosses:

```html
<div class="surface" id="surface">
  <!-- grid / wordmark / card content here -->
  <div class="sweep" id="sweep"></div>
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
  background: {bgColor};
}
.bloom-stage {
  position: relative;
  display: grid;
  place-items: center;
}
.hero-card {
  position: relative;
  z-index: 2;
  width: HERO_WIDTH;
  height: HERO_HEIGHT;
  display: grid;
  place-items: center;
  background: {heroBg};
  border-radius: HERO_RADIUS;
  font-family: {font};
  font-weight: 900;
  font-size: HERO_FONT_SIZE;
  color: {heroTextColor};
}
.bloom-glow {
  /* Radial halo behind the hero — extends past it via negative inset */
  position: absolute;
  z-index: 1;
  inset: GLOW_INSET;
  background: {glowGradient};
  opacity: 0;
  transform: scale(GLOW_START_SCALE);
  transform-origin: 50% 50%;
  pointer-events: none;
  /* will-change because opacity + scale both animate during bloom AND breathe */
  will-change: transform, opacity;
}

/* Traveling-sweep form */
.surface {
  position: relative;
  overflow: hidden; /* clips the sweep to the surface footprint */
  border-radius: SURFACE_RADIUS;
}
.sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  /* A narrow soft band, wider than it needs to be so the falloff is gentle */
  width: SWEEP_WIDTH;
  /* Diagonal highlight: angle the gradient so the sweep reads as raked light */
  background: {sweepGradient};
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const glow = document.getElementById("bloom-glow");

  // ── Form A: HERO BLOOM ──────────────────────────────────────────────
  // Phase 1 — bloom in. opacity 0 → peak + gentle scale swell, landing on
  // the hero's settle. ease "power2.out" so it arrives soft, not snappy.
  tl.fromTo(
    glow,
    { opacity: 0, scale: GLOW_START_SCALE },
    {
      opacity: GLOW_PEAK_OPACITY,
      scale: 1,
      duration: BLOOM_DUR,
      ease: "power2.out",
    },
    BLOOM_START,
  );

  // Phase 2 — bounded idle breathe during the hold. NOT a yoyo loop:
  // a single finite tween advances `phase` 0 → 2π·CYCLES; onUpdate reads it
  // and nudges opacity + scale a hair around their peak.
  // sin(0) = 0 → breathe starts exactly at the bloom's resting state.
  const phase = { p: 0 };
  tl.to(
    phase,
    {
      p: Math.PI * 2 * BREATHE_CYCLES,
      duration: BREATHE_DUR,
      ease: "none",
      onUpdate: () => {
        const s = Math.sin(phase.p);
        glow.style.opacity = String(GLOW_PEAK_OPACITY + s * OPACITY_AMP);
        glow.style.transform = `scale(${1 + s * SCALE_AMP})`;
      },
    },
    BLOOM_START + BLOOM_DUR, // breathe begins right as the bloom settles
  );

  // ── Form B: TRAVELING SWEEP ─────────────────────────────────────────
  // A single finite pass. opacity fades in, x travels from off one edge to
  // off the other, opacity fades out as it exits. One pass — no repeat.
  const sweep = document.getElementById("sweep");
  tl.fromTo(
    sweep,
    { x: SWEEP_START_X, opacity: 0 },
    {
      x: SWEEP_END_X,
      opacity: SWEEP_PEAK_OPACITY,
      duration: SWEEP_DUR,
      ease: "none", // constant glide reads as a raking light, not an ease-in object
    },
    SWEEP_START,
  );
  // Fade the trailing edge out so it doesn't pop off at the surface edge.
  tl.to(sweep, { opacity: 0, duration: SWEEP_FADE_DUR, ease: "power1.in" }, SWEEP_FADE_START);

  window.__timelines["bloom-scene"] = tl;
</script>
```

## Variations

### Bloom-and-hold (no breathe)

For very short scenes (< 3s) or when the hero already has its own idle, skip Phase 2 entirely — bloom to peak and hold flat. The single `fromTo` is the whole recipe; the glow is just lit presence.

### Pulse-on-arrival (one swell, then settle to a lower hold)

Bloom slightly **past** peak, then ease back down to a steady hold level — a single breath that punctuates the hero's landing without an ongoing loop. Two adjacent tweens (state continuity, same as `press-release-spring`):

```js
tl.fromTo(
  glow,
  { opacity: 0, scale: GLOW_START_SCALE },
  { opacity: GLOW_OVERSHOOT_OPACITY, scale: 1.06, duration: BLOOM_DUR, ease: "power2.out" },
  BLOOM_START,
);
tl.to(
  glow,
  { opacity: GLOW_HOLD_OPACITY, scale: 1, duration: SETTLE_DUR, ease: "power2.inOut" },
  BLOOM_START + BLOOM_DUR,
);
```

### Multi-hero relay (staggered blooms behind a row of cards)

Bloom each card's glow on a stagger so presence sweeps across the row. Per-glow `BLOOM_START` offset by `STAGGER` (~0.15-0.3s); shrink `OPACITY_AMP` / `SCALE_AMP` per the concurrent-elements rule below so N breathing halos don't compound into a shimmer.

### Diagonal raked sweep (wordmark sheen)

Angle `{sweepGradient}` (e.g. a 105° linear gradient) and let the band travel left→right across a wordmark or logo lockup. Reads as light raking across a surface — the classic one-pass logo sheen. Same single-pass timeline; just a narrower `SWEEP_WIDTH` and a higher `SWEEP_PEAK_OPACITY` since it's a tight highlight on a small target.

## How to Choose Values

### Glow geometry

- **GLOW_INSET** — negative inset so the radial halo extends past the hero edges.
  - Range: `-200` to `-450` px on a 1920×1080 canvas; larger halo for a bigger hero
  - Effects: too small and the glow is a tight rim, not ambient presence
- **GLOW_START_SCALE** — scale at the start of bloom-in (the halo "inflates" to 1).
  - Range: 0.80 (clear inflation) → 0.92 (subtle) → 1.0 (no swell, opacity-only bloom)
  - Constraints: keep ≤ 1.0 — the swell should grow into place, not shrink

### Bloom-in dynamics

- **BLOOM_DUR** — bloom-in duration.
  - Range: 0.6-1.4s; longer for a hero that's still settling so they land together
  - Effects: shorter → the glow "snaps on"; longer → it suffuses in (the ambient feel)
- **BLOOM_START** — when the bloom begins.
  - Constraints: align so `BLOOM_START + BLOOM_DUR` ≈ the hero's settle frame, so glow and hero resolve as one beat — not glow-then-card or card-then-glow
- **GLOW_PEAK_OPACITY** — peak halo opacity.
  - Range: 0.15 (subtle) → 0.30 (default) → 0.45 (dramatic)
  - **Constraints: ≤ 0.45** — higher washes the whole frame and the hero loses contrast against its own glow

### Idle breathe (hero-bloom form)

- **BREATHE_DUR** — breathe tween length.
  - Constraints: equals `TOTAL_DURATION − (BLOOM_START + BLOOM_DUR)` to fill the hold with motion
- **BREATHE_CYCLES** — number of full breaths across `BREATHE_DUR`.
  - Range: `BREATHE_DUR / 4s ≤ CYCLES ≤ BREATHE_DUR / 2.5s` (a 2.5-4s breath period reads as a slow ambient pulse — glow breathing wants to be slower than element breathing)
- **OPACITY_AMP** — sine amplitude on opacity around the peak.
  - **Default: 0.02-0.05** (barely-perceptible pulse — the right answer for most scenes)
  - Constraints: `GLOW_PEAK_OPACITY + OPACITY_AMP` must stay ≤ 0.45
- **SCALE_AMP** — sine amplitude on the halo scale.
  - **Default: 0.01-0.03** (the halo "breathes" without visibly resizing)
  - Push higher only when the glow is the sole motion in a short isolated scene

### Traveling sweep

- **SWEEP_WIDTH** — width of the soft highlight band.
  - Range: 15-35% of the surface width (a wide soft band) for a grid sheen; 8-15% for a tight wordmark sheen
- **SWEEP_START_X / SWEEP_END_X** — travel endpoints, both fully off-surface.
  - Constraints: start ≈ `-(SWEEP_WIDTH + edge)`, end ≈ `surfaceWidth + edge` — the band must enter from fully off one edge and exit fully off the other, so there's no visible spawn/despawn mid-surface
- **SWEEP_DUR** — single-pass travel duration.
  - Range: 0.8-1.6s; one deliberate pass, slow enough to read as light, fast enough not to dominate
- **SWEEP_PEAK_OPACITY** — highlight opacity.
  - Range: 0.10 (whisper sheen) → 0.25 (default) → 0.40 (bright rake)
  - Constraints: ≤ ~0.45 (same wash limit); tighter sweeps tolerate the high end
- **SWEEP_START / SWEEP_FADE_START / SWEEP_FADE_DUR** — when the pass runs and tails out.
  - Constraints: `SWEEP_FADE_START + SWEEP_FADE_DUR ≈ SWEEP_START + SWEEP_DUR` so opacity reaches 0 exactly as the band clears the far edge

### Tokens

- **{glowGradient}** — radial-gradient, saturated near center fading to transparent. Color should be **darker + more saturated** than `{heroBg}` — a same-color glow looks washed out (same rule as `press-release-spring`'s burst).
- **{sweepGradient}** — a soft band: `transparent → highlight → transparent`. For a sheen, a near-white or brand-tint highlight at low alpha; angle it (e.g. `linear-gradient(105deg, …)`) for a raked look.
- **{heroBg} / {heroTextColor}** — the hero surface the glow backs; high contrast so the lit hero still reads against its halo.

## Key Principles

- **Un-triggered by design** — this glow does NOT wait on a click (`press-release-spring`) or a word timestamp (`asr-keyword-glow`). It blooms on the hero's settle as ambient presence. If you need a triggered burst, reach for one of those rules instead.
- **Glow behind, hero in front** — glow `z-index: 1`, hero `z-index: 2`. A glow in front occludes the hero at peak opacity.
- **Glow color darker + more saturated than the element** — bright hero → dark, saturated halo. A same-hue, same-lightness glow disappears into the surface.
- **Land glow and hero as ONE beat** — time `BLOOM_START + BLOOM_DUR` to the hero's settle. A glow that arrives before or after the card reads as two separate events; arriving together reads as the card "powering on."
- **Restrained peak — default to the LOW end.** `GLOW_PEAK_OPACITY` 0.15-0.30 for most scenes; 0.45 is a hard ceiling. A glow you consciously notice is too strong — it should register as the hero having weight, not as a visible light source.
- **Breathe is BOUNDED, never a loop** — the idle pulse is a finite `onUpdate` tween reading `tl.time()` (via the `phase` proxy), not `repeat: -1` / `yoyo`. `sin(0) = 0` means it starts at the bloom's resting state with no jump. (Same reason as `sine-wave-loop`: an infinite/CSS loop desyncs from the HF seek clock.)
- **Sweep is ONE pass** — the traveling highlight enters off one edge and exits off the other a single time. No return trip, no loop. A repeating sweep reads as a loading shimmer, not a one-time reveal accent.
- **Concurrent halos compound** — N breathing glows in a row add up. Per-glow `OPACITY_AMP` and `SCALE_AMP` ≤ default `/ √N`, and stagger the breathe period (2.6s / 2.9s / 3.3s) so they don't pulse in lockstep. (Same `/√N` discipline as `sine-wave-loop`'s concurrent-elements rule.)
- **Don't combine `boxShadow` glow on the hero with this halo layer** — they compete in the layout pipeline and the result reads muddy. Put the glow on the dedicated `.bloom-glow` layer, not as a shadow on the hero.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on the glow / sweep — interpolates independently of HF seek and flickers
- **No `repeat` / `yoyo` / `repeat: -1`** — the breathe is a bounded finite tween; the sweep is one pass
- **No `Math.random` / `Date.now`** — the breathe phase is deterministic (`phase.p` over a fixed duration)
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation` — plus `opacity` / `filter`. Never tween `width` / `height` / `left` / `top` (the halo swell is `scale`, the sweep travel is `x`).
- **`will-change: transform, opacity`** on the glow — it animates both during bloom-in and the breathe
- **Glow peak `opacity ≤ 0.45`** — higher washes the composition
- **Sweep endpoints fully off-surface** — band must enter and exit beyond the clipped edges so it never spawns/despawns mid-frame

## Combinations

- [sine-wave-loop.md](sine-wave-loop.md) — pair the hero-bloom form with a sine breathe on the hero element itself; the glow breathes on opacity, the hero breathes on scale/y, slightly out of phase for a layered "alive" hold
- [press-release-spring.md](press-release-spring.md) — distinct sibling: that rule's `bg-glow` is **click-triggered**, this one is un-triggered. Don't run both behind the same element
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — bloom the accent halo behind the hero stat card on the count-up's settle (the `dataviz-countup` blueprint's "soft accent glow blooms behind the hero metric" beat)
- [stat-bars-and-fills.md](stat-bars-and-fills.md) — glow blooms behind the hero metric + its paired graphic as they land together
- [center-outward-expansion.md](center-outward-expansion.md) — run the traveling-sweep across the assembled layout once it resolves (the `grid-card-assemble` blueprint's "traveling-glow sweep across the assembled grid")

## Pairs with HF skills

- `/hyperframes-animation` — `onUpdate` writing opacity/transform + bounded sine breathe
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
