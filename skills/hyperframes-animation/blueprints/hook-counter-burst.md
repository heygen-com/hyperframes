---
id: hook-counter-burst
role: opening-hook
duration_seconds: [3, 5]
phases: 4
visual_arc: empty → icons-cluster → count-and-expand → camera-push
uses_rules:
  [counting-dynamic-scale, center-outward-expansion, multi-phase-camera, svg-icon-enrichment]
element_roles:
  counter: Central number counts 0 → target while growing in font size
  icons: 3-5 enriched SVG icons expand outward from center
  camera: Multi-phase zoom (pull-back → focus → push) wraps the scene
  background: Video or animated gradient with dark overlay for contrast
when_to_use:
  - Opening hook needs a single dramatic statistic
  - Statistic reinforced by 3-5 thematic icons
  - Scene must feel kinetic from frame 1
when_not_to_use:
  - Hook is text-driven, no numeric statistic
  - Product UI / demo footage is the focal point
  - Multiple numbers shown simultaneously
triggers: [opening hook, statistic, counting number, dramatic number, attention grabber]
---

# Hook · Counter Burst (HyperFrames)

Background → icons enter clustered at center → number counts up while icons expand outward → camera pushes in for closing emphasis.

This blueprint is the HyperFrames port of the Remotion `counting-icon-burst` choreography. Same four-phase opening-hook arc; one paused GSAP timeline; constituent patterns map to [svg-icon-enrichment](../rules/svg-icon-enrichment.md), [center-outward-expansion](../rules/center-outward-expansion.md), [counting-dynamic-scale](../rules/counting-dynamic-scale.md), and [multi-phase-camera](../rules/multi-phase-camera.md).

## When to Use

- Opening scene needs a single dramatic statistic as the hook
- The statistic is reinforced by thematic icons (clock, scissors, video, play...)
- Scene should feel kinetic from frame 1 — no static moments
- Total duration 3–5 seconds (any longer and the hook starts to feel like the main scene)

## Phase Pipeline

All boundaries are in **seconds** (at 30 fps; multiply by 30 to recover frames).

| Phase | Time window (s) | What Happens                                                 | Skill Reference                                                                                                                 |
| ----- | --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `0 – 0.17`      | Background visible with dark overlay; nothing else           | inline                                                                                                                          |
| 2     | `0.17 – 0.57`   | Icons enter staggered, clustered at `startOffset` (40 %)     | [svg-icon-enrichment](../rules/svg-icon-enrichment.md) entry pattern                                                            |
| 3     | `0.47 – 1.47`   | Counter counts up; icons expand from 40 % to 100 % position  | [counting-dynamic-scale](../rules/counting-dynamic-scale.md) + [center-outward-expansion](../rules/center-outward-expansion.md) |
| 4     | `0.50 – 3.50`   | Multi-phase camera: focus-in (0.5–2.33) then push (2.33–3.5) | [multi-phase-camera](../rules/multi-phase-camera.md)                                                                            |

Phase 2 and 3 overlap: icons keep entering through 0.57 s, while the counter starts at 0.47 s. The overlap is intentional — the eye sees motion continuously, no static gap.

## Layout

Counter is absolutely centered. Icons each have their target position set in CSS once; a GSAP `x` / `y` tween shifts them from the inverse-lerped startOffset position to target.

```html
<div class="stage">
  <div class="bg"></div>
  <!-- video / animated gradient -->

  <div class="camera">
    <!-- GSAP-managed scale phases -->

    <div class="icons-stage">
      <div class="icon-pos clock" style="left: 115px;  top: 195px;">
        <div class="icon-entry"><svg class="icon-svg">...</svg></div>
      </div>
      <div class="icon-pos scissors" style="left: 1632px; top: 216px;">
        <div class="icon-entry"><svg class="icon-svg">...</svg></div>
      </div>
      <div class="icon-pos video" style="left: 77px;   top: 734px;">
        <div class="icon-entry"><svg class="icon-svg">...</svg></div>
      </div>
      <div class="icon-pos play" style="left: 1690px; top: 702px;">
        <div class="icon-entry"><svg class="icon-svg">...</svg></div>
      </div>
    </div>

    <div class="counter-stage">
      <div class="counter-3d">
        <span class="counter-number">0</span><span class="counter-percent">%</span>
      </div>
    </div>
  </div>

  <div class="vignette"></div>
</div>
```

