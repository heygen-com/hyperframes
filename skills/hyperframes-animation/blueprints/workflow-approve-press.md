---
id: workflow-approve-press
role: workflow
duration_seconds: [4, 6]
phases: 4
visual_arc: headline-entry → steps-progress → video-demo → button-press-confirm
uses_rules: [press-release-spring]
element_roles:
  headline: Concept statement at the top (e.g., "AI edits WITH you")
  video_demo: Center product video / animation showing the feature
  step_indicators: Left-side 3D-tilted step list with active / complete states
  action_button: Right-side 3D-tilted button that receives the press and changes state
when_to_use:
  - Scene emphasizes user control over an automated process
  - Multi-step workflow needs visualization (generate → review → approve)
  - Button press is the narrative climax (user confirms / approves)
  - Left-right 3D symmetry flanks a center demo
when_not_to_use:
  - Workflow has more than 4 steps
  - No user-action metaphor needed (fully automated)
  - Scene is purely informational without interaction
triggers: [review and approve, step-by-step workflow, user control, approve button, AI with you]
---

# Workflow · Approve & Press (HyperFrames)

Headline enters top → center video/animation plays → 3D-tilted step indicators progress left → action button pressed right → state change confirms.

This blueprint is the HyperFrames port of the Remotion `interactive-workflow-showcase` choreography. The visual arc is identical; the implementation uses a single paused GSAP timeline driven by HyperFrames' seek loop instead of Remotion's frame-based render. State transitions that were derived per-frame in Remotion (`currentStep = sceneFrame < 60 ? 1 : …`) become discrete class toggles scheduled at concrete timeline positions, so seeking lands on a deterministic state every time.

## When to Use

- Feature scene that emphasizes user agency ("AI works with you, not just for you")
- The workflow is simple enough to show as 2-3 steps
- A button press serves as the narrative payoff

## Phase Pipeline

All boundaries are in **seconds**. Default values match the Remotion source choreography (~5.5s scene at 30fps); adjust per scene length.

| Phase | Time window (s)             | What Happens                                                                                             | Skill Reference                                          |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1     | `0 – HEADLINE_END`          | Headline slides down from top with accent keyword                                                        | inline `back.out` entry                                  |
| 2     | `VIDEO_START – ongoing`     | Center product video/animation enters with scale                                                         | inline scale-in                                          |
| 3     | `STEPS_START – PRESS_FRAME` | Step indicators enter staggered on the left, progress through active → complete states via class toggles | inline staggered entry + `tl.set()` state machine        |
| 4     | `PRESS_FRAME – end`         | Action button depresses (linear) → color shifts → checkmark pops (spring)                                | [press-release-spring](../rules/press-release-spring.md) |

## Layout: Three-Column with 3D Flanks

Center column holds the demo. Left and right columns are 3D-tilted inward (opposing `rotateY`), creating a "cockpit" depth effect. **Perspective lives on the flank element itself, not on a distant parent** — perspective from far up the tree distorts depth proportions.

