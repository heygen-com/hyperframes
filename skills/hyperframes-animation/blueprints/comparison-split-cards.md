---
id: comparison-split-cards
role: comparison
duration_seconds: [4, 6]
phases: 3
visual_arc: title-entry → cards-split-enter → badges-attach
uses_rules: [split-tilt-cards, sine-wave-loop]
element_roles:
  title: Scene heading with accent keyword establishing the concept
  left_card: Left feature card with positive rotateY tilt (faces right)
  right_card: Right feature card with negative rotateY tilt (faces left)
  badges: Floating pill badges that attach near each card with supporting context
when_to_use:
  - Two complementary features shown side-by-side
  - Comparison or A/B presentation of related capabilities
  - Message is "X + Y together" (brand + team, speed + quality)
  - Need visual balance with 3D depth on both sides
when_not_to_use:
  - More than 2 items to compare (use a different layout)
  - Items are sequential, not parallel (use step indicators)
  - Cards contain interactive elements (use workflow-approve-press)
triggers: [two features, side by side, brand + team, comparison, dual capabilities, scale your]
---

# Comparison · Split Cards (HyperFrames)

Title drops in from top → two cards enter from opposite sides with opposing 3D tilts → floating pill badges attach near each card.

This blueprint is the HyperFrames port of the Remotion `split-comparison-reveal` choreography. Same three-phase "concept → dual proof" arc; one paused GSAP timeline; constituent patterns map to [split-tilt-cards](../rules/split-tilt-cards.md) and [sine-wave-loop](../rules/sine-wave-loop.md).

## When to Use

- Paired features or capabilities shown simultaneously
- Visual balance important — both features have equal weight
- 3D tilt creates a premium "book-open" depth effect
- Supporting context (badges, labels) attaches near each card

## Phase Pipeline

All boundaries are in **seconds**.

| Phase | Time window (s) | What Happens                                                         | Skill Reference                                     |
| ----- | --------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| 1     | `0.17 – 0.83`   | Title slides down from top with accent keyword                       | inline `power3.out` entry                           |
| 2     | `0.50 – 1.83`   | Left card enters from left, right from right; opposing 3D tilts      | [split-tilt-cards](../rules/split-tilt-cards.md)    |
| 3     | `1.67 – end`    | Pill badges pop in near each card with bouncy spring + floating idle | [sine-wave-loop](../rules/sine-wave-loop.md) Form 2 |

## Layout

Title is absolutely positioned near the top. Cards row is absolutely centered with a flex layout and gap between cards. Badges are absolutely positioned near the cards' inner edges. Ambient dual-glow + vignette overlay the scene.

```html
<div class="stage" style="position: absolute; inset: 0;">
  <div class="bg"></div>

  <!-- Title -->
  <div
    class="title"
    id="title"
    style="position: absolute; top: 60px;
       left: 50%; transform: translateX(-50%);"
  >
    Scale Your <span class="accent">Creative Output</span>
  </div>

  <!-- Cards row -->
  <div
    class="cards-row"
    style="position: absolute; top: 50%; left: 50%;
       transform: translate(-50%, -50%);
       display: flex; gap: 60px;
       padding-top: 40px;
       perspective: 1200px;"
  >
    <div class="card card-left">
      <div class="card-pos">
        <div class="card-tilt" style="transform-style: preserve-3d;">
          <div class="card-image"></div>
          <div class="card-label">Brand Templates</div>
          <div class="card-subtitle">Learn your brand's voice</div>
        </div>
      </div>
    </div>

    <div class="card card-right">
      <div class="card-pos">
        <div class="card-tilt" style="transform-style: preserve-3d;">
          <div class="card-image"></div>
          <div class="card-label">Team Workspace</div>
          <div class="card-subtitle">Collaboration on autopilot</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Floating badges -->
  <div
    class="badge badge-left"
    id="badge-left"
    style="position: absolute; left: 230px; top: 378px;"
  >
    <svg class="badge-icon">...</svg>
    <span>Brand Voice</span>
  </div>

  <div
    class="badge badge-right"
    id="badge-right"
    style="position: absolute; left: 1440px; top: 410px;"
  >
    <svg class="badge-icon">...</svg>
    <span>Team Autopilot</span>
  </div>

  <div class="ambient-glow"></div>
  <div class="vignette"></div>
</div>
```

## Phase 1: Title Slides Down

Standard entry: opacity 0 → 1, y rise from -40 to 0 (slide down from top). Use `power3.out` for a clean settle.

