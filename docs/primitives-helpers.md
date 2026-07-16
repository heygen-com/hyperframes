# Primitives helpers

Copy-paste GSAP snippets for two recurring problems in primitive and frame authoring: moving a virtual camera over a static layout, and keeping a long hold from reading as a freeze-frame. Both are seek-safe by construction and both respect the elastic-HOLD law (stretch the hold, never `timeScale`).

## 1. Camera-servo rig

One wrapper element is "the world". The camera never moves; the world translates and scales under it. Every camera move is a `tl.to()` on a plain state object, so the whole rig lives on the single paused timeline and seeks like anything else.

The math: for a viewport of `VW x VH`, a world point at `(tx, ty)` lands on the viewport center when the wrapper transform is `translate(-(tx - VW/2) * s, -(ty - VH/2) * s) scale(s)`. Because targets are computed, not measured, there is no async layout dependency: pick target coordinates off your own absolutely positioned layout.

```html
<div id="stage" style="position: relative; width: 1920px; height: 1080px; overflow: hidden;">
  <div id="world" style="position: absolute; inset: 0; transform-origin: 0 0; will-change: transform;">
    <!-- the entire scene lives here, positioned in world pixels -->
  </div>
</div>
```

```js
const tl = gsap.timeline({ paused: true });

const VW = 1920, VH = 1080; // stage size in world pixels
const world = document.getElementById("world");
const cam = { scale: 1, x: 0, y: 0 };
const drift = { p: 0, dx: 0, dy: 0 };

function applyCamera() {
  world.style.transform =
    "translate(" + (cam.x + drift.dx) + "px, " + (cam.y + drift.dy) + "px) scale(" + cam.scale + ")";
}
applyCamera();

// Servo the camera so world point (tx, ty) sits at viewport center, at zoom s.
function camTo(s, tx, ty, at, dur, ease) {
  tl.to(
    cam,
    { scale: s, x: -(tx - VW / 2) * s, y: -(ty - VH / 2) * s, duration: dur, ease: ease, onUpdate: applyCamera },
    at,
  );
}

// The target schedule reads like a shot list. Times are absolute on the timeline.
camTo(1.05, VW / 2, VH / 2 - 80, 0.15, 2.0, "power2.inOut"); // gentle push-in
camTo(1.45, 620, 300, 2.35, 1.0, "power2.inOut");            // pan to a detail
camTo(1.35, VW / 2, 470, 4.7, 1.1, "power2.inOut");          // servo down
camTo(1.0, VW / 2, VH / 2, 7.7, 1.6, "power2.inOut");        // bookend pull-out

// Micro-drift: a few px of handheld life layered on top of the servo moves.
// The phase runs INTEGER full sine cycles (here 2), so sin(p) is exactly 0 at
// both ends: the drift starts at zero and lands at zero before the hold.
const DRIFT_END = 9.3; // must be <= the start of the final hold
tl.to(
  drift,
  {
    p: Math.PI * 2 * 2, // integer cycles only
    duration: DRIFT_END,
    ease: "none",
    onUpdate: () => {
      drift.dx = Math.sin(drift.p) * 3;
      drift.dy = Math.sin(drift.p * 1.5) * 2; // 1.5x on y: 3 cycles, also integer, also lands at 0
      applyCamera();
    },
  },
  0,
);
```

### When to reach for it

- A frame with one dense layout (a console, a dashboard, a document) that several beats inspect in close-up. The servo replaces cutting between duplicated layouts.
- Any time you are tempted to animate `transform` on three sibling containers to fake a pan. Move the one world wrapper instead; overlaps and z-order stay coherent for free.
- Skip it for single-subject frames. If nothing needs a close-up, a static stage plus normal entrances is simpler and reads better.

### Rules

