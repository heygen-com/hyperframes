---
name: ai-tracking-box
description: Animated bounding box with L-shaped corner markers following an oscillating path — simulates AI object detection / tracking.
metadata:
  tags: ai, tracking, bounding-box, detection, corner, yellow, ml
---

# AI Tracking Box

A bounding box of four L-bracket corners + a confidence label that follows a moving target, simulating real-time AI detection. Rendered in detection yellow (`#facc15` family) on a dark background — the industry convention (AV HUDs, security CV, ML demos); red reads "warning", green "success", blue "info" — none read "detection."

## How It Works

ONE `ease: "none"` driver tween advances a phase `p`; its `onUpdate` computes the TARGET's position from trig, then derives the box's position/size FROM the target — every frame, in that order. The box never gets its own position tween: if it trails the target it reads as a broken tracker, not a smart AI. Size jitters a few percent off-tempo (non-integer frequency multiple) to mimic continuous re-fitting, and the confidence label flickers inside [95, 99].

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="bg-mascot" id="mascot">{targetGlyph}</div>
<div class="track-box" id="track-box">
  <div class="corner tl"></div>
  <div class="corner tr"></div>
  <div class="corner bl"></div>
  <div class="corner br"></div>
  <div class="label" id="label">{LABEL} · {confidence}%</div>
</div>
```

```css
.track-box {
  position: absolute; /* position + size written by the driver's onUpdate */
  pointer-events: none;
  will-change: transform, width, height;
}
.corner {
  position: absolute;
  width: 48px;
  height: 48px;
}
/* Each corner draws only its two outer borders — .tr/.bl/.br mirror this: */
.corner.tl {
  top: -8px;
  left: -8px;
  border-top: 6px solid {detectionYellow};
  border-left: 6px solid {detectionYellow};
}
.label {
  position: absolute;
  top: -56px;
  left: -8px;
  background: {detectionYellow};
  color: {labelTextColor}; /* near-black on yellow */
  font-family: {monoFont}; /* mono = machine readout */
  white-space: nowrap;
}
```

```js
const box = document.getElementById("track-box");
const mascot = document.getElementById("mascot");
const label = document.getElementById("label");
const C = { x: COMP_WIDTH / 2, y: COMP_HEIGHT / 2 };

// Entry — the AI "locks on"
gsap.set(box, { opacity: 0, scale: ENTRY_SCALE });
tl.to(
  box,
  { opacity: 1, scale: 1, duration: ENTRY_DUR, ease: `back.out(${ENTRY_BOUNCE})` },
  ENTRY_START,
);

// Tracking — target first, box derived from it, every frame
const tracking = { p: 0 };
tl.to(
  tracking,
  {
    p: Math.PI * 2 * CYCLES,
    duration: TRACK_DUR,
    ease: "none",
    onUpdate: () => {
      const mx = C.x + Math.cos(tracking.p) * DRIFT_X;
      const my = C.y + Math.sin(tracking.p) * DRIFT_Y;
      mascot.style.left = `${mx - MASCOT_SIZE / 2}px`;
      mascot.style.top = `${my - MASCOT_SIZE / 2}px`;

      const w = SIZE_BASE + Math.sin(tracking.p * SIZE_FREQ_MULT) * SIZE_VAR;
      const h = SIZE_BASE + Math.sin(tracking.p * SIZE_FREQ_MULT + Math.PI / 2) * SIZE_VAR;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      box.style.left = `${mx - w / 2}px`;
      box.style.top = `${my - h / 2}px`;

      const conf = Math.round(
        CONFIDENCE_MEAN + Math.sin(tracking.p * CONFIDENCE_FREQ_MULT) * CONFIDENCE_VAR,
      );
      label.textContent = `${LABEL_TEXT} · ${conf}%`;
    },
  },
  TRACK_START,
);
```

## Variations

- **Multi-object**: one driver per box/target pair, phases offset by `π / N` so they don't tick synchronously.
- **Lost-then-reacquired**: fade the box to ~0.2–0.4 opacity, then re-snap with a harder `back.out(1.8–2.5)` and flash a "REACQUIRED · 99%" label via `tl.set`.
- **Tracking-then-zoom**: hand off to [viewport-change.md](viewport-change.md) — "the AI found something, now show it."

## Values

| token                | range              | notes                                                                    |
| -------------------- | ------------------ | ------------------------------------------------------------------------ |
| ENTRY_SCALE          | 0.5–0.9            | < 1 — the box snaps UP into focus                                        |
| ENTRY_DUR / \_BOUNCE | 0.3–0.8s / 1.2–2.5 | `back.out` only — elastic reads cartoonish, power reads flat             |
| TRACK_START          | ≥ entry end        | a gap = pause for emphasis; none = seamless lock + follow                |
| TRACK_DUR            | 2–8s               | ≥ one full cycle or the drift never reads as oscillation                 |
| CYCLES               | 0.5–3              | keep effective rate < ~0.6 Hz or the motion blurs                        |
| DRIFT_X / DRIFT_Y    | 40–200px           | center ± drift must keep the target fully on screen                      |
| SIZE_BASE            | 200–500px          | must visibly enclose the target at all jitter sizes                      |
| SIZE_VAR             | 5–10% of SIZE_BASE | more reads broken, none reads like a screenshot; keep < 0.15×            |
| SIZE_FREQ_MULT       | 1.5–3, non-integer | integer ratios pulse in lock-step with drift = mechanical                |
| CONFIDENCE_MEAN/VAR  | 95–99 / 1–3        | mean ± var ⊂ [95, 99]; < 95 "uncertain", 100 "fake-precise"; 97 is sweet |
| CONFIDENCE_FREQ_MULT | 3–6                | > SIZE_FREQ_MULT — label flickers faster than the box breathes           |
| MASCOT_SIZE          | = rendered size    | mismatch drifts the target out of the box                                |

Tokens: `{detectionYellow}` `#facc15` family; `{bgInner}/{bgOuter}` dark low-chroma radial so the yellow pops; `{labelTextColor}` near-black; `{monoFont}` for the label.

## Critical Constraints

- **❗ Box recomputed per-frame FROM the target** — one driver computes the target position, then the box derives from it in the same `onUpdate`. Never tween the box's position separately.
- **Corner L-brackets, not a full border** — the genre signature; a full border reads as a generic UI box.
- **Yellow-on-dark** — substituting another hue loses genre legibility.
- **Confidence flickers in a tight band inside [95, 99]**, in a mono font.
- **`pointer-events: none`** on the box — it's a decorative overlay.

## See also

`viewport-change` (zoom into the detection) · `multi-phase-camera` (wide during tracking, push-in on lock) · `sine-wave-loop` (the target idle-breathes inside the box).
