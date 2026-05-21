---
name: avatar-cloud-network
description: Avatars distributed on an elliptical ring connected by SVG dashed lines to a center hub — social proof "community" reveal with staggered entry.
metadata:
  tags: avatar, cloud, network, social-proof, ellipse, connection, stagger
---

# Avatar Cloud Network

Avatars arranged on an elliptical ring around a central element (logo / counter / brand). SVG dashed connection lines from center to each avatar. Staggered spring entry on avatars, then connection lines draw outward — communicates "community" or "social proof." Distinct from [orbit-3d-entry](orbit-3d-entry.md) (which continuously orbits) — avatar-cloud is a static composed reveal.

## How It Works

Three rendering layers:

1. **SVG connection lines** (z-index 1, behind everything) — line from center hub to each avatar's position
2. **Avatars** (z-index 2) — `<div>` circles on elliptical positions
3. **Center hub** (z-index 5) — brand counter or logo (sits ABOVE the lines that converge on it)

Animation phases:

- `HUB_FADE_START → HUB_FADE_START + HUB_FADE_DUR`: hub fades in
- `AVATAR_ENTRY_START → AVATAR_ENTRY_START + (AVATAR_COUNT − 1) × AVATAR_STAGGER + AVATAR_ENTRY_DUR`: avatars cascade in
- `LINES_START → LINES_START + (AVATAR_COUNT − 1) × LINE_STAGGER + LINES_DUR`: connection lines draw outward
- climax dwell: optional idle breathing on avatars (see Variations / sine-wave-loop)

## HTML

```html
<div
  class="scene"
  id="cloud-scene"
  data-composition-id="cloud-scene"
  data-start="0"
  data-duration="4"
  data-track-index="0"
>
  <!-- Connection lines layer -->
  <svg class="lines" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <!-- Lines injected by script — center to each avatar -->
  </svg>

  <!-- Avatars + center hub -->
  <div class="hub-wrap">
    <div class="hub" id="hub">
      <div class="hub-num" id="hub-num">{counterValue}</div>
      <div class="hub-label">{counterLabel}</div>
    </div>
    <!-- Avatars injected by script — AVATAR_COUNT around the ellipse -->
  </div>

  <div class="brand">{footerLine}</div>
</div>
```

Placeholder tokens:

