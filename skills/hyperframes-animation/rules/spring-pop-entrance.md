---
name: spring-pop-entrance
description: The canonical entrance pop — an element (or staggered group) arrives by scaling 0 → 1 on a smooth long-tail settle (power3 default); bouncy overshoot is a rare, explicitly-playful exception. fromTo so it's correct at t=0 under seek.
metadata:
  tags: spring, entrance, pop, scale, power3, settle, stagger, reveal, arrival
---

# Spring-Pop Entrance

> **Smooth beats bouncy.** Per the motion doctrine (`references/motion-language.md`), this entrance **defaults to a smooth long-tail settle — `power3.out` (or `expo.out` for a faster arrival)** that decelerates cleanly into the resting size with **no overshoot**. Bouncy `back.out` overshoot is the **#1 instant turn-off** in agent-made videos and is almost never executed well; it is demoted here to a **rare, explicitly-playful exception** (a consumer / fun brand), never the default. When unsure, settle smoothly.

THE entrance primitive: an element (or a staggered group of them) arrives on screen by springing from nothing — `scale: 0 → 1`, optionally with a small `y` rise — riding a **smooth long-tail ease (`power3.out` default)** so it grows confidently into its resting size and settles without bouncing. This is **arrival**, not reaction.

Explicitly distinct from [press-release-spring.md](press-release-spring.md): that rule is a click/press → release feedback chain (a press phase, then a spring recovery to `1.0`). This one has **no press phase** — there is no prior resting state, the element did not exist on screen, it springs into being. Many blueprints used to borrow `press-release-spring` to fake an entrance; reach for this instead.

## How It Works

A single `fromTo` carries the whole arrival:

1. **From-state**: `{ scale: 0, opacity: 0 }` — the element is collapsed to a point and invisible. Stated explicitly in the `from` object so a seek to `t=0` lands the element in this exact state (never rely on a CSS-hidden start — see Critical Constraints).
2. **To-state (default)**: `{ scale: 1, opacity: 1, ease: "power3.out" }` — a long-tail decel that grows the element into its resting size and **settles smoothly, no overshoot**. Use `expo.out` instead for a punchier, faster-front arrival (still no bounce). This smooth settle is the house style; the bouncy `back.out` variant is the rare playful exception (see Variations).

For a **group**, the same `fromTo` runs per element with a **deterministic, index-derived stagger** (`i * STAGGER`), and the total entry window is **capped** (`ITEM_COUNT × STAGGER ≤ ~0.5s`) so the group reads as one arriving beat, not a slow arpeggio.

A small `y` rise (`y: 24 → 0`) layers a subtle "lifts into place" on top of the pop — optional garnish; the `scale` grow on a smooth ease is the load-bearing motion. (A `rotation` settle belongs only to the playful overshoot variant below.)

## HTML

```html
<!-- Single hero pop -->
<div
  class="scene"
  data-composition-id="pop-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="pop-hero" id="hero">{heroLabel}</div>
</div>

<!-- Staggered group: nodes / cards / icons / pills / callouts -->
<div
  class="scene"
  data-composition-id="pop-group-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="pop-grid">
    <div class="pop-item">{itemA}</div>
    <div class="pop-item">{itemB}</div>
    <div class="pop-item">{itemC}</div>
    <div class="pop-item">{itemD}</div>
    <div class="pop-item">{itemE}</div>
    <div class="pop-item">{itemF}</div>
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
  background: {bgColor};
}
.pop-hero {
  display: grid;
  place-items: center;
  width: {heroSize};
  height: {heroSize};
  background: {heroBg};
  border-radius: HERO_RADIUS;
  font-family: {font};
  font-weight: 900;
  font-size: HERO_FONT_SIZE;
  color: {heroTextColor};
  /* Pop scales around the center — see Critical Constraints */
  transform-origin: 50% 50%;
  will-change: transform;
}
.pop-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: GRID_GAP;
  place-items: center;
}
.pop-item {
  display: grid;
  place-items: center;
  width: {itemSize};
  height: {itemSize};
  background: {itemBg};
  border-radius: ITEM_RADIUS;
  font-family: {font};
  font-weight: 800;
  font-size: ITEM_FONT_SIZE;
  color: {itemTextColor};
  transform-origin: 50% 50%;
  will-change: transform;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // --- Single hero pop (default: smooth long-tail settle, no overshoot) ---
  // fromTo states the collapsed start explicitly so the hero is correct at t=0
  // under seek. power3.out grows scale into 1.0 and decelerates smoothly.
  tl.fromTo(
    "#hero",
    { scale: 0, opacity: 0 },
    {
      scale: 1,
      opacity: 1,
      duration: POP_DUR,
      ease: "power3.out", // smooth beats bouncy; expo.out for a punchier front
    },
    ENTRY_AT,
  );

  // --- Staggered group pop ---
  // Deterministic, index-derived stagger (no Math.random). The cap keeps the
  // whole group inside one arriving beat: ITEM_COUNT * STAGGER <= ~0.5s.
  const items = gsap.utils.toArray(".pop-item");
  items.forEach((el, i) => {
    tl.fromTo(
      el,
      { scale: 0, opacity: 0, y: Y_RISE },
      {
        scale: 1,
        opacity: 1,
        y: 0,
        duration: POP_DUR,
        ease: "power3.out",
      },
      GROUP_ENTRY_AT + i * STAGGER,
    );
  });

  window.__timelines["pop-scene"] = tl;
</script>
```

