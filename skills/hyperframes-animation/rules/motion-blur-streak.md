---
name: motion-blur-streak
description: Fake directional velocity blur on a fast entrance or camera push-through — blur peaks at max speed and resolves to 0 at the settle, so the element streaks in then snaps sharp. Two paths — SVG feGaussianBlur on the motion axis, or an echo/ghost trail that collapses into the lead.
metadata:
  tags: motion-blur, velocity, streak, entrance, fly-in, ghost, echo, svg-filter, kinetic, camera, snap
---

# Motion-Blur Streak

Real per-frame motion blur isn't available to a seeked renderer (it integrates over shutter time, which a paused timeline has no concept of), so this rule **fakes** it for a fast element fly-in or a hard camera push-through. The blur **peaks at maximum velocity and resolves to 0 at the settle** — the element reads as streaking in then snapping sharp on arrival. The whole point is the _coupling_: the blur envelope rides the same ease and window as the position tween, so peak-blur lands exactly on peak-speed, and the element is razor-sharp the instant it stops.

Two implementation paths, both finite, deterministic, and seek-safe:

- **(A) Directional SVG blur** — an inline `<filter>` with `<feGaussianBlur stdDeviation="X 0">` (X on the axis of motion, 0 across it). GSAP tweens `X` from high → 0 through a proxy that calls `setAttribute` each frame. Cleanest, one element, true directional smear.
- **(B) Echo / ghost trail** — 2–4 duplicate copies at decreasing opacity, offset backward along the motion vector, collapsing into the lead element as it settles. No filter cost; reads as a "speed-line" stutter trail. Better when you want the streak _colored_ or _stylized_ rather than a literal optical blur.