- `{counterValue}` / `{counterLabel}` — the hub copy (numeric proof + category)
- `{footerLine}` — optional attribution line under the cloud
- `{avatar[i]}` — per-avatar image source (or emoji glyph if using the emoji variation below)

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: {bgColor};
  font-family: {font};
  overflow: hidden;
}
.lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}
.hub-wrap {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.hub {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 64px;
  border-radius: 28px;
  background: {hubBg};
  border: 1px solid {hubBorder};
}
.hub-num {
  font-size: HUB_NUM_FONT_SIZE;
  font-weight: 900;
  color: {textColor};
  letter-spacing: -4px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.hub-label {
  font-size: HUB_LABEL_FONT_SIZE;
  font-weight: 800;
  letter-spacing: 12px;
  color: {accentColor};
  text-transform: uppercase;
}
.avatar {
  position: absolute;
  z-index: 2;
  width: AVATAR_SIZE;
  height: AVATAR_SIZE;
  border-radius: 50%;
  border: 3px solid {avatarBorder};
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.5),
    0 0 24px {avatarGlow};
  display: grid;
  place-items: center;
  font-size: AVATAR_GLYPH_SIZE;
  background: {avatarBg};
  will-change: transform, opacity;
  /* Top-left positioned by script; transform centers via -50% trick */
  transform: translate(-50%, -50%);
}
.brand {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  font-size: BRAND_FONT_SIZE;
  font-weight: 900;
  letter-spacing: 14px;
  color: {accentColor};
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // CENTER_X / CENTER_Y must match the hub's rendered center exactly.
  // For a hub-wrap with place-items:center on a 1920×1080 canvas these are
  // (compositionWidth/2, compositionHeight × CENTER_Y_FACTOR).
  const SCREEN_CENTER = { x: CENTER_X, y: CENTER_Y };

  const hubWrap = document.querySelector(".hub-wrap");
  const linesSvg = document.querySelector(".lines");

  // Build avatars + lines
  const avatarPositions = [];
  for (let i = 0; i < AVATAR_COUNT; i++) {
    const angle = (i / AVATAR_COUNT) * Math.PI * 2 - Math.PI / 2; // start at top
    const x = SCREEN_CENTER.x + Math.cos(angle) * RADIUS_X;
    const y = SCREEN_CENTER.y + Math.sin(angle) * RADIUS_Y;
    avatarPositions.push({ x, y, angle });

    // Avatar
    const av = document.createElement("div");
    av.className = "avatar";
    av.style.left = `${x}px`;
    av.style.top = `${y}px`;
    // assign avatar image / glyph from your authoring data (see {avatar[i]})
    hubWrap.appendChild(av);

    // Line from hub to avatar
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", SCREEN_CENTER.x);
    line.setAttribute("y1", SCREEN_CENTER.y);
    line.setAttribute("x2", x);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "{lineColor}");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "6 8");
    const len = Math.hypot(x - SCREEN_CENTER.x, y - SCREEN_CENTER.y);
    line.style.strokeDashoffset = String(len);
    line.dataset.length = String(len);
    line.dataset.index = String(i);
    linesSvg.appendChild(line);
  }

  // Phase 1 — hub fade in
  tl.from(
    ".hub",
    { opacity: 0, scale: 0.8, duration: HUB_FADE_DUR, ease: `back.out(${HUB_BOUNCE})` },
    HUB_FADE_START,
  );

  // Phase 2 — avatars cascade-in (staggered spring)
  const avatars = document.querySelectorAll(".avatar");
  avatars.forEach((av, i) => {
    tl.from(
      av,
      {
        opacity: 0,
        scale: 0,
        duration: AVATAR_ENTRY_DUR,
        ease: `back.out(${AVATAR_BOUNCE})`,
      },
      AVATAR_ENTRY_START + i * AVATAR_STAGGER,
    );
  });

  // Phase 3 — connection lines draw outward (staggered) — starts after most avatars land
  const lines = linesSvg.querySelectorAll("line");
  lines.forEach((line, i) => {
    tl.to(
      line,
      {
        strokeDashoffset: 0,
        duration: LINES_DUR,
        ease: "power2.out",
      },
      LINES_START + i * LINE_STAGGER,
    );
  });

  // Phase 4 — climax dwell (network fully formed), idle breathing on avatars
  // (see sine-wave-loop.md for the multiplicative onUpdate form)
  const breathDriver = { p: 0 };
  tl.to(
    breathDriver,
    {
      p: Math.PI * 2 * BREATH_CYCLES,
      duration: BREATH_DUR,
      ease: "none",
      onUpdate: () => {
        avatars.forEach((av, i) => {
          const phase = breathDriver.p + (i / avatars.length) * Math.PI * 2;
          const s = 1 + Math.sin(phase) * BREATH_AMP;
          av.style.transform = `translate(-50%, -50%) scale(${s})`;
        });
      },
    },
    BREATH_START,
  );

  window.__timelines["cloud-scene"] = tl;