```html
<div
  id="root"
  data-composition-id="interactive-workflow"
  data-start="0"
  data-duration="5.5"
  data-width="1920"
  data-height="1080"
  style="position: relative; width: 1920px; height: 1080px; overflow: hidden;"
>
  <!-- Frosted-glass / ambient background -->
  <div
    class="bg"
    style="position: absolute; inset: 0;
       background: radial-gradient(ellipse at center, #1a1530 0%, #0a0815 70%);"
  ></div>

  <!-- Top: Headline -->
  <div
    class="headline-wrap"
    style="position: absolute; top: 80px; left: 50%;
       transform: translateX(-50%) translateY(0px); opacity: 0; white-space: nowrap;
       text-align: center;"
  >
    <div class="headline" style="font-size: 96px; font-weight: 800; color: #fff; line-height: 1.2;">
      AI edits
      <span
        class="accent"
        style="color: #a78bfa;
            text-shadow: 0 0 30px rgba(167,139,250,0.6);"
        >WITH</span
      >
      you
    </div>
  </div>

  <!-- Center: Video / Animation Demo -->
  <div
    class="demo-wrap"
    style="position: absolute; left: 50%; top: 60%;
       transform: translate(-50%, -50%) scale(0.8); opacity: 0;"
  >
    <div
      class="demo-frame"
      style="border-radius: 16px; overflow: hidden;
         border: 2px solid rgba(255,255,255,0.1);
         box-shadow: 0 0 40px rgba(167,139,250,0.5), 0 20px 60px rgba(0,0,0,0.5);"
    >
      <video
        src="./assets/editor-demo.mp4"
        muted
        style="display: block; width: 1000px; height: 600px; object-fit: cover;"
      ></video>
    </div>
  </div>

  <!-- Left: Step Indicators (3D tilted) -->
  <div
    class="steps-flank"
    style="position: absolute; left: 100px; top: 55%;
       transform: translateY(-50%) perspective(800px) rotateY(15deg);
       display: flex; flex-direction: column; gap: 30px;"
  >
    <div
      class="step step-1"
      data-step="1"
      data-state="pending"
      style="display: flex; align-items: center; gap: 16px;
                opacity: 0; transform: translateX(-30px);"
    >
      <div class="step-circle">
        <span class="step-num">1</span>
        <svg
          class="step-check"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          style="display: none;"
        >
          <path d="M20 6L9 17L4 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </div>
      <span class="step-label">AI Generates Edits</span>
    </div>
    <div
      class="step step-2"
      data-step="2"
      data-state="pending"
      style="display: flex; align-items: center; gap: 16px;
                opacity: 0; transform: translateX(-30px);"
    >
      <div class="step-circle">
        <span class="step-num">2</span>
        <svg
          class="step-check"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          style="display: none;"
        >
          <path d="M20 6L9 17L4 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </div>
      <span class="step-label">Review Changes</span>
    </div>
    <div
      class="step step-3"
      data-step="3"
      data-state="pending"
      style="display: flex; align-items: center; gap: 16px;
                opacity: 0; transform: translateX(-30px);"
    >
      <div class="step-circle">
        <span class="step-num">3</span>
        <svg
          class="step-check"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          style="display: none;"
        >
          <path d="M20 6L9 17L4 12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" />
        </svg>
      </div>
      <span class="step-label">Approve &amp; Export</span>
    </div>
  </div>

  <!-- Right: Action Button (3D tilted, opposing direction) -->
  <div
    class="button-flank"
    style="position: absolute; right: 70px; top: 55%;
       transform: translateY(-50%) perspective(800px) rotateY(-15deg);"
  >
    <div class="btn-press" style="transform: scale(0); opacity: 0;">
      <!-- --btn-glow-blur is what the pulsing-yoyo tween mutates; box-shadow reads it. -->
      <div
        class="btn"
        style="--btn-glow-blur: 20px;
           padding: 20px 50px; border-radius: 12px;
           background-color: #a78bfa;
           box-shadow: 0 0 var(--btn-glow-blur) rgba(167,139,250,0.6);
           display: flex; align-items: center; justify-content: center; gap: 12px;
           color: #fff; font-size: 36px; font-weight: 700;"
      >
        <span class="btn-check" style="transform: scale(0); display: inline-flex;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 6L9 17L4 12"
              stroke="#fff"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="btn-label">Approve</span>
      </div>
    </div>
  </div>

  <!-- Ambient glow + vignette overlays -->
  <div
    class="ambient"
    style="position: absolute; inset: 0; pointer-events: none;
       background: radial-gradient(ellipse at 70% 50%, rgba(167,139,250,0.6) 0%, transparent 40%);
       opacity: 0.15;"
  ></div>
  <div
    class="vignette"
    style="position: absolute; inset: 0; pointer-events: none;
       background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%);"
  ></div>
</div>
```

**3D tilt values**: left flank `rotateY(+12° to +18°)`, right flank `rotateY(-12° to -18°)`. The Remotion source uses ±15°; opposing rotations create inward-facing symmetry.

## Timeline Construction

One paused timeline drives everything. Constants live at the top so phase boundaries are obvious and tweakable.

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