```js
const TITLE_AT = 0.17;
const TITLE_DUR = 0.67;

gsap.set("#title", { opacity: 0, y: -40 });

tl.to(
  "#title",
  {
    opacity: 1,
    y: 0,
    duration: TITLE_DUR,
    ease: "power3.out", // spring(stiffness:100, damping:16)
  },
  TITLE_AT,
);
```

## Phase 2: Split Tilt Cards (Core Pattern)

Two cards slide inward from their respective sides with `scale 0.8 → 1` + `opacity 0 → 1`. Static tilts: left `+18°`, right `-18°` rotationY. Continuous floating (y + tiny rotation) runs from t=0 with phase offset π between the two cards.

```js
const LEFT_AT = 0.5;
const RIGHT_AT = 0.83; // ~10-frame stagger
const ENTRY_DUR = 0.7;
const SLIDE_DIST = 100;
const BASE_TILT = 18;

/* Initial states */
gsap.set(".card-left  .card-pos", { x: -SLIDE_DIST, scale: 0.8, opacity: 0, y: 0 });
gsap.set(".card-right .card-pos", { x: SLIDE_DIST, scale: 0.8, opacity: 0, y: 0 });
gsap.set(".card-left  .card-tilt", { rotationY: BASE_TILT });
gsap.set(".card-right .card-tilt", { rotationY: -BASE_TILT });

/* Entry tweens */
tl.to(
  ".card-left .card-pos",
  { x: 0, scale: 1, opacity: 1, duration: ENTRY_DUR, ease: "power3.out" },
  LEFT_AT,
);
tl.to(
  ".card-right .card-pos",
  { x: 0, scale: 1, opacity: 1, duration: ENTRY_DUR, ease: "power3.out" },
  RIGHT_AT,
);
```

See [split-tilt-cards](../rules/split-tilt-cards.md) for the floating onUpdate that runs continuously over the whole composition. The `Math.PI` phase offset between left and right is what produces the "breathing in opposition" feel.

## Phase 3: Badge Attachment + Floating

Badges pop in with a bouncy spring (`back.out(1.7)`) near each card's inner edge. After entry, both badges float gently with a slow sine y-offset.

```js
const BADGE_LEFT_AT = 1.67;
const BADGE_RIGHT_AT = 2.0; // stagger
const BADGE_ENTRY_DUR = 0.5;

gsap.set(["#badge-left", "#badge-right"], { scale: 0, opacity: 0, y: 0 });

tl.to(
  "#badge-left",
  { scale: 1, opacity: 1, duration: BADGE_ENTRY_DUR, ease: "back.out(1.7)" },
  BADGE_LEFT_AT,
);

tl.to(
  "#badge-right",
  { scale: 1, opacity: 1, duration: BADGE_ENTRY_DUR, ease: "back.out(1.7)" },
  BADGE_RIGHT_AT,
);

/* Floating handled in shared scene-ticker onUpdate (next section). */
```

Badges should be **inside the cards' visual footprint**, not floating in empty viewport space. Position them at each card's inner edge (between the card and the gap), so the eye reads them as "attached to" their card rather than orbiting somewhere in the void.

## Shared Scene-Ticker (Continuous Floating)

A single `onUpdate` over the whole composition handles all continuous sine motion: card y/rotation float + badge y float. Consolidating keeps DOM-mutation cost predictable.

```js
const TOTAL_DUR = 5.0;
const FLOAT_Y_SPEED = 0.02 * 30; // = 0.6 rad/sec
const FLOAT_Y_AMP = 6;
const FLOAT_R_SPEED = 0.015 * 30; // = 0.45 rad/sec
const FLOAT_R_AMP = 1;
const BADGE_Y_SPEED = 0.025 * 30; // = 0.75 rad/sec
const BADGE_Y_AMP = 5;

const leftPos = document.querySelector(".card-left .card-pos");
const rightPos = document.querySelector(".card-right .card-pos");
const leftTilt = document.querySelector(".card-left .card-tilt");
const rightTilt = document.querySelector(".card-right .card-tilt");
const badgeLeft = document.querySelector("#badge-left");
const badgeRight = document.querySelector("#badge-right");

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL_DUR,
    ease: "none",
    onUpdate: function () {
      const t = tl.time();
      // Cards float in opposition (phase π apart).
      const lY = Math.sin(t * FLOAT_Y_SPEED) * FLOAT_Y_AMP;
      const lR = Math.sin(t * FLOAT_R_SPEED) * FLOAT_R_AMP;
      const rY = Math.sin(t * FLOAT_Y_SPEED + Math.PI) * FLOAT_Y_AMP;
      const rR = Math.sin(t * FLOAT_R_SPEED + Math.PI) * FLOAT_R_AMP;
      gsap.set(leftPos, { y: lY });
      gsap.set(rightPos, { y: rY });
      gsap.set(leftTilt, { rotationY: BASE_TILT + lR });
      gsap.set(rightTilt, { rotationY: -BASE_TILT + rR });

      // Badges — small shared y oscillation (both badges in same phase here;
      // can be opposed if you prefer extra differentiation).
      const bY = Math.sin(t * BADGE_Y_SPEED) * BADGE_Y_AMP;
      gsap.set(badgeLeft, { y: bY });
      gsap.set(badgeRight, { y: bY });
    },
  },
  0,
);
```

