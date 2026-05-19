---
id: concept-demo-decode-pan
role: concept-demo
duration_seconds: [6, 10]
phases: 4
visual_arc: text-decode → scene-pan → cursor-track
uses_rules: [hacker-flip-3d, camera-cursor-tracking, discrete-text-sequence]  # discrete-text-sequence = smooth-slice variant
element_roles:
  shot1_static: Context-setting text that fades in (tagline, slogan)
  shot1_accent: Accent word that decrypts via hacker-flip 3D (the hook)
  shot2_interactive: Interactive element (search bar, input field) with cursor-tracked typing
when_to_use:
  - Two visually distinct shots connected by a cinematic transition
  - First shot reveals text dramatically (decode / decrypt)
  - Second shot demonstrates product interaction (typing, search, input)
  - "Reveal the concept → show it in action" flow
when_not_to_use:
  - Single scene, no transition — see brand-reveal-assemble-zoom or takeover-ticker-displace
  - Shots should cross-fade rather than pan
  - No text decode in the first shot
  - Second shot is static (no dynamic tracking)
triggers: [decode effect, decrypt, scene transition, search bar typing, horizontal pan, show then demonstrate]
---

# Concept-Demo · Decode & Pan (HyperFrames)

Shot 1 text decode → horizontal camera pan with parallax → Shot 2 cursor-tracked interaction.

This blueprint is the HyperFrames port of the Remotion `decrypt-pan-track` choreography. The visual arc is identical; the implementation uses a single paused GSAP timeline driven by HyperFrames' seek loop instead of Remotion's frame-based render. The horizontal-pan "shot strip" architecture maps cleanly to a flex container with GSAP `x` transforms.

## When to Use

- Promo has two narrative beats: "concept reveal" and "product demo"
- First beat uses a dramatic text effect (hacker-flip decode)
- Second beat shows interactive behavior (typing, searching)
- Need cinematic spatial continuity between beats (pan, not cut)

## Phase Pipeline

All phase boundaries are expressed in **seconds**.

| Phase | Time window (s)           | What Happens                                                        | Skill Reference                                                                                                             |
| ----- | ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1     | `0 – entryEnd`            | Shot 1 static text fades in + rises                                 | inline entry                                                                                                                |
| 2     | `decodeDelay – decodeEnd` | Accent word decrypts via 3D flip                                    | [hacker-flip-3d](../rules/hacker-flip-3d.md)                                                                                |
| 3     | `panStart – panEnd`       | Camera pans to Shot 2 + Shot 1 parallax exit + Shot 2 fade/scale in | See "Phase 3" below                                                                                                         |
| 4     | `typingStart – typingEnd` | Search bar already in view + cursor-tracked typing                  | [camera-cursor-tracking](../rules/camera-cursor-tracking.md) + [discrete-text-sequence](../rules/discrete-text-sequence.md) |

## Layout Architecture: Horizontal Shot Strip

This pattern places multiple complete shots **side by side** in a flex row. Camera movement = `x` translation on the strip container. Each shot is exactly one viewport wide so the pan distance equals `data-width`.

```html
<div class="viewport" style="position: absolute; inset: 0; overflow: hidden;">
  <div class="strip" style="display: flex; height: 100%;">
    <div
      class="shot shot1"
      style="width: 1920px; height: 100%; position: relative; flex-shrink: 0;"
    >
      <!-- Shot 1 content (static text + hacker-flip accent) -->
    </div>

    <div
      class="shot shot2"
      style="width: 1920px; height: 100%; position: relative; flex-shrink: 0;"
    >
      <!-- Shot 2 content (interactive search bar) -->
    </div>
  </div>
</div>
```

- `overflow: hidden` on the viewport clips off-screen shots.
- `flex-shrink: 0` prevents the second shot from being squeezed to make the strip fit.
- The strip width is implicit: `shots × viewportWidth`. Flex with `flex-shrink: 0` honors that.
- GSAP tweens `.strip` `x` from `0` to `-viewportWidth` to pan from Shot 1 to Shot 2.

## Phase 1: Shot 1 Text Entry

Simple fade-in + vertical rise. Static text provides context before the accent word decrypts.

```js
const ENTRY_DUR = 0.67; // ≈20 frames at 30fps
const RISE_DIST = 30; // px the text rises into place

tl.fromTo(
  ".shot1-text",
  { opacity: 0, y: RISE_DIST },
  { opacity: 1, y: 0, duration: ENTRY_DUR, ease: "power2.out" },
  0,
);
```