</script>
```

## How to Choose Values

### Geometry

- **CENTER_X / CENTER_Y** — px coordinates of the hub center; lines and avatar positions derive from these.
  - Constraints: **must equal the hub's actual rendered center** — when this rule is composed with another scene (e.g. a logo that has been recentered), `CENTER_X / CENTER_Y` must be baked from the same source as the hub's final position
  - Reference: examples/proof-logo-chain.html uses `(W/2, H × 0.47)` so the cloud sits slightly above the canvas midline
- **RADIUS_X / RADIUS_Y** — ellipse radii in px (RADIUS_X ≥ RADIUS_Y reads as perspective).
  - Range: `RADIUS_X` ~ 20-30% of viewport width; `RADIUS_Y` ~ 18-25% of viewport height
  - Constraints: `RADIUS_X / RADIUS_Y` ratio between 1.5 and 3.0 reads as natural depth; ratio = 1 (circle) reads as a flat 2D layout
  - Reference: examples/proof-logo-chain.html uses `W * 0.25` (`480px`) and `H * 0.22` (`237.6px`)
- **AVATAR_COUNT** — number of avatars distributed around the ring.
  - Range: 8-12; fewer feels sparse, more clutters the ellipse
  - Reference: examples/proof-logo-chain.html uses `10`
- **AVATAR_SIZE / AVATAR_GLYPH_SIZE** — px diameter of each avatar circle and (optional) inner glyph size.
  - Range: `AVATAR_SIZE` ~ 80-120 px at 1920 wide; small enough that 10+ avatars fit the ring without overlap
- **HUB_NUM_FONT_SIZE / HUB_LABEL_FONT_SIZE / BRAND_FONT_SIZE** — hub typography.
  - Constraints: hub-num is the focal beat, sized 2-4× the label

### Hub fade

- **HUB_FADE_START** — when the hub fades in.
  - Range: usually `0` (the hub establishes the focal point); offset if the scene precedes with another beat
- **HUB_FADE_DUR** — hub fade-in duration.
  - Range: 0.4-0.6s
- **HUB_BOUNCE** — `back.out(HUB_BOUNCE)` coefficient on the hub's scale entry.
  - Range: 1.4 (subtle) → 1.8 (firm)

### Avatar cascade

- **AVATAR_ENTRY_START** — when the first avatar pops in.
  - Constraints: `≥ HUB_FADE_START + HUB_FADE_DUR × 0.6` so the hub is established before satellites arrive
- **AVATAR_ENTRY_DUR** — per-avatar scale-up duration.
  - Range: 0.4-0.7s
- **AVATAR_STAGGER** — delay between consecutive avatar entries.
  - Range: 0.06-0.10s; cascade reads as "joining"; simultaneous reads as "all already there"
- **AVATAR_BOUNCE** — `back.out(AVATAR_BOUNCE)` coefficient on each avatar's pop.
  - Range: 1.4 (gentle) → 1.8 (firm); slightly firmer than hub for differentiation

### Connection lines

- **LINES_START** — when the lines begin drawing outward.
  - Constraints: `LINES_START + (AVATAR_COUNT − 1) × LINE_STAGGER` should overlap the last avatar's settle by ~0.1-0.2s so the drawing reads as a consequence of the avatars landing
- **LINES_DUR** — per-line draw duration (strokeDashoffset → 0).
  - Range: 0.4-0.7s
- **LINE_STAGGER** — delay between consecutive lines starting.
  - Range: 0.02-0.05s; tight stagger reads as a wave outward

### Idle breathing

- **BREATH_START** — when idle breathing activates.
  - Constraints: `≥ LINES_START + (AVATAR_COUNT − 1) × LINE_STAGGER + LINES_DUR + ~0.2s` (let the lines settle)
- **BREATH_DUR** — total duration of the breathing tween.
  - Range: fills the remaining composition window
- **BREATH_CYCLES** — number of full sine cycles across `BREATH_DUR`.
  - Range: 1.0-2.0; under 1 reads as a single sigh, over 2 starts to look anxious
- **BREATH_AMP** — sine amplitude on scale (multiplicative).
  - Range: 0.02-0.06; smaller for headshots, larger for stylized glyphs

### Color tokens

- **{bgColor}** — stage background (typically a dark gradient so the cloud reads as a constellation)
- **{textColor}** — hub-num color (primary copy)
- **{accentColor}** — hub-label + footer (the brand voice)
- **{hubBg} / {hubBorder}** — hub card surfaces; gradient + 1px border reads as elevated
- **{avatarBg} / {avatarBorder} / {avatarGlow}** — avatar circle styling; soft border + glow keeps them legible on dark backgrounds
- **{lineColor}** — SVG stroke color (translucent accent reads as networky)
- **{font}** — base typography stack

## Variations

### Avatar size variation (organic feel)

Vary avatar sizes by index — e.g. a small index-keyed array of sizes — so the ring doesn't read as rigidly repetitive.

### Solid lines instead of dashed

Drop `stroke-dasharray` and use a solid stroke. Drop the dash-draw animation; lines fade in via opacity instead. More corporate, less networky.

### Multi-orbit (concentric rings)

Two layers of avatars: smaller inner ring (fewer avatars, slightly larger size), larger outer ring (more, smaller). Lines connect ONLY inner ring to hub; outer ring is a "halo."

### Country / role glyphs (geographic or persona spread)

Replace face images with flags / emoji / iconography. Reads as "global community" or "diverse roles."

## Key Principles

- **Hub above lines (`z-index: 5` vs lines `z-index: 1`)** — lines should appear to terminate AT the hub edge, not pass through. Hub must be in front.
- **Lines drawn outward (dash offset 0)** — drawing FROM center is the visual narrative: "the hub connects to its community."
- **8-12 avatars** — fewer feels sparse, more clutters the ellipse.
- **`RADIUS_X > RADIUS_Y`** — horizontal ellipse reads as perspective; equal radii (circle) reads as 2D flat layout.
- **Avatar entry stagger 0.06-0.10s** — cascade reads as "joining"; simultaneous reads as "all already there."
- **Stagger lines AFTER avatars are mostly settled** — line draw starts ~0.1-0.2s before last avatar settles for overlap.
- **Idle breathing post-formation** — each avatar slightly out-of-phase. Holds the eye during climax dwell.
- **❗ Climax dwell ≥1s** — after lines complete, hold for ≥1s so the formed network is readable.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS animation** on avatars or lines
- **`will-change: transform, opacity`** on avatars
- **SVG `pointer-events: none`** — decorative overlay
- **`getTotalLength()` not needed for straight lines** — use `Math.hypot` for line length (cheaper, exact)
- **Hub `z-index` > lines z-index** — explicit layering

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — the hub IS a growing counter
- [sine-wave-loop.md](sine-wave-loop.md) — avatar idle breathing pattern
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — hub label with depth layers

## Pairs with HF skills

- `/hyperframes-animation` — staggered spring entries + SVG dash draw
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
