---
name: avatar-cloud-network
description: Avatars distributed on an elliptical ring connected by SVG dashed lines to a center hub — social proof "community" reveal with staggered entry.
metadata:
  tags: avatar, cloud, network, social-proof, ellipse, connection, stagger
---

# Avatar Cloud Network

Avatars on an elliptical ring around a central hub (logo / counter), with SVG dashed lines drawing outward from the hub to each avatar — "community" / social proof. Distinct from [orbit-3d-entry.md](orbit-3d-entry.md) (continuous orbit): this settles into a static composed formation.

## How It Works

Three layers: SVG lines (z-index 1, behind), avatars (z-index 2), hub (z-index 5 — lines terminate AT its edge, never pass through). Avatar positions and lines are built once at setup from ONE shared center; the timeline then runs hub fade → avatar cascade → outward line draw → breathing dwell. Drawing FROM the center is the narrative: "the hub connects to its community."

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<svg class="lines" viewBox="0 0 1920 1080"><!-- lines injected --></svg>
<div class="hub-wrap">
  <div class="hub">{counterValue} {counterLabel}</div>
  <!-- avatars injected -->
</div>
```

```css
.lines {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
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
}
.avatar {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -50%); /* centers on the (left, top) the script sets */
  will-change: transform, opacity;
}
```

```js
// CENTER_X/Y must equal the hub's RENDERED center exactly — every avatar
// position and line endpoint derives from it. For a place-items:center hub on
// a 1920×1080 canvas: (W/2, H × CENTER_Y_FACTOR).
const C = { x: CENTER_X, y: CENTER_Y };
const wrap = document.querySelector(".hub-wrap");
const svg = document.querySelector(".lines");

for (let i = 0; i < AVATAR_COUNT; i++) {
  const a = (i / AVATAR_COUNT) * Math.PI * 2 - Math.PI / 2; // start at top
  const x = C.x + Math.cos(a) * RADIUS_X;
  const y = C.y + Math.sin(a) * RADIUS_Y;

  const av = document.createElement("div");
  av.className = "avatar"; // assign image / glyph from authoring data
  av.style.left = `${x}px`;
  av.style.top = `${y}px`;
  wrap.appendChild(av);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const attrs = {
    x1: C.x,
    y1: C.y,
    x2: x,
    y2: y,
    stroke: "{lineColor}",
    "stroke-dasharray": "6 8",
  };
  Object.entries(attrs).forEach(([k, v]) => line.setAttribute(k, String(v)));
  const len = Math.hypot(x - C.x, y - C.y); // straight line — Math.hypot, not getTotalLength()
  line.style.strokeDashoffset = String(len);
  svg.appendChild(line);
}

tl.from(".hub", { opacity: 0, scale: 0.8, duration: HUB_DUR, ease: `back.out(${HUB_BOUNCE})` }, 0);

const avatars = document.querySelectorAll(".avatar");
avatars.forEach((av, i) => {
  tl.from(
    av,
    { opacity: 0, scale: 0, duration: AVATAR_DUR, ease: `back.out(${AVATAR_BOUNCE})` },
    AVATAR_AT + i * AVATAR_STAGGER,
  );
});
svg.querySelectorAll("line").forEach((line, i) => {
  tl.to(
    line,
    { strokeDashoffset: 0, duration: LINE_DUR, ease: "power2.out" },
    LINES_AT + i * LINE_STAGGER,
  );
});

// Climax dwell — out-of-phase breathing holds the eye on the formed network:
// one phase proxy (0 → 2π·BREATH_CYCLES, ease "none"); onUpdate scales avatar i by
// 1 + sin(p + (i/n)·2π) · BREATH_AMP — sine-wave-loop's multiplicative onUpdate form.
// Keep the -50% centering in the same transform write.
```

## Variations

- **Size variety**: vary avatar sizes by a small index-keyed array so the ring doesn't read rigidly repetitive.
- **Solid lines**: drop the dash + draw; lines fade in via opacity — more corporate, less networky.
- **Multi-orbit**: inner ring (fewer, larger) connected to the hub; outer ring is an unconnected "halo."
- **Glyph avatars**: flags / emoji / icons instead of faces — reads "global community" or role spread.

## Values

| token          | range                        | notes                                                            |
| -------------- | ---------------------------- | ---------------------------------------------------------------- |
| AVATAR_COUNT   | 8–12                         | fewer feels sparse; more clutters the ellipse                    |
| RADIUS_X / \_Y | ~20–30% W / ~18–25% H        | ratio X/Y 1.5–3.0 reads as perspective; 1 (circle) reads flat    |
| avatar size    | 80–120px @1920               | ring must fit 10+ without overlap                                |
| HUB_DUR        | 0.4–0.6s                     | HUB_BOUNCE 1.4–1.8                                               |
| AVATAR_AT      | ≥ 0.6 × HUB_DUR              | hub established before satellites arrive                         |
| AVATAR_DUR     | 0.4–0.7s                     | AVATAR_BOUNCE 1.4–1.8, slightly firmer than hub                  |
| AVATAR_STAGGER | 0.06–0.10s                   | cascade reads "joining"; simultaneous reads "already there"      |
| LINES_AT       | overlaps last avatar settle  | start ~0.1–0.2s before it — draw reads as consequence of landing |
| LINE_DUR       | 0.4–0.7s                     | LINE_STAGGER 0.02–0.05s = a wave outward                         |
| BREATH_CYCLES  | 1.0–2.0 over the remaining s | under 1 = single sigh; over 2 = anxious. BREATH_AMP 0.02–0.06    |

Tokens: dark `{bgColor}` so the cloud reads as a constellation; translucent accent `{lineColor}`; soft border + glow keeps avatars legible on dark.

## Critical Constraints

- **CENTER_X/Y must match the hub's actual rendered center** — when composed with another scene (e.g. a recentered logo), bake them from the same source as the hub's final position, or lines visibly miss the hub.
- **Hub z-index above lines** — lines terminate at the hub edge, never cross it.
- **Lines draw outward** (dashoffset len → 0), starting after avatars are mostly settled.
- **`RADIUS_X > RADIUS_Y`** — a horizontal ellipse reads as perspective; a circle reads flat.
- **Climax dwell ≥ 1s** after lines complete so the formed network is readable.
- Straight lines: `Math.hypot` for length — `getTotalLength()` not needed.

## See also

`counting-dynamic-scale` (the hub IS a growing counter) · `sine-wave-loop` (the breathing form) · `orbit-3d-entry` (the continuously-orbiting cousin).