This is for **entrances and mid-shot moves only** — a fast arrival, a beat that zooms past camera, a card slamming into a grid slot, a logo punching through into a lockup. **Never an exit on a non-final frame** (a blurred element fleeing off-frame mid-composition reads as a glitch, and a hard exit between scenes is the transition's job, not a per-element blur).

## How It Works

A fast move has a velocity profile: it accelerates off the start, peaks, then decelerates into the settle. An `out` ease (`expo.out`, `power4.out`) front-loads that — velocity is highest right at the start and bleeds to zero at the end. The fake works by mapping a **blur (or echo) envelope onto that same curve**:

1. **Position tween** — the element travels from an off-frame / pushed-back start to its resting transform (`x`/`y` for a fly-in, `scale` for a push-through) on a fast `out` ease over `MOVE_DUR`.
2. **Blur envelope** — in lockstep over the **same window and ease**, the smear goes from `PEAK_BLUR` → `0`. Because the ease front-loads velocity and the envelope shares it, max blur coincides with max speed, and blur hits exactly `0` as the element lands.
3. **Settle is sharp** — by `MOVE_START + MOVE_DUR` the element is at its resting transform with blur `0` (path A) or all echoes collapsed onto the lead (path B). It then holds, fully crisp, for the climax dwell.

Path A tweens the filter's `stdDeviation` attribute (a non-DOM-style numeric attribute) via a **proxy object** — GSAP can't tween an SVG attribute directly, so you tween a plain `{ v: PEAK_BLUR }` and write it back with `setAttribute` in `onUpdate`. Path B places the ghosts at deterministic backward offsets (`i * ECHO_STEP_PX`) and fades/collapses them on the same envelope.

## HTML

### Path A — directional SVG blur (recommended default)

```html
<div
  class="scene"
  id="streak-scene"
  data-composition-id="streak-scene"
  data-start="0"
  data-duration="DURATION"
  data-track-index="0"
>
  <!-- Inline filter: blur on the X axis only (stdDeviation="X 0"); 0 on Y keeps it a clean horizontal smear. -->
  <svg width="0" height="0" aria-hidden="true" style="position: absolute">
    <defs>
      <filter id="streak" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur id="streak-blur" in="SourceGraphic" stdDeviation="0 0" />
      </filter>
    </defs>
  </svg>

  <div class="streak-stage">
    <div class="streak-el" id="streak-el">{phrase}</div>
  </div>
</div>
```

### Path B — echo / ghost trail

```html
<div
  class="scene"
  id="streak-scene"
  data-composition-id="streak-scene"
  data-start="0"
  data-duration="DURATION"
  data-track-index="0"
>
  <div class="streak-stage">
    <!-- N-1 ghosts BEHIND the lead, then the lead on top. Ghosts are aria-hidden duplicates. -->
    <div class="streak-ghost" data-i="3" aria-hidden="true">{phrase}</div>
    <div class="streak-ghost" data-i="2" aria-hidden="true">{phrase}</div>
    <div class="streak-ghost" data-i="1" aria-hidden="true">{phrase}</div>
    <div class="streak-el" id="streak-el">{phrase}</div>
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
  background: {sceneBg};
  font-family: {font};
  overflow: hidden; /* the smear/echo extends past the resting position before settling */
}
.streak-stage {
  position: relative;
  display: grid;
  place-items: center;
}
.streak-el {
  position: relative;
  z-index: 2;
  font-size: EL_FONT_SIZE;
  font-weight: 900;
  letter-spacing: EL_TRACKING;
  color: {textColor};
  /* Path A only — reference the directional filter. (Omit for Path B.) */
  filter: url(#streak);
  will-change: transform, filter;
}

/* Path B ghosts — identical glyphs behind the lead, decreasing opacity */
.streak-ghost {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 1;
  font-size: EL_FONT_SIZE;
  font-weight: 900;
  letter-spacing: EL_TRACKING;
  color: {textColor};
  opacity: 0;
  will-change: transform, opacity;
  pointer-events: none;
}
```

## GSAP Timeline

### Path A — directional SVG blur

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // GSAP can't tween an SVG attribute directly — tween a proxy and write it back each frame.
  const blurNode = document.getElementById("streak-blur");
  const blurProxy = { v: PEAK_BLUR };
  const writeBlur = () => blurNode.setAttribute("stdDeviation", `${blurProxy.v} 0`); // X-axis only
  writeBlur(); // seed frame 0 so a seek to t=0 shows the streaked start, not a sharp pre-frame

  // Position: travel from off-frame to rest on a fast `out` ease (velocity front-loaded).
  tl.fromTo(
    "#streak-el",
    { x: ENTER_FROM_X, opacity: 0 },
    { x: 0, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
    MOVE_START,
  );

  // Blur envelope: SAME window + SAME ease so peak-blur == peak-speed, resolving to 0 at the settle.
  tl.to(blurProxy, { v: 0, duration: MOVE_DUR, ease: MOVE_EASE, onUpdate: writeBlur }, MOVE_START);

  window.__timelines["streak-scene"] = tl;
</script>
```

### Path B — echo / ghost trail

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Lead element: same fast `out` move as Path A.
  tl.fromTo(
    "#streak-el",
    { x: ENTER_FROM_X, opacity: 0 },
    { x: 0, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
    MOVE_START,
  );

  // Ghosts: each starts FURTHER back along the motion vector (deterministic, by index),
  // dimmer, and collapses onto the lead — all on the SAME ease/window so they vanish at the settle.
  const ghosts = gsap.utils.toArray(".streak-ghost");
  ghosts.forEach((g) => {
    const i = Number(g.dataset.i); // 1..N-1, set in HTML (no Math.random)
    tl.fromTo(
      g,
      { x: ENTER_FROM_X - i * ECHO_STEP_PX, opacity: GHOST_BASE_OPACITY / i },
      { x: 0, opacity: 0, duration: MOVE_DUR, ease: MOVE_EASE },
      MOVE_START,
    );
  });

  window.__timelines["streak-scene"] = tl;
</script>
```

## Variations

### Vertical streak (rise / drop-in)

Swap the motion axis: use `y` instead of `x` for the position tween, `stdDeviation="0 Y"` for Path A (blur on Y, 0 on X), and `ENTER_FROM_Y` / vertical echo offsets for Path B. A phrase that streaks _up_ into place pairs with `kinetic-type-beats`' rise-rotate beat.

### Camera push-through (scale streak into a lockup)

Instead of translating, the element rushes the camera: `scale: SCALE_FROM → 1` on the fast `out` ease, with a **radial / zoom blur** feel approximated by a symmetric `stdDeviation="B B"` envelope (blur on both axes since the smear is depth-wise, not directional). This is the `logo-assemble-lockup` push-through — the wordmark punches forward out of soft focus and snaps crisp at the lock.

```js
tl.fromTo(
  "#streak-el",
  { scale: SCALE_FROM, opacity: 0 },
  { scale: 1, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
  MOVE_START,
);
tl.to(
  blurProxy,
  {
    v: 0,
    duration: MOVE_DUR,
    ease: MOVE_EASE,
    onUpdate: () => blurNode.setAttribute("stdDeviation", `${blurProxy.v} ${blurProxy.v}`),
  },
  MOVE_START,
);
```

### Staggered grid streak-in (cards assemble)

For `grid-card-assemble`: each card streaks into its slot from its own backward offset, staggered. Drive every card off the same ease/window with a per-index delay; derive the entrance offset and start time from the card's index (no `Math.random`). Each card is sharp the instant it lands in its slot.

```js
gsap.utils.toArray(".grid-card").forEach((card, i) => {
  const at = MOVE_START + i * CARD_STAGGER;
  tl.fromTo(
    card,
    { x: ENTER_FROM_X, opacity: 0 },
    { x: 0, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
    at,
  );
  // + a per-card blur proxy tween at the same `at` (Path A), or per-card ghosts (Path B)
});
```

### Hold-the-streak (whip emphasis on a single beat)

For a single kinetic phrase that "zooms past," keep the streak slightly visible a frame or two longer by easing the blur on a marginally _slower_ curve than the position (e.g. position `expo.out`, blur `power3.out`) — the element arrives, then the last wisp of smear resolves. Use sparingly; the default is locked envelopes.

## How to Choose Values

### Motion

- **MOVE_EASE** — shared ease for position and blur/echo.
  - Range: `expo.out` (hardest snap), `power4.out` (hard slam, default), `power3.out` (firm but softer)
  - Effects: harder `out` → velocity more front-loaded → blur reads as a sharper streak that resolves later in the window
  - Constraints: must be an `out`-family ease (velocity front-loaded). An `inOut` or `in` ease puts peak speed mid/late and the blur-speed coupling breaks. **Position and blur must use the SAME ease** (except the deliberate Hold-the-streak variation).
- **MOVE_DUR** — travel + blur-resolve duration.
  - Range: 0.25–0.6 s
  - Effects: shorter → more violent whip; longer → a glide, the streak loses punch
  - Constraints: a streak is _fast_ — over ~0.7 s it stops reading as velocity blur and looks like a focus pull
- **MOVE_START** — timeline position of the entrance.
  - Constraints: leave **≥1 s of dwell** after `MOVE_START + MOVE_DUR` before the composition ends (climax dwell — a streak that lands at `t = DURATION − 0.2 s` reads as "flashed and gone")
- **ENTER_FROM_X / ENTER_FROM_Y** — off-frame start offset along the motion axis.
  - Range: 40–120% of the element's own dimension on that axis (far enough to read as "came from off-frame")
  - Effects: larger → longer travel → the streak has more runway to read; too small and there's no sense of speed

### Path A — SVG blur

- **PEAK_BLUR** — `stdDeviation` at maximum velocity (start of the window).
  - Range: 8 (subtle) → 18 (default) → 30 (extreme whip)
  - Effects: higher → heavier smear at peak speed; too high erases the glyph entirely at the start frame
  - Constraints: ≤ ~30 — beyond that the element is unreadable for the first several frames and reads as "missing then appearing"; the filter region (`x/y/width/height` on `<filter>`) must be large enough (≥`-50% … 200%`) or the smear clips at the box edge
- **SCALE_FROM** (push-through variation) — starting scale for a camera push.
  - Range: 1.3 (gentle push) → 2.5 (aggressive punch-through)

### Path B — echo trail

- **N (ghost count)** — number of ghosts behind the lead (set by how many `.streak-ghost` you author).
  - Range: 2–4
  - Effects: more ghosts → a longer, smoother smear; >4 reads as a stutter / strobe rather than a streak
- **ECHO_STEP_PX** — backward offset per ghost along the motion vector.
  - Range: 12–40 px
  - Effects: larger → a more spread-out, visible trail; smaller → a tight blur-like cluster
  - Constraints: `(N) × ECHO_STEP_PX` should be ≲ `ENTER_FROM_X` so the furthest ghost still starts within the travel runway
- **GHOST_BASE_OPACITY** — opacity of the nearest ghost (`i = 1`); falls off as `BASE / i`.
  - Range: 0.3 (faint) → 0.6 (pronounced)
  - Constraints: ≤ ~0.6 — opaque ghosts read as duplicate elements, not a trail

### Layout & type

- **EL_FONT_SIZE / EL_TRACKING** — the streaking element's type weight (when it's a phrase).
  - Constraints: heavy display weight (≥120 px at 1080p, ≥800 weight) so the smear has mass to streak; thin type smears into invisibility
- **CARD_STAGGER** (grid variation) — delay between consecutive cards.
  - Range: 0.05–0.12 s — tight enough to read as one assembling wave, not separate arrivals

### Tokens

- **{sceneBg}** — background; a streak reads best against a solid / low-detail field (a busy bg fights the smear)
- **{font}** — typographic stack (embedded display face if the streaking element is text — see typography reference)
- **{textColor}** — element color; for Path B the ghosts inherit this, so a slightly desaturated trail can be had by tinting `.streak-ghost` separately
- **{phrase}** — the word / glyph / wordmark that streaks in

## Key Principles

- **Blur peaks at peak speed, resolves to 0 at the settle** — this is the whole rule. Share the ease and window between the position tween and the blur/echo envelope so they're locked. A blur that lingers after the element stops, or peaks after it's already slow, reads as a focus pull, not velocity.
- **`out`-family ease, always** — velocity must be front-loaded (fast off the start, decelerating in). `expo.out` / `power4.out` / `power3.out`. An `in` or `inOut` ease puts peak speed in the wrong place and the coupling falls apart.
- **Directional blur on the motion axis** (Path A) — `stdDeviation="X 0"` for horizontal, `"0 Y"` for vertical, `"B B"` only for a depth/scale push. A symmetric blur on a sideways move looks like defocus, not speed.
- **Tween a proxy, write the attribute** (Path A) — GSAP tweens the plain `{ v }` object; `onUpdate` calls `setAttribute("stdDeviation", …)`. You cannot tween the SVG attribute directly, and you must **seed it once at setup** so a seek to `t=0` shows the streaked start.
- **Ghosts are deterministic, by index** (Path B) — offset `i * ECHO_STEP_PX`, opacity `BASE / i`. Never `Math.random` for the trail; index drives all per-ghost variation so every seek is identical.
- **Entrances only, never a mid-composition exit** — a streak is an _arrival_. A blurred element leaving on a non-final frame reads as a glitch; scene-to-scene exits are the transition's job (see `../../transitions/overview.md`).
- **Earn the sharp hold** — after the snap, the crisp element must dwell ≥1 s. The contrast between the violent streak and the still, sharp settle _is_ the effect.
- **Heavy element, solid background** — thin type or a busy backdrop both swallow the smear. Big bold mass on a clean field reads.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`.
- **Registry key = `data-composition-id`** on the root.
- **No CSS `transition`** on the streaking element (or ghosts) — it interpolates independently of HF seek and causes flicker. Only GSAP drives the move and the blur.
- **No `repeat` / `yoyo` / infinite** — a streak is a single finite arrival. Finite tweens only.
- **No `Math.random` / `Date.now`** — ghost offsets/opacities and any stagger derive from the element index; deterministic every seek.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never tween `width` / `height` / `left` / `top`. Tweening `filter` (the proxy → `stdDeviation`) and `opacity` is seek-safe and fine.
- **Seed the SVG `stdDeviation` at setup** (Path A) — write it once before play so a seek to the first frame renders the streaked start, not a momentarily-sharp pre-frame.
- **Filter region must be generous** (Path A) — `<filter x="-50%" y="-50%" width="200%" height="200%">` so the smear doesn't clip at the element's box edge.
- **`overflow: hidden` on the scene** — the smear / furthest ghost extends past the resting position during travel; contain it so it doesn't bleed outside the frame.

## Combinations

- [kinetic-beat-slam.md](kinetic-beat-slam.md) — use this streak as the entrance for one phrase in a beat sequence (the scale-slam beat _is_ a motion-blur fly-in); reads its onset from the shared `BEATS[]` array
- [center-outward-expansion.md](center-outward-expansion.md) — the grid streak-in is center-expansion with a velocity-blur envelope on each element's travel
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — extruded depth on the phrase that streaks in (depth layers ride the lead's transform)
- [scale-swap-transition.md](scale-swap-transition.md) — alternative for a SAME-footprint state swap (this rule is for a fast ARRIVAL from off-frame / depth, not a morph)

## Pairs with HF skills

- `/hyperframes-animation` — `out`-family easing, proxy-driven `onUpdate` attribute tweens, and locked-envelope coordination (`../../adapters/gsap-easing-and-stagger.md`)
- `/hyperframes-creative` — `references/typography.md` (embedded display face for a text streak), `references/video-composition.md` (solid field behind the smear)
- `/hyperframes-core` — composition wiring, determinism (finite tweens, no `Math.random`)
- `/hyperframes-cli` — `hyperframes lint` / `hyperframes check` (validate catches a missing `#streak-blur` node or an unreferenced filter)