// ── Phase boundaries (seconds) ────────────────────────────────────
const HEADLINE_START = 0.17;
const HEADLINE_END = 0.72; // settle by here
const VIDEO_START = 0.5; // overlaps the tail of the headline entry
const STEPS_START = 0.67; // first step stagger-enters
const STEP_STAGGER = 0.5; // gap between consecutive step entries
const STEP_ACTIVE_T2 = 2.0; // step 1 → complete, step 2 → active
const STEP_ACTIVE_T3 = 3.33; // step 2 → complete, step 3 → active
const BUTTON_ENTER = 2.67;
const PRESS_FRAME = 3.67; // press starts
const PRESS_DURATION = 0.5; // depression length (~15f @30fps)
const CHECK_POP = PRESS_FRAME + PRESS_DURATION;

// ── Phase 1: Headline ─────────────────────────────────────────────
tl.fromTo(
  ".headline-wrap",
  { y: -40, opacity: 0 },
  { y: 0, opacity: 1, duration: HEADLINE_END - HEADLINE_START, ease: "back.out(1.2)" },
  HEADLINE_START,
);

// ── Phase 2: Center video / animation ─────────────────────────────
tl.to(".demo-wrap", { scale: 1, opacity: 1, duration: 0.6, ease: "power3.out" }, VIDEO_START);

// ── Phase 3a: Step stagger entry ──────────────────────────────────
tl.to(
  ".step",
  {
    x: 0,
    opacity: 1,
    duration: 0.4,
    ease: "power3.out",
    stagger: { each: STEP_STAGGER, from: "start" },
  },
  STEPS_START,
);

// ── Phase 3b: Step state machine (frame-driven in Remotion → tl.set() here) ──
// Steps start in their HTML-default "pending" state. The timeline only toggles
// the two state transitions; step state is *snap*, not animated.
tl.set(".step-1", { attr: { "data-state": "active" } }, STEPS_START);
tl.set(".step-1", { attr: { "data-state": "complete" } }, STEP_ACTIVE_T2);
tl.set(".step-2", { attr: { "data-state": "active" } }, STEP_ACTIVE_T2);
tl.set(".step-2", { attr: { "data-state": "complete" } }, STEP_ACTIVE_T3);
tl.set(".step-3", { attr: { "data-state": "active" } }, STEP_ACTIVE_T3);

// ── Phase 4a: Button entry (bouncy) ───────────────────────────────
tl.to(".btn-press", { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.4)" }, BUTTON_ENTER);

// ── Phase 4b: Press (linear depression → return) ──────────────────
tl.to(".btn-press", { scale: 0.95, duration: 0.1, ease: "power1.out" }, PRESS_FRAME);
tl.to(
  ".btn-press",
  { scale: 1.0, duration: PRESS_DURATION - 0.1, ease: "power1.in" },
  PRESS_FRAME + 0.1,
);

// ── Phase 4c: Color shift + label swap (snap at press end) ────────
tl.to(
  ".btn",
  {
    backgroundColor: "#22c55e",
    boxShadow: "0 0 25px rgba(34,197,94,0.6)",
    duration: 0.3,
    ease: "power2.out",
  },
  CHECK_POP,
);
tl.set(".btn-label", { textContent: "Approved!" }, CHECK_POP);

// ── Phase 4d: Checkmark pop (spring → back.out(1.6)) ──────────────
tl.to(".btn-check", { scale: 1, duration: 0.5, ease: "back.out(1.6)" }, CHECK_POP);

// ── Optional: pulsing glow on the button (Math.sin in Remotion) ───
// Finite yoyo replaces the continuous Math.sin(frame * 0.1) of the source.
// Remotion's frame*0.1 has angular freq 0.1 rad/frame → 6 rad/s @60fps
// (or 3 rad/s @30fps), giving period 2π/6 ≈ 1.05s (or 2.09s @30fps).
// boxShadow as a string is not GSAP-tweenable — drive a CSS custom property
// `--btn-glow-blur` that the button's `box-shadow` declaration interpolates.
const PULSE_PERIOD = 1.05; // seconds — full sine cycle
const PULSE_HALVES = Math.max(
  2,
  Math.floor(/* SCENE_END */ (5.5 - BUTTON_ENTER) / (PULSE_PERIOD / 2)),
);
tl.fromTo(
  ".btn",
  { "--btn-glow-blur": "10px" }, // source amplitude: 20 ± 10
  {
    "--btn-glow-blur": "30px",
    duration: PULSE_PERIOD / 2,
    ease: "sine.inOut",
    yoyo: true,
    repeat: PULSE_HALVES - 1,
  },
  BUTTON_ENTER,
);

window.__timelines["interactive-workflow"] = tl;
```

## Step Indicator States (CSS-driven)

Step state is a discrete attribute, never animated. The CSS below maps `[data-state]` to the visual treatment; the timeline only flips the attribute.

```css
.step .step-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #6b7280; /* pending muted */
  background-color: transparent;
  box-shadow: none;
}
.step .step-num {
  font-size: 18px;
  font-weight: 700;
  color: #6b7280;
}
.step .step-label {
  font-size: 24px;
  font-weight: 500;
  color: #9ca3af;
}

