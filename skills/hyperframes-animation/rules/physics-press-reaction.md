---
name: physics-press-reaction
description: Cursor + element synchronized press via subtractive spring forces — cursor lands on element, both compress together, then release. Distinct from press-release-spring (which has no cursor).
metadata:
  tags: spring, click, physics, cursor, subtractive, interaction, synchronized
---

# Physics Press Reaction (Cursor + Element Synced)

Models a real click: a cursor approaches a button, lands, and both compress IN SYNC, then release together. Two distinct timing events (down-frame and up-frame) bound by spring forces. Distinct from [press-release-spring](press-release-spring.md) (which has no cursor — just a press happening); this rule is the COMBINED cursor + element behavior.

## How It Works

A single `PRESS_INTENSITY` value drives both cursor and button together:

- **press down**: both compress to `1 - PRESS_INTENSITY`
- **release**: both spring back to 1.0 with overshoot

The cursor ALSO translates to the button's center during the approach phase BEFORE press starts. After release, the cursor may move on (next interaction) or hold.

## HTML

```html
<div
  class="scene"
  id="press-react-scene"
  data-composition-id="press-react-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="stack">
    <button class="btn" id="btn">
      <span class="btn-icon">{ctaIcon}</span>
      <span class="btn-label">{ctaCopy}</span>
    </button>
    <div class="brand">{Brand}</div>
  </div>
  <!-- Cursor lives at scene-root level so it can translate freely -->
  <svg class="cursor" id="cursor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 2 L21 12 L12 13 L7 22 Z"
      fill="{cursorFill}"
      stroke="{cursorStroke}"
      stroke-width="1.5"
    />
  </svg>
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
  overflow: hidden;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: STACK_GAP;
}
.btn {
  display: flex;
  align-items: center;
  gap: BTN_INNER_GAP;
  padding: BTN_PADDING_V BTN_PADDING_H;
  background: {btnBg};
  border: none;
  border-radius: BTN_RADIUS;
  color: {btnTextColor};
  font-family: {font};
  font-weight: 900;
  font-size: BTN_FONT_SIZE;
  letter-spacing: BTN_TRACKING;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: {btnRestingShadow};
  transform-origin: 50% 50%;
  will-change: transform;
}
.btn-icon {
  font-size: BTN_ICON_SIZE;
  line-height: 1;
}
.brand {
  font-size: BRAND_SIZE;
  font-weight: 800;
  letter-spacing: BRAND_TRACKING;
  color: {brandColor};
  text-transform: uppercase;
}
/* Cursor — absolute, positioned by GSAP */
.cursor {
  position: absolute;
  width: CURSOR_SIZE;
  height: CURSOR_SIZE;
  pointer-events: none;
  z-index: 100;
  /* initial position is set by gsap.set() */
  transform-origin: 0 0; /* arrow point is the click point */
  filter: {cursorDropShadow};
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Position cursor initially off-target (off-screen or far corner).
  gsap.set("#cursor", { x: CURSOR_START_X, y: CURSOR_START_Y });

  // The button's screen center, in composition coordinates.
  const BUTTON_CENTER = { x: BUTTON_CENTER_X, y: BUTTON_CENTER_Y };

  // Phase 1 — cursor approaches button
  tl.to(
    "#cursor",
    {
      x: BUTTON_CENTER.x,
      y: BUTTON_CENTER.y,
      duration: APPROACH_DUR,
      ease: "power2.inOut",
    },
    APPROACH_START,
  );

  // Phase 2 — coordinated press down (button + cursor both scale to 1 - PRESS_INTENSITY)
  tl.to(
    ["#btn", "#cursor"],
    {
      scale: 1 - PRESS_INTENSITY,
      duration: PRESS_DOWN_DUR,
      ease: "power1.in",
    },
    PRESS_DOWN_AT,
  );

  // Phase 3 — release (both spring back to 1.0 with overshoot)
  tl.to(
    ["#btn", "#cursor"],
    {
      scale: 1,
      duration: RELEASE_DUR,
      ease: `back.out(${BOUNCE_FACTOR})`,
    },
    RELEASE_AT,
  );

  // Phase 4 — inner glow during press (boxShadow change synced to press scale)
  tl.to(
    "#btn",
    {
      boxShadow: `{btnPressedShadow}`,
      duration: PRESS_DOWN_DUR,
      ease: "power1.in",
    },
    PRESS_DOWN_AT,
  );
  tl.to(
    "#btn",
    {
      boxShadow: `{btnRestingShadow}`,
      duration: RELEASE_DUR,
      ease: "power2.out",
    },
    RELEASE_AT,
  );

  // Brand fades in early (context)
  tl.from(
    ".brand",
    { opacity: 0, y: BRAND_REVEAL_Y_PX, duration: BRAND_REVEAL_DUR, ease: "power3.out" },
    BRAND_REVEAL_AT,
  );

  // Cursor optionally moves off after press (or holds for dwell)
  tl.to(
    "#cursor",
    { x: CURSOR_EXIT_X, y: CURSOR_EXIT_Y, duration: CURSOR_EXIT_DUR, ease: "power2.out" },
    CURSOR_EXIT_AT,
  );

  window.__timelines["press-react-scene"] = tl;
</script>
```

