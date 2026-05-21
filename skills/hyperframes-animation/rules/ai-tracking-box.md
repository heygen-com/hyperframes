---
name: ai-tracking-box
description: Animated bounding box with L-shaped corner markers following an oscillating path — simulates AI object detection / tracking.
metadata:
  tags: ai, tracking, bounding-box, detection, corner, yellow, ml
---

# AI Tracking Box

A bounding box with corner markers ("L-brackets") that follows a moving target, simulating real-time AI detection. Position and size oscillate on sine paths to mimic continuous re-computation. Conventionally rendered in "AI detection yellow" (`{detectionYellow}`) on a dark background with a confidence label.

## How It Works

- Box position `(x, y)` and size `(w, h)` are derived from sine + drift across composition time
- 4 L-bracket corner markers (`<div>` per corner with two-sided borders) sit ON the box
- Optional label tag above the top-left corner showing class name + confidence percent

All driven by GSAP timeline so HF seeks deterministically.

## HTML

```html
<div
  class="scene"
  id="track-scene"
  data-composition-id="track-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <!-- Background — could be a product mockup, hero image, etc. -->
  <div class="bg">
    <div class="bg-content">{Brand}</div>
    <div class="bg-mascot" id="mascot">{targetGlyph}</div>
  </div>

  <!-- Tracking box wraps the target -->
  <div class="track-box" id="track-box">
    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>
    <div class="label" id="label">{targetGlyph} {LABEL} · {confidence}%</div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at center, {bgInner} 0%, {bgOuter} 70%);
  font-family: {font};
  overflow: hidden;
}
.bg {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 60px;
}
.bg-content {
  position: absolute;
  top: 120px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 80px;
  font-weight: 900;
  color: {bgTextColor};
  letter-spacing: 12px;
  text-transform: uppercase;
}
.bg-mascot {
  position: absolute;
  font-size: 240px;
  line-height: 1;
}

.track-box {
  position: absolute;
  /* Position + size set by GSAP onUpdate */
  pointer-events: none;
  will-change: transform, width, height;
}
.corner {
  position: absolute;
  width: 48px;
  height: 48px;
}
.corner.tl {
  top: -8px;
  left: -8px;
  border-top: 6px solid {detectionYellow};
  border-left: 6px solid {detectionYellow};
}
.corner.tr {
  top: -8px;
  right: -8px;
  border-top: 6px solid {detectionYellow};
  border-right: 6px solid {detectionYellow};
}
.corner.bl {
  bottom: -8px;
  left: -8px;
  border-bottom: 6px solid {detectionYellow};
  border-left: 6px solid {detectionYellow};
}
.corner.br {
  bottom: -8px;
  right: -8px;
  border-bottom: 6px solid {detectionYellow};
  border-right: 6px solid {detectionYellow};
}
.label {
  position: absolute;
  top: -56px;
  left: -8px;
  padding: 8px 16px;
  background: {detectionYellow};
  color: {labelTextColor};
  font-family: {monoFont};
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 2px;
  border-radius: 6px;
  white-space: nowrap;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const box = document.getElementById("track-box");
  const mascot = document.getElementById("mascot");
  const label = document.getElementById("label");

  // Initial state — box invisible, will fade in
  gsap.set(box, { opacity: 0, scale: ENTRY_SCALE });

  // Phase 1 — box entry (fade in + scale to 1)
  tl.to(
    box,
    {
      opacity: 1,
      scale: 1,
      duration: ENTRY_DUR,
      ease: `back.out(${ENTRY_BOUNCE})`,
    },
    ENTRY_START,
  );

  // Phase 2 — continuous "AI tracking" — box and mascot move in lock-step on sine paths
  const SCREEN_CENTER = { x: COMP_WIDTH / 2, y: COMP_HEIGHT / 2 };
  // DRIFT_X / DRIFT_Y — target oscillation amplitude (px)
  // SIZE_BASE / SIZE_VAR — box mean size + per-frame jitter amplitude (px)
  // SIZE_FREQ_MULT — multiplier on tracking phase so box "breathes" off-tempo from drift
  // CYCLES — number of full oscillations across TRACK_DUR
  // TRACK_DUR — duration of the tracking phase (s)
  // TRACK_START — when tracking phase begins (s)
  // CONFIDENCE_MEAN / CONFIDENCE_VAR — center + half-range of the flickering confidence %
  // CONFIDENCE_FREQ_MULT — how fast confidence flickers relative to drift

  const tracking = { p: 0 };
  tl.to(
    tracking,
    {
      p: Math.PI * 2 * CYCLES,
      duration: TRACK_DUR,
      ease: "none",
      onUpdate: () => {
        // Target position (the mascot moves on a wider arc)
        const mx = SCREEN_CENTER.x + Math.cos(tracking.p) * DRIFT_X;
        const my = SCREEN_CENTER.y + Math.sin(tracking.p) * DRIFT_Y;
        mascot.style.position = "absolute";
        mascot.style.left = `${mx - MASCOT_SIZE / 2}px`;
        mascot.style.top = `${my - MASCOT_SIZE / 2}px`;

        // Box size oscillates slightly (size confidence variation)
        const w = SIZE_BASE + Math.sin(tracking.p * SIZE_FREQ_MULT) * SIZE_VAR;
        const h = SIZE_BASE + Math.sin(tracking.p * SIZE_FREQ_MULT + Math.PI / 2) * SIZE_VAR;

        // Box position centers on mascot
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        box.style.left = `${mx - w / 2}px`;
        box.style.top = `${my - h / 2}px`;

        // Confidence label fluctuates inside [CONFIDENCE_MEAN ± CONFIDENCE_VAR]
        const confidence = Math.round(
          CONFIDENCE_MEAN + Math.sin(tracking.p * CONFIDENCE_FREQ_MULT) * CONFIDENCE_VAR,
        );
        label.textContent = `${TARGET_GLYPH} ${LABEL_TEXT} · ${confidence}%`;
      },
    },
    TRACK_START,
  );

  window.__timelines["track-scene"] = tl;
</script>
```