.step[data-state="active"] .step-circle {
  border-color: #a78bfa;
  box-shadow: 0 0 15px rgba(167, 139, 250, 0.6);
}
.step[data-state="active"] .step-num {
  color: #a78bfa;
}
.step[data-state="active"] .step-label {
  font-weight: 700;
  color: #fff;
}

.step[data-state="complete"] .step-circle {
  border-color: #22c55e;
  background-color: #22c55e;
}
.step[data-state="complete"] .step-num {
  display: none;
}
.step[data-state="complete"] .step-check {
  display: inline-flex;
}
```

| State        | Circle                     | Label           | Shadow     |
| ------------ | -------------------------- | --------------- | ---------- |
| **Pending**  | Number, muted border       | Muted text      | None       |
| **Active**   | Number, brand color border | Bold white text | Brand glow |
| **Complete** | Filled green + checkmark   | Normal text     | None       |

## Phase 4 Detail: Button Press Sequence (Core Glue)

The Remotion source splits the press into three frame-windowed branches inside a single render function. In HyperFrames, the same three sub-phases are **three GSAP tweens scheduled at concrete times on the shared timeline** — order and overlap come from positional arguments to `tl.to()`.

1. **Depression** (`PRESS_FRAME → PRESS_FRAME + 0.10`): linear `scale 1 → 0.95`. Linear, not spring — the "instant-feeling" 0.1s dip is intentionally non-bouncy.
2. **Return** (`PRESS_FRAME + 0.10 → CHECK_POP`): linear `scale 0.95 → 1`. Press and release are split because state continuity matters (end value of press = start value of return, exactly).
3. **Color shift + label swap** (at `CHECK_POP`): `backgroundColor` and `boxShadow` tween from primary to success in 0.3s. Label text snaps via `tl.set()` to avoid mid-tween typography flicker.
4. **Checkmark pop** (at `CHECK_POP`): SVG springs from `scale: 0 → 1` with `back.out(1.6)`, the GSAP analogue of the source's `spring({ stiffness: 200, damping: 15 })`.

The ambient pulsing glow uses a finite yoyo whose repeat count is computed from remaining scene duration — never `repeat: -1`, which is forbidden by the HyperFrames render contract.

For the full press-release pattern (including release burst, background glow, and shadow-depth variations), see [press-release-spring](../rules/press-release-spring.md).

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Headline settled before the demo dominates.
  VIDEO_START ≥ HEADLINE_END − 0.2s. A slight overlap (~0.05s) reads as natural flow,
  not as a hard cut.

Phase 2 → Phase 3:
  Demo visible before steps begin staggering in.
  STEPS_START ≥ VIDEO_START + 0.15s.

Phase 3 → Phase 4:
  All step states should resolve before the press is the focus.
  PRESS_FRAME ≥ STEP_ACTIVE_T3 + 0.30s.
  Button press is the scene's climax — it should be the last visual event.

Step state machine timing:
  Step N becomes "active" at STEP_ACTIVE_T(N), "complete" at STEP_ACTIVE_T(N+1).
  Final step (N=3) stays "active" until the button-press confirmation;
  there is no STEP_ACTIVE_T4 — the press itself is the implicit completion.
```

## Critical Constraints