Each `.icon-pos`'s `left` / `top` are the **target** coordinates. GSAP `x` / `y` shift it back toward center. `.icon-entry` is a nested wrapper so the entry scale/opacity tweens don't overwrite the position tweens.

## Phase 2: Icon Entries

Each icon enters with its own spring (scale 0 → 1 + opacity 0 → 1 + rotation), staggered ~0.13 s each. Internal SVG animations (clock hand rotating, scissors oscillating, video record dot pulsing, play button pulsing) run **from time 0** — they're invisible during Phase 1 but already in motion when each icon appears.

```js
const ICON_DELAYS = { clock: 0.17, scissors: 0.3, video: 0.43, play: 0.57 };

Object.entries(ICON_DELAYS).forEach(([name, delay]) => {
  tl.fromTo(
    `.${name} .icon-entry`,
    { scale: 0, opacity: 0, rotation: -180 },
    { scale: 1, opacity: 0.85, rotation: 0, duration: 0.55, ease: "back.out(1.5)" },
    delay,
  );
});
```

See [svg-icon-enrichment](../rules/svg-icon-enrichment.md) for the full internal-motion patterns (linear rotation for clock hand, sine yoyo for scissors, etc.).

## Phase 3: Count + Expansion (Core Glue)

Single shared ease and duration drive both the counter and the icon expansion. Because GSAP tweens with identical `duration` + `ease` advance their progress in lockstep, the counter's display number and the icons' positions stay mathematically synchronized — no shared driver needed.

```js
const COUNT_AT = 0.47;
const COUNT_DUR = 1.0;
const START_OFFSET = 0.4;
const W = 1920,
  H = 1080,
  ICON_SIZE = 180;
const CENTER_X = W / 2 - ICON_SIZE / 2;
const CENTER_Y = H / 2 - ICON_SIZE / 2;

// (a) Counter — proxy tween. onUpdate writes text + font size to one element.
const counterEl = document.querySelector(".counter-number");
const counterProxy = { p: 0 };

tl.to(
  counterProxy,
  {
    p: 1,
    duration: COUNT_DUR,
    ease: "power2.out", // approximates Remotion's 1 - (1-x)^2.5
    onUpdate: () => {
      counterEl.textContent = Math.round(counterProxy.p * 90);
      counterEl.style.fontSize = W * (0.2 + counterProxy.p * 0.22) + "px";
    },
  },
  COUNT_AT,
);

// (b) Icons — per-icon tween to (x: 0, y: 0). gsap.set() positioned them at
// startOffset before the timeline; this tween moves them the rest of the way.
const ICONS = [
  { sel: ".clock", targetX: W * 0.06, targetY: H * 0.18 },
  { sel: ".scissors", targetX: W * 0.85, targetY: H * 0.2 },
  { sel: ".video", targetX: W * 0.04, targetY: H * 0.68 },
  { sel: ".play", targetX: W * 0.88, targetY: H * 0.65 },
];

ICONS.forEach(({ sel, targetX, targetY }) => {
  // Pre-position at startOffset
  gsap.set(`${sel}.icon-pos`, {
    x: (CENTER_X - targetX) * (1 - START_OFFSET),
    y: (CENTER_Y - targetY) * (1 - START_OFFSET),
  });

  // Expansion tween — same start, dur, ease as the counter
  tl.to(`${sel}.icon-pos`, { x: 0, y: 0, duration: COUNT_DUR, ease: "power2.out" }, COUNT_AT);
});
```

**Why a separate tween per icon instead of one onUpdate?** GSAP runs many simultaneous tweens cheaply — the compositor batches the transform writes. Separate tweens are easier to inspect in DevTools and don't share `onUpdate` overhead. For 4 icons that's 4 cheap tweens vs 1 onUpdate with 8 `gsap.set()` calls inside; perf is a wash, readability wins.

## Phase 4: Multi-Phase Camera

Wrapper `.camera` element scales through three values: `0.92` (initial) → `1.0` (focus settle) → `1.08` (closing push). The two transition tweens are sequenced at specific timeline positions; GSAP overwrite handles the merging on `scale`.