## How to Choose Values

- **ENTRY_SCALE** — start scale of the box before it pops in
  - Range: 0.5-0.9
  - Effects: low end = stronger pop / more "snapping into focus"; high end = subtle reveal
  - Constraints: must be < 1 (box scales UP into place)
  - Reference: examples use 0.7

- **ENTRY_DUR** — duration of the fade-in + scale-up (seconds)
  - Range: 0.3-0.8 s
  - Effects: low end = snappy / authoritative lock-on; high end = soft / observational
  - Constraints: should end before TRACK_START
  - Reference: examples use 0.5

- **ENTRY_START** — when the entry tween begins (seconds, absolute on timeline)
  - Range: 0-2 s typically
  - Effects: late start = lets the viewer notice the target first before the AI "finds" it; early start = AI is already watching
  - Constraints: ENTRY_START + ENTRY_DUR ≤ TRACK_START
  - Reference: examples use 0.5

- **ENTRY_BOUNCE** — coefficient passed to `back.out(...)` on entry
  - Range: 1.2-2.5
  - Effects: low end = subtle overshoot; high end = exaggerated snap (reads as "aggressive lock-on")
  - Constraints: stick to `back.out` family — `elastic` reads as cartoonish, `power` reads as flat
  - Reference: examples use 1.4

- **TRACK_START** — when continuous tracking begins (seconds)
  - Range: ≥ ENTRY_START + ENTRY_DUR
  - Effects: gap between entry and tracking = pause for emphasis; no gap = seamless lock + follow
  - Constraints: TRACK_START + TRACK_DUR ≤ composition duration
  - Reference: examples use 1.0