## Variations

### Multiple-element chain press

Cursor presses button A → button A triggers swap → cursor moves to button B → presses again. Each press is one full down-release sub-routine.

### Hold press (continuous pressure)

Insert a `HOLD_DUR` window between press-down and release. Cursor scale stays at `1 - PRESS_INTENSITY`, button scale stays at `1 - PRESS_INTENSITY`, inner glow stays on. Suggests "thinking" or "loading."

### Synchronized inner-glow pulse

During the hold phase, the inner glow pulses (sin-driven). Suggests "processing":

```js
const holdGlow = { p: 0 };
tl.to(
  holdGlow,
  {
    p: Math.PI * GLOW_PULSE_CYCLES * 2,
    duration: HOLD_DUR,
    ease: "none",
    onUpdate: () => {
      const alpha = GLOW_BASE_ALPHA + Math.sin(holdGlow.p) * GLOW_PULSE_AMP;
      document.getElementById("btn").style.boxShadow =
        `inset 0 0 GLOW_BLUR rgba(255, 255, 255, ${alpha})`;
    },
  },
  HOLD_START_AT,
);
```

## How to Choose Values

### Timing (seconds)

- **APPROACH_START** — when the cursor begins moving toward the button.
  - Range: 0-0.3 s (small lead-in is fine; long delays read as a dead frame)
- **APPROACH_DUR** — cursor approach duration.
  - Range: 0.7-1.3 s; faster reads as urgent, slower as deliberate
- **PRESS_DOWN_AT** — when the press fires.
  - Constraints: MUST equal `APPROACH_START + APPROACH_DUR` so the cursor arrives exactly when the press begins (avoids "tapping on air")
- **PRESS_DOWN_DUR** — compression duration.
  - Range: 0.1-0.25 s
- **RELEASE_AT** — when the release fires.
  - Constraints: must be > `PRESS_DOWN_AT + PRESS_DOWN_DUR`; an optional brief hold (0.05-0.4 s, or `HOLD_DUR` for the Hold-press variation) for "thinking" interactions
- **RELEASE_DUR** — release spring duration.
  - Range: 0.4-0.7 s (long enough for the overshoot to settle)
- **BRAND_REVEAL_AT** — when the brand line fades in.
  - Constraints: must be < `PRESS_DOWN_AT` (context precedes interaction)
- **BRAND_REVEAL_DUR** — brand fade-in duration.
  - Range: 0.4-0.8 s
- **CURSOR_EXIT_AT / CURSOR_EXIT_DUR** — optional outbound cursor motion after release.
  - Constraints: `CURSOR_EXIT_AT` must be ≥ `RELEASE_AT + RELEASE_DUR` so the cursor exits AFTER the press settles, not during

### Physics

- **PRESS_INTENSITY** — how deep the press compression goes.
  - Range: 0.05 (subtle) - 0.10 (standard) - 0.15 (heavy)
  - Applied as `scale: 1 - PRESS_INTENSITY` on both cursor and button (single GSAP target array)
- **BOUNCE_FACTOR** — `back.out(${BOUNCE_FACTOR})` overshoot on the release.
  - Range: 1.6 (soft) - 2.0 (firm) - 2.4 (cartoony)

### Positioning

- **CURSOR_START_X / CURSOR_START_Y** — initial cursor position in composition coordinates.
  - Constraints: off-screen or in a corner far from the button so the approach reads as motion-in, not a teleport
- **BUTTON_CENTER_X / BUTTON_CENTER_Y** — the button's measured screen-space center.
  - Source: measured at composition coordinates; for `place-items: center` at 1920×1080 this is `(960, 540)`
- **CURSOR_EXIT_X / CURSOR_EXIT_Y** — where the cursor moves after release (if used).
  - Range: any off-stage or out-of-the-way position
