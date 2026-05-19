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

- t=0 → 0.4: hub fades in
- t=0.4 → 1.4: avatars cascade in (stagger 0.08s, spring scale 0 → 1)
- t=1.4 → 2.2: connection lines draw outward (strokeDashoffset linear)
- t=2.2+: climax dwell, optional idle breathing on avatars

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
      <div class="hub-num" id="hub-num">12M+</div>
      <div class="hub-label">CREATORS</div>
    </div>
    <!-- Avatars injected by script — 10 around ellipse -->
  </div>

  <div class="brand">— BUILT WITH HEYGENVERSE</div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
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
  background: linear-gradient(160deg, rgba(167, 139, 250, 0.4) 0%, rgba(20, 24, 56, 0.95) 80%);
  border: 1px solid rgba(167, 139, 250, 0.4);
}
.hub-num {
  font-size: 144px;
  font-weight: 900;
  color: #f5f6fb;
  letter-spacing: -4px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.hub-label {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 12px;
  color: #cdb8ff;
  text-transform: uppercase;
}
.avatar {
  position: absolute;
  z-index: 2;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  border: 3px solid #f5f6fb;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.5),
    0 0 24px rgba(167, 139, 250, 0.3);
  display: grid;
  place-items: center;
  font-size: 48px;
  background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
  will-change: transform, opacity;
  /* Top-left positioned by script; transform centers via -50% trick */
  transform: translate(-50%, -50%);
}
.brand {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 14px;
  color: #a78bfa;
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const SCREEN_CENTER = { x: 960, y: 540 };
  const RADIUS_X = 640;
  const RADIUS_Y = 280; // wider than tall — perspective-flattened
  const AVATAR_COUNT = 10;
  const AVATAR_EMOJIS = ["👨‍🎨", "👩‍💻", "🧑‍🚀", "👨‍🔬", "👩‍🎤", "🧑‍🎬", "👨‍🏫", "👩‍🚀", "🧑‍💼", "👩‍🎨"];

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
    av.textContent = AVATAR_EMOJIS[i];
    av.style.left = `${x}px`;
    av.style.top = `${y}px`;
    hubWrap.appendChild(av);

    // Line from hub to avatar
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", SCREEN_CENTER.x);
    line.setAttribute("y1", SCREEN_CENTER.y);
    line.setAttribute("x2", x);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(167, 139, 250, 0.4)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "6 8");
    const len = Math.hypot(x - SCREEN_CENTER.x, y - SCREEN_CENTER.y);
    line.style.strokeDashoffset = String(len);
    line.dataset.length = String(len);
    line.dataset.index = String(i);
    linesSvg.appendChild(line);
  }

  // Phase 1 — hub fade in
  tl.from(".hub", { opacity: 0, scale: 0.8, duration: 0.5, ease: "back.out(1.6)" }, 0);

  // Phase 2 — avatars cascade-in (staggered spring)
  const avatars = document.querySelectorAll(".avatar");
  avatars.forEach((av, i) => {
    tl.from(
      av,
      {
        opacity: 0,
        scale: 0,
        duration: 0.5,
        ease: "back.out(1.6)",
      },
      0.4 + i * 0.08,
    );
  });

  // Phase 3 — connection lines draw outward (staggered) — starts after most avatars land
  const lines = linesSvg.querySelectorAll("line");
  lines.forEach((line, i) => {
    const len = Number(line.dataset.length);
    tl.to(
      line,
      {
        strokeDashoffset: 0,
        duration: 0.6,
        ease: "power2.out",
      },
      1.4 + i * 0.04,
    );
  });

  // Phase 4 — climax dwell (network fully formed), idle breathing on avatars
  const avatarStates = avatars.length;
  const breathDriver = { p: 0 };
  tl.to(
    breathDriver,
    {
      p: Math.PI * 2 * 1.2,
      duration: 1.5,
      ease: "none",
      onUpdate: () => {
        avatars.forEach((av, i) => {
          const phase = breathDriver.p + (i / avatars.length) * Math.PI * 2;
          const s = 1 + Math.sin(phase) * 0.04;
          const ax = avatarPositions[i].x;
          const ay = avatarPositions[i].y;
          av.style.transform = `translate(-50%, -50%) scale(${s})`;
        });
      },
    },
    2.4,
  );

  window.__timelines["cloud-scene"] = tl;
</script>
```

## Variations

### Avatar size variation (organic feel)

Vary avatar sizes by index:

```js
const sizes = [96, 88, 104, 92, 100, 96, 88, 104, 96, 92];
av.style.width = `${sizes[i % sizes.length]}px`;
av.style.height = `${sizes[i % sizes.length]}px`;
```

### Solid lines instead of dashed

Drop `stroke-dasharray` and use a solid stroke. Drop the dash-draw animation; lines fade in via opacity instead. More corporate, less networky.

### Multi-orbit (concentric rings)

Two layers of avatars: 6 on inner ring (smaller radius, slightly larger size), 10 on outer ring. Lines connect ONLY inner ring to hub; outer ring is a "halo."

### Country emojis (geographic spread)

Replace person emojis with country flags. Reads as "global community."

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

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — the hub IS a growing counter ("12M+ creators")
- [sine-wave-loop.md](sine-wave-loop.md) — avatar idle breathing pattern
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — hub label with depth layers

## Pairs with HF skills

- `/hyperframes-gsap` — staggered spring entries + SVG dash draw
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