## Variations

### Calm settle (refined / enterprise / "premium calm") — default

`power3.out`, no rotation, drop the `y` rise or keep it tiny (~12px). Reads as a confident, weighted settle — right for a hero wordmark or a single product shot landing. The safe default for premium / enterprise brands.

### Firm settle (default product reveal) — default

The everyday entrance. `power3.out` (or `expo.out` for a punchier front), optional `Y_RISE` ~24px. Clear, deliberate arrival that decelerates clean — the safe default for cards, icons, and callouts. **No overshoot.**

### Bouncy pop (RARE — explicitly-playful only)

The exception, not the default. **Only** for a deliberately playful register (a consumer / fun brand, a toy-like icon set) where a bounce is clearly the intent — never for product / enterprise / serious launch tone. Bouncy is the #1 turn-off and the agent rarely lands it, so reach for this knowingly and sparingly. Swap `power3.out` for `back.out(OVERSHOOT)` and (optionally) add a `rotation` settle so each element looks hand-placed:

```js
// Playful exception only — default to power3.out (see above).
tl.fromTo(
  el,
  { scale: 0, opacity: 0, rotation: ROT_FROM },
  { scale: 1, opacity: 1, rotation: 0, duration: POP_DUR, ease: `back.out(${OVERSHOOT})` },
  GROUP_ENTRY_AT + i * STAGGER,
);
```

Keep `OVERSHOOT` modest even here (≤ ~2) — past that it reads as a cartoon wobble, not an arrival.

### Origin-anchored pop (callout springs from a pointer / source)

When a callout should appear to grow out of a specific point (e.g. a station marker or pointer tip), set `transform-origin` to that point instead of center, so the `scale: 0 → 1` reads as "emerging from the source" rather than "inflating in place."

```css
.callout {
  transform-origin: 0% 100%; /* bottom-left = pointer tip; match to the anchor */
}
```

### Pop into a held slot — then hold (jitter at most)

When a popped element then **holds** an ongoing slot (a constellation node, a persistent badge), do **not** bake an idle loop into this entrance — it must stay finite. Land the pop and let it hold still; if the held frame genuinely needs life, hand off to [sine-wave-loop.md](sine-wave-loop.md) for **subtle jitter** (low amplitude) on a separate, later tween — not a breathing loop. Prefer revealing the next element on its VO cue over keeping this one animating.

## How to Choose Values

- **EASE** — the settle curve (the load-bearing decision)
  - Default: **`power3.out`** — a smooth long-tail settle, no overshoot; the house style for product / enterprise / serious tone. Use `expo.out` for a punchier, faster-front arrival (still smooth).
  - Playful exception only: `back.out(OVERSHOOT)` — see the Bouncy pop variation; reach for it only when a bounce is clearly the brand intent.

- **OVERSHOOT** — `back.out(OVERSHOOT)` overshoot strength — **only used in the rare bouncy variant**; the smooth default has no overshoot dial
  - Range (playful only): ~1.3 (barely) → ~2.0 (clearly bouncy)
  - Constraints: keep ≤ ~2 — past that the overshoot exceeds the element's bounds and reads as a cartoon wobble, not an arrival. If you're not in the explicitly-playful case, don't use this — use `power3.out`.

- **POP_DUR** — duration of each element's `scale: 0 → 1` tween
  - Range: 0.4 – 0.7 s
  - Effects: shorter = tight snap; longer = a looser, more floating pop
  - Constraints: the main subject must be visible by **`t ≤ 0.5s`** — keep `ENTRY_AT + POP_DUR`'s readable midpoint early; don't let the hero finish arriving after the half-second mark

- **STAGGER** — gap between successive items' start times (group only)
  - Range: 0.04 – 0.08 s
  - Effects: < 0.04 reads as a simultaneous chord; > 0.08 feels lazy / arpeggiated
  - Constraints: **`ITEM_COUNT × STAGGER ≤ ~0.5s`** (the cap) — beyond that the group stops reading as one beat. Cap the per-item stagger for large groups: `STAGGER = min(0.06, 0.5 / ITEM_COUNT)`

- **ITEM_COUNT** — number of elements in a group pop
  - Range: 3 – 9
  - Effects: 3 = sparse; 9 = full grid. More than ~9 forces `STAGGER` so small the stagger vanishes — switch to a wipe/sweep reveal instead