- **3D tilt is perspective-anchored on the flank**: `perspective(800px)` belongs on the flank element directly, not on a distant parent. Perspective from far up the tree distorts depth proportions on the inner content.
- **Step state is snap-toggled, not animated**: steps jump to states via `tl.set({ attr: "data-state": "…" })`. Only the checkmark pop on `complete` animates, and that happens via CSS opacity/scale on the inner SVG — not via cross-fading the circle background.
- **Button depression is linear, not spring**: the 0.95 scale dip uses `power1.out`/`power1.in`, not `back.out`. The source explicitly notes "instant-feeling, not bouncy"; an elastic dip reads as squishy rather than tactile.
- **Press = two tweens, exact state continuity**: end value of the depression tween must equal the start value of the return tween (`scale: 0.95`). GSAP threads this automatically because both target the same property on the same element at sequential positions, but **never** start the return tween before the depression finishes.
- **Video must out-survive the press**: the center demo plays throughout the scene; it must be long enough (or looped via a sub-composition that itself doesn't end). The scene's `data-duration` is the upper bound on what the video has to cover.
- **2-3 steps maximum**: more than 3 steps cannot be read in a 5-second scene. Use a longer scene or split into two compositions if you genuinely need 4+ steps.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never tween `left`, `top`, `width`, `height` — they're forbidden by the HyperFrames animated-property allowlist and trigger layout reflows.
- **No infinite repeats**: the button glow pulse uses a finite `repeat` computed from remaining scene time, never `repeat: -1`.
- **Single paused timeline**: one `gsap.timeline({ paused: true })`, registered to `window.__timelines["interactive-workflow"]`. HyperFrames seeks it.
- **`data-duration` on the root** governs render length, not the GSAP timeline's intrinsic length.

## Remotion → HyperFrames Cheatsheet (scene-specific)

| Remotion concept (in source)                                        | HyperFrames equivalent (in this port)                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `useCurrentFrame()` + `currentStep = sceneFrame < 60 ? 1 : …`       | Discrete `tl.set({ attr: "data-state": … })` calls at concrete seconds                         |
| `spring({ frame, fps, config: SPRING_CONFIGS.entrance })`           | `gsap.to(…, { ease: "power3.out", duration: ~0.5 })`                                           |
| `spring({ … config: SPRING_CONFIGS.entranceBouncy })` (≈ 180/12)    | `ease: "back.out(1.4)"`                                                                        |
| `spring({ … config: { stiffness: 200, damping: 15 } })` (checkmark) | `ease: "back.out(1.6)"`                                                                        |
| `interpolate(progress, [0,0.3,1], [0,1,1])` (fade-in with hold)     | `fromTo({ opacity: 0 }, { opacity: 1, duration: …, ease: "power2.out" })`                      |
| `<OffthreadVideo src={staticFile("…mp4")} />`                       | `<video src="./assets/editor-demo.mp4" muted>`                                                 |
| `<AbsoluteFill>`                                                    | `<div style="position: absolute; inset: 0;">`                                                  |
| `transition: "transform 0.1s ease-out"` on press                    | Two sequential `gsap.to` tweens (depression + return)                                          |
| `Math.sin(frame * 0.1) * 10` glow pulse                             | Finite yoyo tween with repeat count derived from remaining time                                |
| `isPressing = frame >= pressDelay && frame < pressDelay + 15`       | Two adjacent tweens at `PRESS_FRAME` and `PRESS_FRAME + 0.10`                                  |
| `showCheck = frame > pressDelay + 15` (boolean branch)              | `tl.set(".btn-label", { textContent: "Approved!" })` at `CHECK_POP` + spring on `.btn-check`   |
| React `ReviewStep` component with props                             | Three `.step` DOM nodes with `data-step` / `data-state` attributes; CSS does the state styling |
| Frame-windowed `isActive` / `isComplete` per render                 | Scheduled `tl.set()` toggles on the timeline                                                   |

## Golden Sample

- [workflow-approve-press.html](../examples/workflow-approve-press.html) — "AI edits WITH you" headline, editor demo center, 3 review steps on left (3D-tilted +15°), Approve button on right (3D-tilted -15°) depresses linearly → color shifts to green → checkmark pops with `back.out(1.6)`. Demonstrates the "tactile but not bouncy" press variant, step state machine via `tl.set({ attr: data-state })`, and a finite-yoyo pulsing glow via CSS variable. Single paused GSAP timeline drives all four phases over 5.5 seconds.