- **BRAND_REVEAL_Y_PX** — brand initial y offset.
  - Range: 8-20 px

### Layout / typography

- **STACK_GAP** — gap between button and brand line.
  - Range: 40-96 px
- **BTN_PADDING_V / BTN_PADDING_H** — button padding.
  - Range: V 24-40 px, H 60-100 px (horizontal padding 2-3× vertical reads as pill-shaped CTA)
- **BTN_INNER_GAP** — gap between icon and label inside the button.
  - Range: 16-32 px
- **BTN_RADIUS** — button corner radius.
  - Range: 20-40 px, or `BTN_PADDING_V + BTN_FONT_SIZE/2` for fully rounded ends
- **BTN_FONT_SIZE / BTN_ICON_SIZE** — typographic sizes inside the button.
  - Range: font 60-100 px at 1080p; icon ~1.0-1.1× font size
- **BTN_TRACKING** — letter-spacing on uppercase button text.
  - Range: 4-12 px
- **BRAND_SIZE / BRAND_TRACKING** — brand line typography.
  - Range: 40-60 px, tracking 8-16 px
- **CURSOR_SIZE** — cursor SVG size.
  - Range: 48-96 px at 1080p

### Hold-press variation

- **HOLD_DUR** — hold window between press down and release.
  - Range: 0.3-0.8 s
- **HOLD_START_AT** — when the glow pulse begins.
  - Constraints: typically equal to `PRESS_DOWN_AT + PRESS_DOWN_DUR`
- **GLOW_PULSE_CYCLES** — number of full sine cycles across `HOLD_DUR`.
  - Range: 1-4 (more cycles read as faster "processing")
- **GLOW_BASE_ALPHA** — center of the alpha pulse.
  - Range: 0.15-0.3
- **GLOW_PULSE_AMP** — peak deviation from `GLOW_BASE_ALPHA`.
  - Range: 0.1-0.2; must satisfy `GLOW_BASE_ALPHA - GLOW_PULSE_AMP ≥ 0`
- **GLOW_BLUR** — inset glow blur radius (px).
  - Range: 24-48 px

### Tokens

- **{sceneBg}** — background gradient/color
- **{font}** — typographic stack
- **{btnBg}** — button background (typically gradient toward an accent hue)
- **{btnTextColor}** — button text color
- **{btnRestingShadow}** / **{btnPressedShadow}** — outer + inset box-shadow strings for the resting and pressed states
- **{brandColor}** — accent brand color
- **{cursorFill}** / **{cursorStroke}** — cursor SVG fill and stroke
- **{cursorDropShadow}** — `filter: drop-shadow(...)` value for cursor depth
- **{Brand}** — brand line copy
- **{ctaCopy}** / **{ctaIcon}** — button label and inline icon glyph

## Key Principles

- **Same press scale on cursor AND button** — physical synchronicity. If only the button scales, the cursor appears to "tap on air"; if only the cursor scales, the button feels disconnected.
- **Cursor arrives BEFORE press starts** — there must be a clear moment of "cursor over target" before scale change. Otherwise the press is unattributed.
- **`back.out(${BOUNCE_FACTOR})` for release** — both elements need spring overshoot together. Linear release loses the tactile feel.
- **Inner glow appears DURING press, fades on release** — visual confirmation of contact. Outer shadow shrinks (pushed-in), inner glow appears (energy concentrated).
- **Cursor `pointer-events: none`** — the cursor is decorative; if it captures events, hover/click behaviors on button below break.
- **Cursor `transform-origin: 0 0`** — the arrow's tip is the click point, not its center. Scale around the tip keeps the click point stable.
- **Climax dwell ≥1 s** — after release, the comp must continue ≥1 s. The press is a beat; viewer needs time to see the result.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on either cursor or button — competes with GSAP
- **Cursor SVG with `pointer-events: none`**
- **`will-change: transform`** on button (and cursor if desired)
- **`up-frame > down-frame`** — release MUST come after press; otherwise the comp shows release without press
- **Don't use real `mouseenter` / `click` events** — HF is a render context, not a UI; everything must run via the timeline

## Combinations

- [press-release-spring.md](press-release-spring.md) — the BUTTON-only press variant; this rule layers cursor on top
- [cursor-click-ripple.md](cursor-click-ripple.md) — adds a ripple effect at the click point
- [scale-swap-transition.md](scale-swap-transition.md) — the press TRIGGERS the swap

## Pairs with HF skills

- `/hyperframes-animation` — coordinated multi-target tweens via array
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