- **Y_RISE** — optional upward offset the element lifts from (`y: Y_RISE → 0`)
  - Range: 0 (pure pop) – 32 px
  - Effects: adds a subtle "lifts into place"; keep small so the `scale` pop stays dominant
  - Constraints: 0 for the calm-settle variant; never large enough to read as a slide-up (that's a different primitive)

- **ROT_FROM** — optional starting rotation, **playful (bouncy) variant only** (`rotation: ROT_FROM → 0`)
  - Range: −10° – +10°
  - Effects: a small tilt that resolves makes the element look hand-placed
  - Constraints: derive sign/size deterministically from index if you want alternating tilt (e.g. `i % 2 ? 6 : -6`) — never `Math.random`

- **ENTRY_AT / GROUP_ENTRY_AT** — timeline offset before the (group's) pop begins
  - Range: 0 – 0.4 s
  - Effects: > 0 gives a beat of quiet before the arrival; keep small so the subject still lands by `t ≤ 0.5s`

### Geometry & tokens

- **{heroSize} / {itemSize}** — footprints. A hero entrance should occupy a clearly readable share of the frame; group items size down so the grid fits with `GRID_GAP` breathing room.
- **HERO_RADIUS / ITEM_RADIUS** — `height × 0.15` (sharp) → `height / 2` (pill).
- **{heroBg} / {itemBg} / {\*TextColor}** — surface + label tokens; inherit from the composition palette.

## Key Principles

- **Smooth beats bouncy** — default to `power3.out` (or `expo.out`): a long-tail settle into `scale: 1`, no overshoot. Bouncy `back.out` is the rare, explicitly-playful exception (the #1 turn-off, and the agent rarely lands it). When unsure, settle smoothly.
- **fromTo, always** — the collapsed `{ scale: 0, opacity: 0 }` start is stated in the `from` object so a seek to `t=0` lands it exactly there. An entrance built on a CSS-hidden start (e.g. `opacity:0` in CSS + a `.to()`) flickers under HF seek — the element renders visible before the tween claims it.
- **Easing carries the motion, not keyframes** — let the ease produce the settle for free. Don't hand-key a `scale: 1.1` mid-state; that double-bounces and fights the curve. (And in the playful variant, the overshoot is a byproduct of `back.out`, not a hand-keyed bounce.)
- **The grow is the motion** — `scale` is load-bearing; the `y` rise (and, in the playful variant, the `rotation` settle) is garnish layered on top. If you drop everything but the `scale` grow, it should still read as a clean entrance.
- **Cap the stagger window** — a group must arrive inside ~0.5s total or it stops reading as one beat and starts reading as a slow list reveal. Derive the stagger from `ITEM_COUNT` so it self-caps.
- **Deterministic per index** — all stagger and any rotation/tilt variation comes from the loop index, never `Math.random` — the renderer must produce the identical frame on every seek.
- **Visible early** — the main subject must be on screen by `t ≤ 0.5s`. A hero that finishes arriving at `t=1s` wastes the opening beat.
- **Don't bake an idle loop here** — this entrance is finite. If the element then holds a slot, hand off to `sine-wave-loop` on a later tween; an infinite `repeat`/`yoyo` here breaks seek.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Entrances use `fromTo`** — explicit `{ scale: 0, opacity: 0 }` from-state; never rely on a CSS-hidden starting state
- **No CSS `transition`** on popped elements — those interpolate independently of HF seek and cause flicker
- **No `repeat` / `yoyo` / infinite tweens** — this is a finite arrival; idle motion is a separate `sine-wave-loop` tween
- **No `Math.random` / `Date.now`** — stagger and tilt are index-derived and deterministic
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never tween `width` / `height` / `left` / `top`
- **`transform-origin: 50% 50%`** for an in-place pop (default); set it to the source point only for the origin-anchored variation
- **Default ease `power3.out`** (smooth, no overshoot); `back.out(OVERSHOOT)` only in the explicitly-playful variant, and there keep **`OVERSHOOT ≤ ~2`** — beyond that it reads as a cartoon wobble, not an arrival
- **`ITEM_COUNT × STAGGER ≤ ~0.5s`** — the group must land inside one beat
- **`will-change: transform`** on popped elements, especially groups — many simultaneous spring tweens benefit from compositor hints

## Combinations

- [sine-wave-loop.md](sine-wave-loop.md) — at most **subtle jitter** on a held node/badge AFTER its pop lands (don't bake any loop into the entrance; and prefer a VO-timed reveal over ambient motion — see that rule's caution)
- [center-outward-expansion.md](center-outward-expansion.md) — elements pop in as they radiate from center to their slots
- [press-release-spring.md](press-release-spring.md) — the reaction counterpart: once popped in, a button can take a press→release; this rule supplies the arrival, that one the click feedback

## Pairs with HF skills

- `/hyperframes-animation` — `power3.out` settle (smooth default), `fromTo` entrances, deterministic stagger
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