- **One world wrapper.** All camera state funnels through `applyCamera()`. Never tween `world`'s transform directly from a second tween, and never mix the camera with per-element transforms on the wrapper itself; children animate freely.
- **Seek-safety.** `cam` and `drift` are plain objects tweened with `fromTo`-equivalent absolute targets on one paused timeline, so any `seek(t)` reproduces the exact transform. The one trap: `applyCamera` reads both objects, so both tweens must call it in `onUpdate`; do not cache the transform string.
- **Drift must die before the hold.** Integer sine cycles guarantee the drift value is exactly zero at its end time. Set the drift tween's end at or before the final hold starts, so the hold is dead still and byte-stable frame to frame. A hold with residual drift renders as a smear when the hold is stretched.
- **Multipliers stay integer-safe.** If you scale the y phase (the `1.5` above), the product of cycles times multiplier must still be an integer, or y-drift will not end at zero.
- **Never timeScale.** If the frame needs to run longer (voiceover ran long, elastic HOLD), extend the hold segment after `DRIFT_END`. `timeScale` on the timeline retimes every servo ease and turns designed moves into mush; the contract bans it.
- **No exits during holds.** The hold is the interchange point where a frame can be stretched or cut; anything animating there gets truncated at an arbitrary phase. Exits belong to the frame root (the `exit` variable, default `none`), never to the camera or to hold-phase tweens.

## 2. Hold-alive sine breath

A long hold on a static end state can read as a dropped frame. The fix is a barely-there breath on ONE property of ONE element: two mirrored halves that start at the rest value and end at the rest value, so the element is provably at rest on both sides of the breath.

Simplest form, two mirrored tweens (rest value 0 here, on rotation):

```js
// Hold runs 2.0s to 3.5s. One faint breath, back to rest with time to spare.
tl.to(mark, { rotation: 0.5, duration: 0.4, ease: "sine.inOut" }, 2.1);
tl.to(mark, { rotation: 0, duration: 0.5, ease: "sine.inOut" }, 2.5);
```

Continuous form, one full sine cycle driven through a phase object (use when the breath should span most of the hold, or the property is not directly tweenable):

```js
// sin(0) = 0, so there is no jump off the settled state, and one full cycle
// (p: 0 -> 2*PI) lands the value back at rest exactly at the end.
const REST = 0.28, AMP = 0.05;
const phase = { p: 0 };
tl.to(
  phase,
  {
    p: Math.PI * 2, // one full cycle; integer cycles only, same law as camera drift
    duration: 1.4,  // fits inside the hold with margin at both ends
    ease: "none",
    onUpdate: () => {
      el.style.opacity = (REST + Math.sin(phase.p) * AMP).toFixed(4);
    },
  },
  2.0,
);
```

### When to reach for it

- Any hold longer than about a second where the frame would otherwise be pixel-identical across frames: a closing card, a settled headline, a logo at rest.
- Prefer the mirrored-tweens form for transform properties (rotation, y, scale); prefer the phase form for opacity-like or SVG properties, or when you want the breath to occupy the whole hold.
- Skip it on deliberate dead-still ends (a `cta-close` style final card that ends the film wants stillness, not breath). One breath per frame; two breathing elements read as jitter.

### Rules

- **Zero-start, zero-end.** Both halves anchor to the rest value: the first tween leaves it, the second returns to it (or one integer sine cycle does both). The element must be verifiably at rest before the breath starts and after it ends, so stretching the hold on either side changes nothing.
- **Amplitude stays subliminal.** Fractions of a degree, a few hundredths of opacity, 1-3px. If a viewer can name the motion, it is too big.
- **Seek-safety.** Absolute-target tweens on the paused timeline; the phase form derives its value purely from `p`, so any seek lands the exact value. Never use `repeat: -1` or `yoyo` for this: an infinite repeat has no end state, breaks the byte-stable hold, and re-tween patterns are banned by the contract anyway.
- **Never timeScale.** A frame that needs a longer hold gets more rest time around the breath (or a second, later breath), not a slowed timeline. `timeScale` would also slow the breath itself below its designed rhythm.
- **No exits during holds.** Same law as above: the hold is elastic, so its tail can be extended or trimmed by the film assembly. An exit tween parked in the hold gets cut mid-motion at an unpredictable point. Exits are the frame root's job via the `exit` variable (default `none`); the breath ends at rest and the hold stays cuttable anywhere.