- **TRACK_DUR** — length of the tracking phase (seconds)
  - Range: 2-8 s
  - Effects: short = "quick scan"; long = "sustained observation"
  - Constraints: must accommodate at least one full CYCLE to read as oscillation
  - Reference: examples use 4.0

- **CYCLES** — number of full sine oscillations of the target across TRACK_DUR
  - Range: 0.5-3
  - Effects: low = lazy drift; high = jittery / hyperactive target
  - Constraints: CYCLES / TRACK_DUR sets effective Hz of drift; keep < ~0.6 Hz or motion blurs
  - Reference: examples use 1.5

- **DRIFT_X / DRIFT_Y** — amplitude of target oscillation around screen center (px, 1920×1080 basis)
  - Range: 40-200 px
  - Effects: small = subtle hover; large = wide chase that pushes the box near the frame edge
  - Constraints: SCREEN_CENTER ± DRIFT must keep mascot fully on screen given MASCOT_SIZE
  - Reference: examples use 80 / 50

- **SIZE_BASE** — mean width/height of the bounding box (px)
  - Range: 200-500 px
  - Effects: small = "specimen tag"; large = "the box IS the subject"
  - Constraints: must visibly enclose the target glyph at all confidence sizes
  - Reference: examples use 320

- **SIZE_VAR** — half-amplitude of per-frame size jitter (px)
  - Range: 5-10% of SIZE_BASE
  - Effects: low end = stable / confident detector; high end = jittery / re-fitting detector. Outside this range reads as "broken" (too much) or "static UI" (none)
  - Constraints: keep < 0.15 × SIZE_BASE to avoid breaking the L-bracket illusion
  - Reference: examples use 30 (~9% of 320)

- **SIZE_FREQ_MULT** — multiplier on tracking phase for size oscillation
  - Range: 1.5-3
  - Effects: 1 = size pulses in lock-step with drift (reads mechanical); irrational ratio = organic re-fitting
  - Constraints: avoid integer ratios; non-integer reads as continuous recomputation
  - Reference: examples use 2.3

- **MASCOT_SIZE** — rendered width of the mascot element (px); used to center it on (mx, my)
  - Range: matches CSS `font-size` of `.bg-mascot`
  - Effects: must match the actual rendered size or mascot drifts out of the box
  - Constraints: MASCOT_SIZE / 2 = offset applied to top/left
  - Reference: examples use 240 (matches `font-size: 240px`)

- **CONFIDENCE_MEAN** — center % shown on the label
  - Range: 95-99
  - Effects: < 95 reads "uncertain"; 100 reads "fake-precise". 97 is the sweet spot for "confident AI"
  - Constraints: keep CONFIDENCE_MEAN + CONFIDENCE_VAR ≤ 99
  - Reference: examples use 97

- **CONFIDENCE_VAR** — flicker half-range around CONFIDENCE_MEAN
  - Range: 1-3
  - Effects: 0 = static (looks like a screenshot); >3 = unstable (looks broken)
  - Constraints: CONFIDENCE_MEAN ± CONFIDENCE_VAR ⊂ [95, 99]
  - Reference: examples use 2

- **CONFIDENCE_FREQ_MULT** — multiplier on tracking phase for label flicker
  - Range: 3-6
  - Effects: low = synced with drift (mechanical); high = fast nervous flicker (reads "live inference")
  - Constraints: keep above SIZE_FREQ_MULT so label flickers faster than the box breathes
  - Reference: examples use 4

- **COMP_WIDTH / COMP_HEIGHT** — composition pixel dimensions (used to derive SCREEN_CENTER)
  - Range: dictated by the HF composition (`data-width` / `data-height`)
  - Effects: not a creative choice — match the parent composition
  - Constraints: SCREEN_CENTER = (COMP_WIDTH/2, COMP_HEIGHT/2)
  - Reference: examples use 1920 × 1080

