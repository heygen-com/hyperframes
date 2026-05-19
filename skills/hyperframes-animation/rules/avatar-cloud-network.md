---
name: avatar-cloud-network
description: Avatars distributed on an elliptical ring with SVG connection lines drawn outward from a center point, staggered entry, GSAP-driven and seek-safe in HyperFrames.
metadata:
  tags: avatar, cloud, network, social-proof, ellipse, connection, stagger, gsap, svg
  adapter: gsap
---

# Avatar Cloud Network

Avatars arranged on an elliptical ring around a central element (logo, icon, counter), connected by SVG lines. Staggered entry creates a cascade reveal. Communicates "community" or "social proof."

## HyperFrames Translation Notes

The Remotion version:

- Computed positions inline in JSX every frame
- Used per-avatar `spring()` for entry
- Trigonometric float driven by `frame * speed` evaluated per render

The HyperFrames version:

- **Pre-renders** all avatar DOM nodes and SVG `<line>` elements at known positions
- Drives entry via **GSAP `stagger`** on a paused timeline
- For the post-entry float, uses a finite `yoyo` tween (or a small sine `onUpdate`), **not** continuous trigonometry. HyperFrames forbids infinite repeats.

## Layer Order

Three layers, in this z-order:

1. **SVG connection lines** — `z-index: 1`, lowest
2. **Avatars** — `z-index: 10`
3. **Center element** (logo / counter) — `z-index: 100`, highest

Lines must sit beneath avatars (otherwise the line endpoint dot peeks through the avatar circle). The center element must sit above both so the lines visibly originate from it.

## Layout & Position Calculation

Avatar positions are pre-computed once at script start, then frozen as constants. Both the avatar elements and the SVG line endpoints reference the same constants.

```html
<div class="cloud-stage" style="position: absolute; inset: 0;">
  <!-- SVG lines layer -->
  <svg
    class="cloud-lines"
    width="1920"
    height="1080"
    style="position: absolute; inset: 0; z-index: 1; pointer-events: none;"
  >
    <!-- One <line> per avatar, all starting collapsed at (centerX, centerY) -->
  </svg>

  <!-- Avatar layer -->
  <div class="cloud-avatars" style="position: absolute; inset: 0; z-index: 10;"></div>

  <!-- Center element layer -->
  <div
    class="cloud-center"
    style="
       position: absolute; left: 50%; top: 42%;
       transform: translate(-50%, -50%); z-index: 100;"
  >
    <!-- e.g. <img class="logo" src="./assets/logo.png"> -->
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // CONSTANTS — composition dimensions baked in.
  // For 1920×1080 with logo center at (50%, 42%):
  // ============================================================
  const CENTER_X = 960;
  const CENTER_Y = 1080 * 0.42; // = 453.6
  const RADIUS_X = 1920 * 0.25; // = 480, wider ellipse
  const RADIUS_Y = 1080 * 0.22; // = 237.6, shorter ellipse
  const AVATAR_COUNT = 10;
  const AVATAR_SRCS = [
    "./assets/avatars/01.jpg",
    "./assets/avatars/02.jpg",
    "./assets/avatars/03.jpg",
    "./assets/avatars/04.jpg",
    "./assets/avatars/05.jpg",
    "./assets/avatars/06.jpg",
    "./assets/avatars/07.jpg",
    "./assets/avatars/08.jpg",
    "./assets/avatars/09.jpg",
    "./assets/avatars/10.jpg",
  ];

  const ENTRY_START = 0.4; // first avatar enters at this time (seconds)
  const ENTRY_STAGGER = 0.1; // delay between successive avatars
  const ENTRY_DUR = 0.55; // per-avatar entry duration
  const LINES_DELAY = 0.2; // gap after last avatar before lines start
  const LINES_DUR = 0.45;
  const LINE_STAGGER = 0.033;

  // ============================================================
  // BUILD THE DOM
  // ============================================================
  const linesSvg = document.querySelector(".cloud-lines");
  const avatarsLayer = document.querySelector(".cloud-avatars");
  const positions = [];

  for (let i = 0; i < AVATAR_COUNT; i++) {
    // -π/2 starts the first avatar at 12 o'clock (top of ellipse)
    const angle = (i / AVATAR_COUNT) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER_X + Math.cos(angle) * RADIUS_X;
    const y = CENTER_Y + Math.sin(angle) * RADIUS_Y;
    positions.push({ x, y });

    // Avatar element — slight size variation for organic feel
    const size = 90 + (i % 3) * 15;
    const av = document.createElement("div");
    av.className = "cloud-avatar";
    av.style.cssText = `
      position: absolute;
      left: ${x - size / 2}px; top: ${y - size / 2}px;
      width: ${size}px; height: ${size}px;
      border-radius: 50%; overflow: hidden;
      border: 3px solid rgba(255,255,255,0.2);
      opacity: 0; transform: scale(0);
    `;
    const img = document.createElement("img");
    img.src = AVATAR_SRCS[i];
    img.style.cssText = "width:100%; height:100%; object-fit:cover;";
    av.appendChild(img);
    avatarsLayer.appendChild(av);

    // SVG line — both endpoints initially at center; entry tween expands them outward.
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", CENTER_X);
    line.setAttribute("y1", CENTER_Y);
    line.setAttribute("x2", CENTER_X);
    line.setAttribute("y2", CENTER_Y);
    line.setAttribute("stroke", "var(--accent, #00ff88)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 4");
    line.setAttribute("stroke-opacity", "0");
    linesSvg.appendChild(line);
  }

  // ============================================================
  // TIMELINE
  // ============================================================
  // Avatars cascade in with a bouncy ease
  tl.to(
    ".cloud-avatar",
    {
      scale: 1,
      opacity: 1,
      duration: ENTRY_DUR,
      ease: "back.out(1.7)", // bouncy entry
      stagger: { each: ENTRY_STAGGER, from: "start" },
    },
    ENTRY_START,
  );

  // Lines start drawing after the last avatar lands.
  const lastAvatarEnds = ENTRY_START + ENTRY_STAGGER * (AVATAR_COUNT - 1) + ENTRY_DUR;
  const linesStart = lastAvatarEnds + LINES_DELAY;

  // Each line grows from center to its avatar position.
  // We tween x2/y2 attributes per-line because each has a unique target.
  document.querySelectorAll(".cloud-lines line").forEach((line, i) => {
    const { x, y } = positions[i];
    tl.to(
      line,
      {
        attr: { x2: x, y2: y },
        strokeOpacity: 0.6,
        duration: LINES_DUR,
        ease: "power2.out",
      },
      linesStart + i * LINE_STAGGER,
    );
  });

  // Optional finite breathing for the avatars (NOT infinite — HyperFrames forbids -1)
  tl.to(
    ".cloud-avatar",
    {
      y: "+=6",
      duration: 1.4,
      ease: "sine.inOut",
      stagger: { each: 0.15, repeat: 2, yoyo: true },
    },
    linesStart + LINES_DUR + 0.1,
  );

  window.__timelines["main"] = tl;
</script>
```