## Phase 2: Hacker-Flip Decode

The accent word (e.g. "campaign") splits into individual characters, each with a staggered `back.out` rotation + per-glyph onUpdate that derives the visible character from `tl.time()`. See [hacker-flip-3d](../rules/hacker-flip-3d.md) for the full pattern.

Layout: static text and accent text sit side-by-side in a flex row. The `font-weight: 700` on the accent word creates visual hierarchy — the decoded word reads as the focal element even before the transition.

```html
<div
  class="shot1-text"
  style="display: flex; align-items: baseline; gap: 0.4em;
     font-size: 130px;"
>
  <span style="font-weight: 500; color: #111827;">Spark your next</span>
  <span class="accent" style="font-weight: 700; display: flex; perspective: 800px;">
    <!-- one .flip-glyph span per character of "campaign", generated by JS -->
  </span>
</div>
```

## Phase 3: Horizontal Shot Pan (Core Glue)

A single timeline position drives three concurrent tweens: camera pan, Shot 1 parallax exit, and Shot 2 entry. The Remotion source used **one spring** read three times; the GSAP idiom is **three tweens started at the same timeline position**.

```js
const PAN_START = 2.83; // seconds
const PAN_DURATION = 0.67; // ≈20 frames at 30fps
const VIEWPORT_W = 1920;
const PARALLAX_DIST = 400; // Shot 1 content moves this much further than the camera

// (1) Camera pan — strip slides one viewport left.
tl.fromTo(
  ".strip",
  { x: 0 },
  { x: -VIEWPORT_W, duration: PAN_DURATION, ease: "power3.inOut" },
  // power3.inOut approximates spring(stiffness:60, damping:12, mass:1.2) — the
  // cinematic slow-in-slow-out feel. Avoid back.out for a camera pan; the
  // overshoot reads as a UI bounce, not a camera move.
  PAN_START,
);

// (2) Shot 1 parallax exit — content moves an EXTRA -PARALLAX_DIST beyond the strip
//     (near-plane appears to move faster than the camera).
tl.fromTo(
  ".shot1-text",
  { x: 0 },
  { x: -PARALLAX_DIST, duration: PAN_DURATION, ease: "power3.inOut" },
  PAN_START,
);

// Shot 1 also fades out early during the pan so the eye lands on Shot 2.
tl.to(".shot1-text", { opacity: 0, duration: PAN_DURATION * 0.4, ease: "power2.out" }, PAN_START);

// (3) Shot 2 entry — element fades in + scales with a soft overshoot for "landing" feel.
tl.fromTo(
  ".shot2-bar",
  { opacity: 0, scale: 0.8 },
  { opacity: 1, scale: 1, duration: PAN_DURATION, ease: "back.out(1.2)" },
  PAN_START,
);
```

### Parallax Tuning

`PARALLAX_DIST` typically **300–500 px**. Larger creates a stronger depth illusion, but too much makes Shot 1 feel "thrown away." Around 400 px (a quarter of viewport width) is a balanced default for 1920×1080.

### Pan Ease Choice

- `power3.inOut` — cinematic, slow start + slow finish. Feels like a camera.
- `power2.out` — quick start, gentle landing. Feels more like a UI swipe.
- `back.out(1.2)` — **avoid for the camera pan itself**. The overshoot at the end reads as a UI bounce. Reserve `back.out` for the _element entry_ inside Shot 2.

## Phase 4: Cursor-Tracked Typing

After the pan settles, typing begins in Shot 2. The search bar is **pre-positioned** in world space so its cursor lands at `CURSOR_TARGET` (typically 70% of viewport width). See [camera-cursor-tracking](../rules/camera-cursor-tracking.md) for the full pattern.

### Interactive Element Sizing

The search bar is a **hero element** in Shot 2 — it commands the screen, not floats as a small widget. Size all dimensions proportionally from `fontSize`, which should be **8–12% of viewport height** (96–130 px at 1080p).

```
fontSize:      120                                    /* anchor */
pillHeight:    fontSize × 2  = 240                    /* generous vertical padding */
paddingLeft:   fontSize × 1  = 120                    /* comfortable text inset */
paddingRight:  fontSize × 1.5 = 180                   /* visual balance, room for cursor */
pillWidth:     paddingLeft + fullTextWidth + cursorWidth + paddingRight
```