- **{detectionYellow}** — corner-marker + label background color
  - This is a **discrete convention**, not a tunable range. AI detection overlays are yellow on dark backgrounds across the industry (autonomous-vehicle HUDs, security CV, ML demos). Red reads as "warning", green as "success", blue as "info" — none read as "detection."
  - Recommended: a saturated warm yellow (`#facc15` / `#FCD34D` family) on a dark navy or near-black background. Substituting any other hue loses genre legibility.
  - Reference: examples use `#facc15` (Tailwind `yellow-400`)

- **{bgInner} / {bgOuter}** — radial-gradient background stops
  - Should be dark and low-chroma so the yellow markers pop
  - Constraints: choose colors with sufficient contrast against {detectionYellow} (the corners and label must remain readable)
  - Reference: examples use `#161a3a` (inner) → `#0b0d1f` (outer)

- **{labelTextColor}** — text color inside the yellow label tag
  - Constraints: must contrast against {detectionYellow}; typically the same near-black as {bgOuter}
  - Reference: examples use `#0b0d1f`

- **{font} / {monoFont}** — scene text font and label font
  - {font}: sans-serif body font for {Brand} backdrop
  - {monoFont}: monospaced font for the confidence label (mono reinforces "machine readout" affordance)
  - Reference: examples use `"Inter", sans-serif` and `"JetBrains Mono", monospace`

## Variations

### Multi-object detection

Multiple boxes at different phases (each tracking its own mascot). Each is its own onUpdate-driven set; offset their phase by `Math.PI / N` so they don't tick synchronously.

### Lost-then-reacquired

The box fades to {LOST_OPACITY} (~{LOST_DUR}) then re-snaps to a new position with a "REACQUIRED" label flash:

```js
tl.to(box, { opacity: LOST_OPACITY, duration: LOST_DUR }, LOST_START);
tl.to(
  box,
  { opacity: 1.0, duration: REACQUIRE_DUR, ease: `back.out(${REACQUIRE_BOUNCE})` },
  REACQUIRE_START,
);
tl.to(label, { textContent: "REACQUIRED · 99%", duration: 0 }, REACQUIRE_START);
```

(LOST_OPACITY ≈ 0.2-0.4; REACQUIRE_BOUNCE ≈ 1.8-2.5 for a snappier re-lock than the initial entry.)

### Tracking-then-zoom

After tracking, the camera (via [viewport-change](viewport-change.md)) zooms into the tracked box. Combined effect: "the AI found something, now show it."

## Key Principles

- **Yellow on dark background is the detection convention** — see {detectionYellow} entry. Other colors lose the genre signal.
- **Box ALWAYS contains the target** — recompute box position EVERY frame from target position; never trail behind. If the box lags, it reads as "broken tracker," not "smart AI."
- **Subtle size variation (~5-10% of SIZE_BASE)** — too much and the tracker looks confused; just right reads as "real-time recomputation."
- **Corner markers, not full borders** — L-brackets are the genre signature. Full border looks like a generic UI box.
- **Confidence label flickers in a tight range (CONFIDENCE_MEAN ± CONFIDENCE_VAR inside [95, 99])** — outside that range reads as "uncertain"; ≥100 reads as "fake-precise."
- **No CSS animation for the tracking — use timeline onUpdate** — HF seek-by-frame doesn't sync with CSS animation.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS animation on `.track-box` or `.corner`** — must be timeline-driven
- **`will-change: transform, width, height`** on `.track-box`
- **`pointer-events: none`** on `.track-box` — decorative overlay
- **Box position recomputed per-frame from target** — never tween box position separately from target

## Combinations

- [viewport-change.md](viewport-change.md) — zoom into the tracked box after detection phase
- [multi-phase-camera.md](multi-phase-camera.md) — wide shot during tracking, push-in on lock
- [sine-wave-loop.md](sine-wave-loop.md) — the mascot itself idle-breathes inside the box

## Pairs with HF skills

- `/hyperframes-animation` — onUpdate writing multi-element positions
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