**Why one onUpdate and not three?** Six `gsap.set` calls inside one onUpdate is cheaper than three independent onUpdate tweens, which would each fire per frame. The browser batches transform writes across the calls.

## Ambient Dual-Glow

Two radial gradients in the background — one centered on each card's side, using different brand colors. Reinforces the left/right identity.

```css
.ambient-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.12;
  background:
    radial-gradient(ellipse at 30% 50%, rgba(180, 80, 220, 1) 0%, transparent 35%),
    radial-gradient(ellipse at 70% 50%, rgba(80, 220, 150, 1) 0%, transparent 35%);
}
```

The opacity (0.10–0.15) keeps the glow subtle — it tints the background without competing with the cards.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Title fade-in ends at ~0.83 s. LEFT_AT (0.50 s) starts BEFORE title fully
  settles — slight overlap is intentional. The eye reads the title's tail
  and the cards' beginnings as two simultaneous arrivals.

Phase 2 → Phase 3:
  Right card entry ends at RIGHT_AT + ENTRY_DUR = 1.53 s.
  BADGE_LEFT_AT (1.67 s) is ~0.15 s later — gives the cards a beat to settle
  visually before the badges punctuate them.

Continuous (Phase 1+):
  Scene-ticker onUpdate runs from t=0 across the whole 5 s. Card and badge
  floating values are 0 at t=0 (sin(0)=0), so the float is invisible during
  entry and gradually becomes visible as elements fade in.
```

## Critical Constraints

- **Opposing `rotationY`**: Left positive, right negative. Same-direction tilt destroys balance.
- **Shadow matches tilt**: Left card shadow falls right (`-x offset`), right card shadow falls left (`+x offset`). Mismatched shadow reveals the trick.
- **Equal card widths**: Both cards have the same `width`. Different sizes break symmetric balance.
- **Two cards only**: This pattern doesn't extend to 3+ cards. Use a different layout for three.
- **Badge position at inner edges**: Not floating in empty viewport space. The eye must read the badge as attached to its card.
- **Phase opposition on cards (`Math.PI`)**: For both y and rotation. Synchronized phase makes cards rock together — looks mechanical.
- **Single `perspective` parent** on the cards-row: Both cards share `perspective: 1200 px`. Per-card perspective produces inconsistent depth.
- **`transform-style: preserve-3d` on `.card-tilt`**: Required for the rotated card's children to render in 3D space.
- **Floating onUpdate isolates aliases**: Only sets `y` on `.card-pos` and `rotationY` on `.card-tilt`. Don't include `x` / `scale` / `opacity` — those are owned by the entry tween.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotationY`. Never `width` / `height` / `left` / `top`.
- **No `Math.random` / `Date.now`**: All motion is a pure function of `tl.time()`.
- **No infinite repeats**: The floating onUpdate runs over a finite `duration: TOTAL_DUR`. No `repeat: -1`.
- **Single paused timeline**: All three phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                      | This blueprint uses              |
| ------------------------------------------------------------------ | -------------------------------- |
| `spring({ stiffness: 100, damping: 16 })` — title + cards entry    | `power3.out` over 0.67-0.7 s     |
| `spring(...)` (entranceBouncy, ~stiffness:180 damping:14) — badges | `back.out(1.7)` over 0.5 s       |
| `sin(frame * 0.02)` — card y float (~10 s period)                  | `Math.sin(t * 0.6)` in onUpdate  |
| `sin(frame * 0.015)` — card rotation float (~14 s period)          | `Math.sin(t * 0.45)` in onUpdate |
| `sin(frame * 0.025)` — badge y float (~8.4 s period)               | `Math.sin(t * 0.75)` in onUpdate |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [comparison-split-cards.html](../examples/comparison-split-cards.html) — "Scale Your **Creative Output**" title, "Brand Templates" card (left, +18° tilt) and "Team Workspace" card (right, -18° tilt) with mock UI placeholders, "Brand Voice" and "Team Autopilot" pill badges at the cards' inner edges. Cards and badges float continuously with phase-opposed sines. Ambient dual-glow tints the background purple-left / green-right. Single paused GSAP timeline drives all three phases over 5 seconds.