Too small a `fontSize` (< 80 px at 1080p) makes the bar look like a UI component, not a cinematic element. The bar should feel like a zoomed-in product shot.

### Timing

Typing start must be delayed until the pan is essentially complete.

```js
const TYPING_START = PAN_START + PAN_DURATION + 0.17; // ≈5 frames after pan ends
```

### Cursor-Locked Positioning

In the Remotion source, the search bar's `left` property was recalculated every frame from the typing progress. In HyperFrames, **`left` is a forbidden tween target** (layout property). Use one of:

1. **Pre-position the bar** at the world coordinate where the empty cursor sits at `CURSOR_TARGET`, then move the _camera_ (via the strip's `x`) to follow the cursor — see [camera-cursor-tracking](../rules/camera-cursor-tracking.md).
2. **Pre-allocate the bar's full width** and move the bar with GSAP `x` (transform alias) — but the camera is already controlled by the strip, so this requires nested transforms and is harder to reason about. Prefer option 1.

```js
// Pre-allocated bar width from real text measurement, not charWidthRatio.
await document.fonts.ready;
const fullTextWidth = measureNodeWidth(FULL_TEXT, "search-text");
const barWidth = PADDING_LEFT + fullTextWidth + cursorWidth + PADDING_RIGHT;
document.querySelector(".shot2-bar").style.width = barWidth + "px";
```

Use `getBoundingClientRect()` or `ctx.measureText()` for text width — **never** estimate with `charWidthRatio`. Proportional fonts diverge by tens of pixels per 30-character string.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Text entry completes before decode triggers.
  No value dependency — pure timing gap.

Phase 2 → Phase 3:
  Decode must visually settle before pan starts.
  PAN_START ≥ flipStart + flipStagger × (N-1) + flipDuration + 0.2

Phase 3 → Phase 4:
  Pan must be near complete before typing starts.
  TYPING_START = PAN_START + PAN_DURATION + ~0.17s buffer.
  Starting typing during the pan is disorienting — the eye can't read.

Inside Phase 4:
  Camera tracking is piecewise: hold initial offset until the typing cursor
  would exceed CURSOR_TARGET (in screen space), then follow. See
  camera-cursor-tracking.md for the Math.min(initial, tracking) formulation.
  If typing ends before the root composition's data-duration, extend the scene
  with a real visual hold (for example a finite cursor blink) through the root
  duration so Studio's playhead and the GSAP timeline end at the same time.
```

## Critical Constraints

- **Shot width = `data-width`**: Each shot div is exactly the composition's `data-width`. Mismatch causes the pan to over- or under-shoot.
- **`flex-shrink: 0` on every shot**: Without it, flex compresses shots into one viewport and the pan distance is wrong.
- **Parallax is additive**: Shot 1 content's `x` offset is **in addition** to the strip's `x`. Both tween at the same start time so the effect reads as a layered depth move, not two competing animations.
- **Pan ease, not bounce ease**: `power3.inOut` or `power2.out` for the strip. Avoid `back.out` — overshoot reads as UI, not camera. Reserve `back.out` for element entries within shots.
- **Typing delay**: `TYPING_START ≥ PAN_START + PAN_DURATION + buffer`. Buffer ~0.15–0.2s lets the eye settle.
- **Measure text after fonts ready**: All `measureNodeWidth()` calls happen inside `document.fonts.ready.then(...)`. Otherwise the measurement uses fallback font metrics and the bar/cursor alignment is off.
- **Pre-allocate the bar's width**: Compute from the full target string once, freeze the bar's `width` style. Don't tween width or rely on text-driven growth.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. The composition has at least three transforms in flight at peak (camera strip, shot1 parallax, shot2 entry) — all must be transform-only to stay on the compositor.
- **Single paused timeline**: All four phases live on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                          | This blueprint uses                             |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| `spring({ stiffness: 60, damping: 12, mass: 1.2 })` — cinematic camera | `power3.inOut`                                  |
| `spring({ stiffness: 150, damping: 14 })` — character flip             | `back.out(1.6)`                                 |
| Shot 2 entry scale 0.8 → 1.02 → 1                                      | `back.out(1.2)` (overshoot baked into the ease) |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [concept-demo-decode-pan.html](../examples/concept-demo-decode-pan.html) — "Spark your next campaign" hacker-flip decode → horizontal pan with parallax → "Tell me how to target parents" cursor-tracked search-bar typing. Single paused GSAP timeline drives all four phases.