```js
gsap.set(".camera", { scale: 0.92 });

tl.to(".camera", { scale: 1.0, duration: 1.83, ease: "power2.out" }, 0.5);

tl.to(".camera", { scale: 1.08, duration: 1.17, ease: "power2.out" }, 2.33);
```

Each phase has lower stiffness than the previous in the Remotion source (50→40 stiffness). In GSAP we use the same `power2.out` ease for both — visually close enough. For a more pronounced cinematic decay, replace the second push with `power3.out`.

See [multi-phase-camera](../rules/multi-phase-camera.md) for the optional drift overlay (omitted here — drift is barely visible in a 3.5 s scene).

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Background renders immediately. Icons stay at start-offset positions
  (set via gsap.set before the timeline). No value dependency.

Phase 2 → Phase 3:
  Last icon enters at 0.57s. Count starts at 0.47s — slight overlap is
  intentional (no static gap). The last icon's entry tween finishes
  around 0.57 + 0.55 = 1.12s, before the count completes at 1.47s.

Phase 3 → Phase 4:
  Camera push triggers at 2.33s — well after count completes at 1.47s.
  The 0.86s gap gives the eye time to read the final number before the
  camera adds emphasis.

Continuous (Phase 1+):
  Internal SVG animations (clock hand, scissor angle, pulses) run from
  t=0 on a shared scene-ticker onUpdate. Icons enter visible at their
  delays but the internal motion has already been turning.
```

## Critical Constraints

- **Single progress source for count + expansion**: Same `COUNT_AT`, same `COUNT_DUR`, same `ease: "power2.out"` on the counter proxy and each icon's x/y tween. Drift in any of these breaks the synchronization.
- **`font-variant-numeric: tabular-nums`**: On the counter element — prevents layout shift as digit count changes (0 → 90 transitions 1-digit → 2-digit).
- **Icon entry completes before / overlapping count**: Icons should be visible (entry spring well underway) before the expansion they're attached to begins. With the timings above, all 4 icons have entered by 0.57 s and the expansion runs 0.47 – 1.47 s.
- **3–5 icons maximum**: More causes center clustering to read as a collision even with `START_OFFSET: 0.4`.
- **`START_OFFSET: 0.3 – 0.4`**: Icons begin partially spread. Starting at exact center looks like an explosion debris field.
- **Dark overlay on background**: Text and icons need contrast — `rgba(0,0,0, 0.6 – 0.7)` over a video / animated gradient.
- **`left` / `top` set once, never tweened**: Icon target positions in CSS or via `gsap.set()` before the timeline. GSAP only tweens `x` / `y` (transform aliases).
- **Two nested wrappers per icon**: `.icon-pos` (expansion x/y) wraps `.icon-entry` (scale/opacity/rotation). Their tweens never compete.
- **Internal SVG motion from t=0**: Don't gate enrichment behind icon entry. The user should see a living icon appear, not a static icon that starts moving on landing.
- **No `Math.random` / `Date.now`**: All motion pure functions of `tl.time()`.
- **No infinite repeats**: Camera, breathing, internal pulses — all use finite `repeat` counts computed from `data-duration`.
- **Single paused timeline**: All phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                           | This blueprint uses                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `spring({ stiffness: 200, damping: 16 })` — clock entry                 | `back.out(1.5)` over 0.55s                                                                  |
| `spring({ stiffness: 180, damping: 14 })` — scissors entry              | `back.out(1.5)`                                                                             |
| `spring({ stiffness: 100, damping: 16, mass: 1.1 })` — counter 3D entry | `power3.out` over 0.7s                                                                      |
| `spring({ stiffness: 50, damping: 20 })` — camera focus                 | `power2.out` over 1.83s                                                                     |
| `spring({ stiffness: 40, damping: 22 })` — camera push                  | `power2.out` over 1.17s                                                                     |
| `1 - (1-x)^2.5` — count + expansion ease                                | `power2.out` (close enough)                                                                 |
| `sin(t * speed) * amp` — internal SVG motion                            | `sine.inOut` yoyo (symmetric) or `onUpdate` with `Math.sin(tl.time() * speed)` (asymmetric) |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [hook-counter-burst.html](../examples/hook-counter-burst.html) — "90%" opening hook with four enriched SVG icons (clock with rotating minute hand, scissors oscillating ±15°, video frame with pulsing red record dot, play button with pulse scale). Single paused GSAP timeline drives all four phases over 3.5 seconds.
