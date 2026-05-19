# Section 10 — Particles and Ambient

Background/atmosphere scenes: light leaks, grain, particle drifts, glow pulses, radial gradients, ambient motion. The layer of motion that keeps a beat alive even when nothing in the foreground is changing.

**When to study this section:** any beat that needs continuous motion during holds, ambient mood, or a polished end-card / cold-open look.

---

## Scenes

| Scene | Duration | Technique | Why study |
|-------|----------|-----------|-----------|
| [`scene-01-radial-bloom-grid/`](scene-01-radial-bloom-grid/) | 3s | 15×25 grid of 375 dots. Three-phase timeline: (1) center-out bloom via `stagger: { from: "center" }` over 1.6s — concentric ring of dots illuminates outward, (2) cursor-sweep ripple elastic distortion across the lit grid, (3) explosion + blur exit. | Demonstrates GSAP stagger origins (`from: "center"`) in action with hundreds of elements. Frame 2 catches the bloom mid-disc — the textbook teaching moment for this technique. |
| [`scene-02-aurora-end-card/`](scene-02-aurora-end-card/) | 8s | Radial-gradient aurora background (4 color stops — violet/cyan/mint/magenta) blooming in. 12 floating particles with breathing motion. "MOTION STUDIO" wordmark with tri-color text gradient (white MOTION + violet→cyan→mint STUDIO via `background-clip: text`). Promise lines + install command typing in with blinking cursor. Breath accent dot. | The hero end-card template. Combines radial gradients, particle ambient motion, multi-color text gradient, mechanical typing, and cursor blink in one scene. Rebrandable for any product launch. |
| [`scene-03-scan-line-grid/`](scene-03-scan-line-grid/) | 5.6s | CRT-adjacent atmospheric ambient: three horizontal scan-line sweep passes across a faint dot-grid overlay + corner telemetry HUD (FPS / TICK / SEED readouts updating in mono). | The "tech surveillance / observability" mood pattern. Use as the background layer for any beat that wants a "we're watching the system" feel — telemetry, ops dashboards, AI-internal-monologue beats. Doesn't carry a beat alone — pair with foreground content. |

---

## QC log

- scene-01: **PASS** — 6 frames; frame 1 black, frame 2 central disc of dots lit (~7-cell radius), frame 3 nearly full grid, frames 4-5 cursor-sweep ripple, frame 6 explosion+blur exit. Lifted from `launch-video/compositions/flex-gsap.html` (152 lines); duration extended 0.69s → 3s and timeline restructured into 3 distinct phases for better snapshot coverage.
- scene-02: **PASS** — 7 frames; aurora blooms in → MOTION/STUDIO wordmark blur-reveal with tri-color gradient → 2 promise lines fade in → install pill appears → `npx create-motion-studio` types in with cursor → breath dot pulses. Lifted from `launch-video-2/compositions/act-4-end-card.html`. Rebranded: HyperFrames → MOTION STUDIO, npx skills add → npx create-motion-studio. Source local font files (Inter-Variable.woff2, JetBrainsMono-Variable.woff2) swapped to Google Fonts CDN. Source had no typing animation — added per-char spans with steps(1) stagger.
- scene-03: **PASS** — three timed scan-line passes; telemetry HUD updates via `tl.set()` at evenly-spaced timestamps (deterministic FPS / TICK / SEED readouts).
