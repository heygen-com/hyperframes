# Section 02 — Markers and Emphasis

Hand-drawn-feeling marker effects that emphasize a key word in a phrase: highlight sweeps, hand-drawn circles, burst radials, scribble underlines, sketchout-X marks. The visual vocabulary that turns a generic statement into an annotated, intentional one.

**When to study this section:** any beat where one word in a phrase deserves to stand out from the rest. Also when you need editorial / annotated / hand-drawn aesthetic.

---

## Scenes

| Scene | Duration | Technique | Why study |
|-------|----------|-----------|-----------|
| [`scene-01-highlight-sweep/`](scene-01-highlight-sweep/) | 6s | Yellow translucent bar sweeps left-to-right behind a key word via `scaleX 0→1` with `transform-origin: left center` + `power4.out`. Second phrase swaps in a coral bar behind a different word. Warm paper background. | Marker pattern most associated with "this is important" — the highlighter metaphor. Both color and origin demonstrate the technique can vary per beat. |
| [`scene-02-hand-drawn-circle/`](scene-02-hand-drawn-circle/) | 6s | Slightly wonky SVG ellipse with `pathLength="2000"` + animated `stroke-dashoffset` (2000→0) draws around a key word. Two phrases with different circle colors prove the technique generalizes. | The "circle the answer" pattern. Note the linecap-artifact guard (40ms opacity fade-in before the stroke draws — otherwise round linecap leaves a dot). |
| [`scene-03-burst-radial/`](scene-03-burst-radial/) | 5s | 12 radial spike-lines burst outward from the center of a key word via `scaleX 0→1` with `transform-origin: 0 50%`, staggered 0.015s. Spikes fade after peak. Two bursts in different colors (yellow, cyan) on different words. | The "exclamation point" emphasis. Dark background, neon spikes. Demonstrates `back.out(2)` whip overshoot + `power1.out` mechanical fade. |
| [`scene-04-scribble-underline/`](scene-04-scribble-underline/) | 6s | Wavy SVG path (sine-wave shape via `Q…T…T…T…` quadratic bezier chain) drawn beneath a key word via stroke-dashoffset. Two scribbles in different colors. | The "underline it for emphasis" pattern. Uses `power2.inOut` for the mechanical hand-drawn pen pace. |
| [`scene-05-sketchout-x/`](scene-05-sketchout-x/) | 6s | Two diagonal SVG strokes drawn across a word forming an X, with slight per-line rotation for hand-drawn feel. Then word fades to gray + replacement phrase slides up from below (the "before / after" pattern). | The "cross out the wrong answer, present the right one" pattern. Useful for "stop doing X, start doing Y" beats. |
| [`scene-06-combined-marker-cascade/`](scene-06-combined-marker-cascade/) | 10s | One phrase with 5 emphasis words; each gets a different marker treatment in sequence: highlight sweep → hand-drawn circle → burst radial → scribble underline → sketchout X. All 5 markers visible simultaneously by the end. | The showcase scene that proves all 5 markers can layer in a single beat without visual conflict. Useful for "5-point thesis" or "5-feature recap" beats. |
| [`scene-07-magnetic-caption-webgl/`](scene-07-magnetic-caption-webgl/) | 6s | WebGL fragment-shader text caption with GLSL spatial distortion + RGB chromatic aberration that follows a scripted cursor position. Text "warps" and tears around the cursor like a magnetic field. | The premium VFX caption pattern. Use when a key headline needs to feel "alive" / dimensional — usually for hero beats or signature moments. Falls back gracefully when WebGL is unavailable. |

---

## QC log

- scene-01: **PASS** — 6 frames; yellow highlight on "builders" → coral on "intention". Two phrases, two colors, two key words. 6 distinct easings.
- scene-02: **PASS** — 6 frames; orange circle around "right" → coral around "clarity". Linecap-artifact guard applied. 7 distinct easings.
- scene-03: **PASS** — 5 frames; yellow burst on "changes" (frame 2 catches mid-burst), cyan burst on "just" (frame 4 catches mid-burst). 5 distinct easings.
- scene-04: **PASS** — 6 frames; red scribble under "handcrafted" → red scribble under "care". Sine-wave underline path. 5 distinct easings.
- scene-05: **PASS** — 6 frames; X drawn across "excuses" (word fades gray), then replacement "Start with action." slides up. 10 distinct easings.
- scene-06: **PASS** — 10 frames; all 5 markers cascade in correct sequence. Marker key visible top-right (5 colored swatches). Final frame shows all 5 markers simultaneously visible. Two-line phrase fitted into 1920px with per-line font sizing (78px / 64px). 7+ distinct easings.
- scene-07: **PASS** — lifted from team archive `magnetic-caption-webgl/`. GLSL distortion + chromatic aberration around scripted cursor; text remains legible while warping. Demonstrates how to keep WebGL effects deterministic under `tl.seek()` (cursor positions driven by timeline, not pointer events).
