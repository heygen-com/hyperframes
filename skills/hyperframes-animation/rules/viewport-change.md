---
name: viewport-change
description: Virtual camera — simulate zoom / pan / focus-lock by transforming a wrapper around all scene content. Camera moves right → world translates left.
metadata:
  tags: viewport, camera, zoom, pan, focus-lock, virtual-camera
---

# Viewport Change (Virtual Camera)

Simulates camera effects (zoom / pan / focus-lock on a moving element) by transforming a wrapper around ALL scene content. The "world" moves opposite to the perceived camera. Distinct from [multi-phase-camera](multi-phase-camera.md) (which is 2-3 discrete phases + drift) — viewport-change is a single continuous zoom/pan, often used for focus-lock following a moving element.

## How It Works

Camera intent → world transform:

- Camera **pans right** → world `translateX(-distance)`
- Camera **zooms in** → world `scale(>1)`
- Camera **follows element X** → world `translateX(viewportCenter - elementWorldX)` updated per-frame

The wrapper holds the camera transform; the elements inside are positioned in "world space" unchanged.

**Single-element composite transform (this rule's form).** Both scale and translate live on ONE wrapper as `translate(x, y) scale(S)`. CSS applies scale FIRST, then translate (right-to-left matrix composition), so a point at world offset `(ox, oy)` lands on screen at `(S × ox + x, S × oy + y)`. To map the target to viewport center:

```
T = -offset × S
```

This is **different from [coordinate-target-zoom](coordinate-target-zoom.md)**, which uses two nested wrappers (outer scales, inner translates) and derives `T = -offset` (independent of S). Use this rule's single-wrapper form when you want one source of truth for camera state (`cam.scale`, `cam.x`, `cam.y`) updated via `onUpdate`; use nested wrappers when scale and translate can tween independently with shared ease.

## HTML

```html
<div
  class="scene"
  id="viewport-scene"
  data-composition-id="viewport-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="world" id="world">
    <div class="content">
      <div class="hero" id="hero">{Brand}</div>
      <div class="tagline">{tagline}</div>
      <div class="cta-row">
        <div class="cta" id="cta">{ctaUrl}</div>
      </div>
    </div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: {bgGradient};
  font-family: {font};
}
.world {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%;
  will-change: transform;
}
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: CONTENT_GAP;
  text-align: center;
}
.hero {
  font-size: HERO_FONT_SIZE;
  font-weight: 900;
  letter-spacing: HERO_LETTER_SPACING;
  text-transform: uppercase;
  color: {textColor};
}
.tagline {
  font-size: TAGLINE_FONT_SIZE;
  font-weight: 600;
  color: {labelColor};
}
.cta {
  display: inline-block;
  padding: CTA_PADDING_Y CTA_PADDING_X;
  font-family: {monoFont};
  font-size: CTA_FONT_SIZE;
  font-weight: 700;
  letter-spacing: CTA_LETTER_SPACING;
  color: {accentColor};
  text-transform: uppercase;
  background: {ctaBg};
  border: 1px solid {ctaBorder};
  border-radius: CTA_BORDER_RADIUS;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const world = document.getElementById("world");

  // Camera state — single source of truth. World transform is composed from
  // this object inside applyCamera() so the transform string order is stable.
  const cam = { scale: 1, x: 0, y: 0 };

  function applyCamera() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
  }
  applyCamera();

  // Phase 1 — content reveal at neutral camera
  tl.from(".hero", { opacity: 0, y: HERO_Y, duration: HERO_DUR, ease: "power3.out" }, HERO_START);
  tl.from(
    ".tagline",
    { opacity: 0, y: TAGLINE_Y, duration: TAGLINE_DUR, ease: "power3.out" },
    TAGLINE_START,
  );

  // Phase 2 — zoom in on CTA (single-element composite transform)
  // CSS applies scale FIRST then translate: world point (ox, oy) lands at
  // (S × ox + x, S × oy + y). Solve S × offset + T = 0 → T = -offset × S.
  // This is DIFFERENT from coordinate-target-zoom (nested wrappers, T = -offset).
  const counterY = -TARGET_OFFSET_Y * TARGET_SCALE;

  tl.to(
    cam,
    {
      scale: TARGET_SCALE,
      y: counterY,
      duration: ZOOM_DUR,
      ease: "power3.inOut",
      onUpdate: applyCamera,
    },
    ZOOM_START,
  );

  // Phase 3 — CTA reveals/dwells after zoom settles
  tl.from(
    "#cta",
    {
      opacity: 0,
      scale: CTA_REVEAL_SCALE,
      duration: CTA_REVEAL_DUR,
      ease: `back.out(${BOUNCE_FACTOR})`,
    },
    CTA_REVEAL_START,
  );

  window.__timelines["viewport-scene"] = tl;
</script>
```

## Scale Value Guide

| Effect      | Scale       | Feel                                |
| ----------- | ----------- | ----------------------------------- |
| Subtle      | 1.02 - 1.05 | Barely perceptible — "professional" |
| Medium      | 1.05 - 1.15 | "Ta-da" emphasis                    |
| Noticeable  | 1.15 - 1.30 | Focus on region                     |
| Dramatic    | 1.5 - 2.5   | Element fills screen                |
| Full-screen | 3.0+        | Element covers viewport             |

| Perception threshold | Result               |
| -------------------- | -------------------- |
| < 5%                 | Imperceptible        |
| 10-15%               | Comfortable emphasis |
| > 30%                | Cinematic / dramatic |

## Variations

### Focus-lock (camera follows moving cursor/character)

For an element moving across the world, keep it at fixed screen X. Compute world offset per-frame:

```js
const focusEl = document.querySelector(".moving-cursor");
const targetScreenX = VIEWPORT_WIDTH * FOCUS_SCREEN_X_FRAC;
const focusUpdate = { p: 0 };
tl.to(
  focusUpdate,
  {
    p: 1,
    duration: FOLLOW_DUR,
    ease: "power2.inOut",
    onUpdate: () => {
      const rect = focusEl.getBoundingClientRect();
      const focusWorldX = rect.left + rect.width / 2;
      cam.x = targetScreenX - focusWorldX;
      applyCamera();
    },
  },
  FOLLOW_START,
);
```

### Composite scale (multi-phase)

Multiply two scale tweens for compound effects:

```js
const scaleUp = { v: 1 };
const scaleDown = { v: 1 };
function applyCompositeCamera() {
  cam.scale = scaleUp.v * scaleDown.v;
  applyCamera();
}
tl.to(
  scaleUp,
  { v: SCALE_UP_TARGET, duration: SCALE_UP_DUR, onUpdate: applyCompositeCamera },
  SCALE_UP_START,
);
tl.to(
  scaleDown,
  { v: SCALE_DOWN_TARGET, duration: SCALE_DOWN_DUR, onUpdate: applyCompositeCamera },
  SCALE_DOWN_START,
);
```

### Camera mode transition (centered → follow)

Crossfade between two camera modes via a 0→1 weight tween. At weight 0, mode A; at weight 1, mode B; intermediate is interpolated.

## How to Choose Values

### Layout (CSS)

- **CONTENT_GAP** — vertical gap between hero, tagline, and CTA.
  - Range: 16-48 px
  - Effects: small → tightly stacked (logo-lockup feel); large → airy, editorial
- **HERO_FONT_SIZE / TAGLINE_FONT_SIZE / CTA_FONT_SIZE** — typographic hierarchy.
  - Range: hero >> tagline > CTA (hero is the brand mark, CTA is the actionable footer)
  - Constraints: hero must remain readable when scaled DOWN at neutral camera AND when scaled UP during the zoom — pick the size at neutral camera, the zoom only enlarges it
- **HERO_LETTER_SPACING / CTA_LETTER_SPACING** — uppercase tracking.
  - Range: 4-10 px for uppercase display type; 0 for sentence case
- **CTA_PADDING_X / CTA_PADDING_Y / CTA_BORDER_RADIUS** — pill geometry around the CTA text.
  - Constraints: `CTA_BORDER_RADIUS ≥ CTA_FONT_SIZE` to keep the pill ends fully rounded

### Phase 1 — Content reveal

- **HERO_START** — when the hero begins fading in.
  - Range: 0.2-0.5s (small offset for a beat of black before content appears)
- **HERO_DUR** — hero fade-up duration.
  - Range: 0.6-1.2s
- **HERO_Y** — initial Y offset of hero before fade-up (in px).
  - Range: 16-48 px
- **TAGLINE_START** — when the tagline begins fading in.
  - Constraints: `≥ HERO_START + 0.3` (let the hero land first so the eye reads top-down)
- **TAGLINE_DUR / TAGLINE_Y** — same shape as hero, typically smaller (`TAGLINE_Y` half of `HERO_Y`).

### Phase 2 — Zoom

- **TARGET_OFFSET_Y** — measured Y offset (in px) of the CTA from viewport center at neutral camera.
  - Constraints: derived from layout, NOT a free parameter. Measure via `getBoundingClientRect()` OR compute from `CONTENT_GAP + (HERO_HEIGHT + TAGLINE_HEIGHT) / 2`. Sign matters — positive = below center.
- **TARGET_SCALE** — final magnification of the world.
  - Range: 1.3× (modest) → 1.6-2.0× (typical CTA zoom) → 3×+ (cinematic)
  - Constraints: raster source media needs `sourceResolution ≥ rendered × TARGET_SCALE`; text remains crisp at any scale
- **ZOOM_START** — when the zoom begins.
  - Constraints: `≥ TAGLINE_START + TAGLINE_DUR + viewer-scan-time` (give viewer ~0.5s after content lands before camera moves)
- **ZOOM_DUR** — duration of the zoom tween.
  - Range: 1.0-2.0s; under 0.8s feels like a teleport, over 2.5s drags

### Phase 3 — CTA reveal + dwell

- **CTA_REVEAL_START** — when the CTA pops in.
  - Constraints: `≥ ZOOM_START + ZOOM_DUR × 0.9` (start near the end of the zoom so the CTA "lands" with the camera)
- **CTA_REVEAL_DUR** — CTA fade-in / pop duration.
  - Range: 0.4-0.8s
- **CTA_REVEAL_SCALE** — initial scale of the CTA before pop.
  - Range: 0.85-0.95 (sub-1 → grows into place); >1.0 inverts to a shrink-into-place feel
- **BOUNCE_FACTOR** — overshoot coefficient for `back.out(${BOUNCE_FACTOR})`.
  - Range: 1.2-2.5; lower = subtle settle, higher = pronounced overshoot. The ease family (`back.out`) is the choice; this number tunes its intensity.
  - Reference: ease family options: `back.out` (overshoot then settle), `elastic.out` (oscillation), `power3.out` (clean decel, no overshoot)
- **DWELL_DUR** — implicit hold after `CTA_REVEAL_START + CTA_REVEAL_DUR` until `data-duration` ends.
  - Range: ≥ 1.0s (see "Climax dwell" in Key Principles)

### Focus-lock variation

- **VIEWPORT_WIDTH** — composition width in px. Real value (`data-width` on the root); not abstract.
- **FOCUS_SCREEN_X_FRAC** — where on screen to lock the focused element.
  - Range: 0.4-0.7 (rule of thirds positions); 0.5 is dead center
- **FOLLOW_START / FOLLOW_DUR** — when the follow-cam engages and for how long.
  - Constraints: `FOLLOW_DUR` matches the duration the focused element is in motion

### Composite-scale variation

- **SCALE_UP_TARGET / SCALE_DOWN_TARGET** — multiplicative factors composed via `cam.scale = scaleUp.v * scaleDown.v`.
  - Effects: combine a slow push-in (`SCALE_UP_TARGET` ~1.15) with a brief release (`SCALE_DOWN_TARGET` ~0.9) for a breath/punch shape
- **SCALE_UP_START / SCALE_UP_DUR / SCALE_DOWN_START / SCALE_DOWN_DUR** — phase timing for each multiplicand.

### Color tokens

- **{bgGradient}** — scene background (typically a dark radial vignette so edges fall off as zoom reveals them)
- **{textColor}** — hero text; highest contrast against `{bgGradient}`
- **{labelColor}** — tagline / secondary copy; one step softer than `{textColor}`
- **{accentColor}** — CTA text + border; reserved hue that pops on reveal
- **{ctaBg} / {ctaBorder}** — semi-transparent fills derived from `{accentColor}` (typical `rgba` at 10-15% / 35-45% alpha)

### Font tokens

- **{font}** — sans-serif body / hero stack (e.g. `"Inter", sans-serif`)
- **{monoFont}** — monospace CTA stack (e.g. `"JetBrains Mono", monospace`); reserved for the URL/code-like CTA so it reads as actionable

## Key Principles

- **World moves opposite to perceived camera** — pan camera right = `translateX(-x)` on the world wrapper. Get this sign right, otherwise everything moves the wrong way.
- **Single-wrapper transform order matters** — `translate(x, y) scale(S)` applies scale first; counter-translate is `T = -offset × S`. Mixing this up with the nested-wrapper form (`T = -offset`) drifts the target off-center as scale changes.
- **`overflow: hidden` on `.scene` REQUIRED** — at any non-1.0 scale the world transform reveals edges or pushes content off-frame.
- **`transform-origin: 50% 50%`** on the world wrapper — centered scaling is what the math assumes.
- **Background on `.scene`, NOT on `.world`** — if background is on the world, transforming the world warps/translates the background.
- **Single source of truth via `cam` object + `applyCamera()`** — when scale and translate both change, write them in ONE place. Otherwise the transform string composition order is unpredictable.
- **Subtle continuous motion > big sudden zoom** — for a feel-natural product video, use 1.05-1.15× zoom over 2-3s. Big > 1.3× zooms read as dramatic narrative moments, save them.
- **Climax dwell >=1s** — after the zoom settles, the comp must continue for >=1s so the viewer can read the focal point.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition` on `.world`** — competes with GSAP
- **`will-change: transform`** on `.world`
- **`overflow: hidden` on `.scene`**
- **`transform-origin: 50% 50%` on `.world`**
- **Background on `.scene`** — never on `.world`
- **Scale and translate share one `onUpdate`** — both read from `cam` and write the composite transform string together; never split them across tweens that touch `world.style.transform` directly

## Combinations

- [multi-phase-camera.md](multi-phase-camera.md) — viewport-change inside one phase of a multi-phase camera
- [coordinate-target-zoom.md](coordinate-target-zoom.md) — alternative for off-center zoom (nested wrappers, `T = -offset` form)
- [sine-wave-loop.md](sine-wave-loop.md) — idle micro-drift after viewport settles

## Pairs with HF skills

- `/hyperframes-animation` — single tween writing composite transform
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