## Sequence Timeline

```
t = ENTRY_START                                first avatar enters
t = ENTRY_START + stagger × (N-1) + dur        last avatar settled
t = + LINES_DELAY                              connection lines begin drawing
t = + line_stagger × N + LINES_DUR             all lines drawn
t = + 0.1                                      optional avatar breathing begins
```

## Critical Constraints

- **Center element z-index highest**: Logo must overlay both the lines and avatars. Use `z-index: 100`.
- **Avatar ≥ lines z-index**: Lines underneath avatars, not above. Otherwise the dashed pattern bleeds visually through avatar borders.
- **Pre-computed positions**: Calculate `(x, y)` once at script start. Do not recompute per frame — both performance and determinism win.
- **SVG line tween uses `attr:`**: GSAP tweens SVG attributes via the `attr` plugin (built into core gsap). Don't use `setAttribute()` in `onUpdate` — `attr` is the idiomatic, seek-safe form.
- **Starting angle `-π/2`**: Puts the first avatar at 12 o'clock. If you want the first avatar at 3 o'clock, use `0` (default).
- **Wider than tall**: `RADIUS_X > RADIUS_Y` for a horizontal ellipse — feels more "audience around" than a perfect circle.
- **8–12 avatars**: Optimum count. Fewer feels sparse; more clusters at top/bottom.
- **No infinite repeats**: For breathing, set finite `repeat` (e.g. `repeat: 2, yoyo: true` = 3 visible passes), not `repeat: -1`.
- **Composition dimensions baked in**: `CENTER_X`, `CENTER_Y`, `RADIUS_X`, `RADIUS_Y` are pre-calculated for the known `data-width × data-height` of the composition root. If you change dimensions, recompute.

## Why Build DOM in JS, Not Hand-Write Each Avatar?

Hand-writing N avatars and N lines with their per-avatar coordinates is brittle — change `RADIUS_X` and you'd have to recompute every `left` / `top` / `x2` / `y2`. Generating from constants keeps a single source of truth. The DOM creation runs once synchronously; the timeline is built immediately after — both finished before HyperFrames first seeks.

## Tips

- Vary avatar sizes slightly by index: `90 + (i % 3) * 15` — organic, not stamped.
- `stroke-dasharray: "4 4"` reads as "network connection." A solid line reads as "wire."
- For colored connection-line gradients, define `<linearGradient>` in `<defs>` and reference via `stroke="url(#gradId)"`.

## Combinations

- Center element: pair with [counting-dynamic-scale](counting-dynamic-scale.md) for "12M+ creators" counter at the network center.
- Wrapper: place inside [coordinate-target-zoom](coordinate-target-zoom.md) when the camera should push into the network mid-scene.
- Entry: `back.out(1.7)` is the standard bouncy entry; for a calmer feel use `power3.out`.

## Examples

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — Phase 4 uses this cloud around the centered logo with a `12M+` counter above.
