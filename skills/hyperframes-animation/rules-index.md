# Rules Index

Atomic motion recipes. Each lives at `rules/<name>.md`. Compose 2-4 per scene with a single paused timeline.

## The contract — every rule assumes this

Stated once here so individual rules don't repeat it. Every recipe in `rules/`:

- runs on ONE **paused** GSAP timeline registered on `window.__timelines` (never autoplay, never a second timeline);
- is **seek-safe both directions**: `fromTo` with explicit from-states (t=0 correct under seek; `immediateRender: false` when re-owning a target), absolute values — never relative `+=` tweens; state readable as a pure function of timeline time, no mutable trackers;
- is **deterministic**: no `Math.random()`, no `Date.now()` — index-derived pseudo-random and baked schedules only; finite repeats, never `repeat: -1`;
- animates **transforms and paint-only properties** — `width`/`height`/`top`/`left` tweens are forbidden (use scale/translate proxies, masks, or `anchored-layout-expand`);
- caps group staggers so an arrival reads as one beat (`items × stagger ≤ ~0.5s`);
- puts **no CSS `transition`** on animated elements (they interpolate independently of seek and flicker) and hints compositors with `will-change: transform` where many tweens run at once;
- measures DOM (`offsetHeight`, `getBoundingClientRect`) at build time only in a **single-scene** composition — in a multi-scene montage, later clips may not be laid out yet: use authored CSS-matched constants;
- lives inside a standard scene clip per `hyperframes-core` (`class="clip"` + `data-*` timing) — rule snippets show mechanism DOM only, not the scene scaffold.

A rule's own **Critical Constraints** section lists only what is SPECIFIC to that rule beyond this contract.

## Text & Typography

<rules>
<hacker-flip-3d path="rules/hacker-flip-3d.md">Character-level 3D rotation with deterministic glyph substitution (decryption). GSAP `back.out` ease + per-glyph `onUpdate` for the flicker hash. Tags: text, 3d, reveal, decode</hacker-flip-3d>
<vertical-spring-ticker path="rules/vertical-spring-ticker.md">Slot-machine vertical scrolling using stepped GSAP tweens within a masked column. Tags: text, ticker, scroll, vertical</vertical-spring-ticker>
<counting-dynamic-scale path="rules/counting-dynamic-scale.md">Counter where transform scale grows with the value for escalating emphasis. A numeric proxy and scale tween share one timeline position. Tags: counter, scale, transform, number, dynamic</counting-dynamic-scale>
<discrete-text-sequence path="rules/discrete-text-sequence.md">Replace entire text states at time thresholds for non-linear typing (typos, holds, bulk additions, backspaces). GSAP onUpdate-driven reverse search. Tags: text, typing, discrete, threshold, non-linear</discrete-text-sequence>
<asr-keyword-glow path="rules/asr-keyword-glow.md">Highlight keywords with glow + scale + color synced to ASR word timestamps. Two GSAP tweens per word drive a CSS custom property `--glow` through attack-decay-rest envelope. Tags: asr, audio-sync, highlight, glow, keyword, text</asr-keyword-glow>
<3d-text-depth-layers path="rules/3d-text-depth-layers.md">Multiple offset text layers (N divs at `(i*dx, i*dy)` with decreasing alpha) create a stacked 3D extrusion illusion on large typography. Tags: text, 3d, depth, layers, shadow, typography, stacked</3d-text-depth-layers>
<context-sensitive-cursor path="rules/context-sensitive-cursor.md">Typing cursor whose `background-color` switches at segment boundaries plus square-wave blink via `(tl.time() % cycle) < cycle/2`. Tags: cursor, color, context, typewriter, styling, segment</context-sensitive-cursor>
<dynamic-content-sequencing path="rules/dynamic-content-sequencing.md">Pre-compute a flat `[{startTime, endTime, ...}]` array from a script of `{textMain, textAccent, charSpeed, hold}` entries. Each phrase's window = `chars × charSpeed + hold`. Content-driven duration, no hand-tuned offsets. Tags: timeline, sequencing, dynamic, duration, script-driven</dynamic-content-sequencing>
<kinetic-beat-slam path="rules/kinetic-beat-slam.md">Percussive kinetic typography — short phrases slam in on ONE shared beat array with DISTINCT per-phrase entrances (scale-slam / side-snap / rise-rotate), optional rhythm chrome (metronome ticks, beat bar), then a locked finale. The recipe for "punchy / rhythmic" taglines. Tags: text, kinetic, typography, beat, rhythm, slam, percussive, punchy</kinetic-beat-slam>
<gradient-text-sweep path="rules/gradient-text-sweep.md">A gradient tweened THROUGH letterforms — `background-clip: text` + an oversized-background `backgroundPosition` tween. Continuous sweep across a held headline, traveling word-to-word highlight (stacked-copy opacity envelopes), or a hue-sweep that settles to a solid via a pixel-identical twin crossfade. Glyphs never move; finite, seek-safe. Tags: gradient, text, sweep, background-clip, highlight, hue, headline</gradient-text-sweep>
<chromatic-glitch path="rules/chromatic-glitch.md">RGB-split / slice glitch that snaps sharp — offset color copies jitter on a deterministic hash of QUANTIZED timeline time (never Math.random), or horizontal slice bands displace and converge under a stepped ease; brief vibration, clean resolve, clamped rest state. Entrance stretch, emphasis burst, and slice-reveal forms. Tags: glitch, rgb-split, chromatic, slice, jitter, stutter, snap</chromatic-glitch>
</rules>

## Data & Stats

<rules>
<counting-dynamic-scale path="rules/counting-dynamic-scale.md">Counter whose transform scale grows with the value; seek-safe `onUpdate`, `Math.round`, `tabular-nums`, multi-stat chord. (Also listed under Text & Typography.) Tags: counter, number, stat, count-up</counting-dynamic-scale>
<stat-bars-and-fills path="rules/stat-bars-and-fills.md">Data-viz primitives that pair a number with a graphic — growth bars (CSS `scaleY` stagger), progress fill (bar `scaleX` or measured SVG ring), and fractional star-rating wipe (`clip-path`). Transforms only, seek-safe. Pick single-focus vs split-frame and hold it. Tags: data, stats, chart, bars, progress, ring, stars, rating, infographic</stat-bars-and-fills>
<chart-scrub-readout path="rules/chart-scrub-readout.md">Cursor/playhead scrubs an already-drawn chart — ONE driver moves a vertical tracking line + marker along a baked data polyline while a date/value tooltip steps through the data array (text writes only on index change); second series can activate on cross. Chart arrival belongs to `stat-bars-and-fills` / `svg-path-draw`; this is the read head. Tags: chart, scrub, tooltip, readout, tracking-line, data, playhead</chart-scrub-readout>
</rules>

## Camera & Viewport

<rules>
<coordinate-target-zoom path="rules/coordinate-target-zoom.md">Zoom into non-centered elements via scale (outer wrapper) + counter-translation (inner wrapper). Tags: camera, zoom, scale, translate</coordinate-target-zoom>
<camera-cursor-tracking path="rules/camera-cursor-tracking.md">Two-phase virtual camera that locks the viewport to a moving focal point (typing cursor) — static initial framing then focal-point-locked tracking. Uses browser-native `getBoundingClientRect()` / `ctx.measureText()` after `document.fonts.ready`. Tags: camera, tracking, viewport, two-phase, typing</camera-cursor-tracking>
<multi-phase-camera path="rules/multi-phase-camera.md">Sequential camera-zoom system (pull-back / focus / push) plus continuous micro-drift. Tags: camera, zoom, phase, drift, scale, cinematic</multi-phase-camera>
<viewport-change path="rules/viewport-change.md">Virtual camera — simulate zoom / pan / focus-lock by transforming a single `.world` wrapper containing all scene content. Single-element composite transform `translate(x,y) scale(S)`; counter-translate math is `T = -offset × S` (DIFFERENT from coordinate-target-zoom's `T = -offset`). Tags: viewport, camera, zoom, pan, focus-lock</viewport-change>
<3d-camera-flight path="rules/3d-camera-flight.md">Perspective camera FLIGHT through a 3D-laid-out world — one static `perspective` stage + `preserve-3d` `.world` whose pose (`translate3d` + `rotateX`/`rotateY`) is tweened leg-by-leg from a single camera state object: dive into an angled grid, tilt-to-flatten pull-back, flight past standing cards, decelerate-into-focus. `power4.out` landings, `power2.inOut` repositioning; DoF via depth-of-field-blur on non-focal planes. The only camera rule that rotates/travels in Z (the other three are 2D scale+translate). Tags: camera, 3d, flight, perspective, rotateX, translateZ, dive, tilt</3d-camera-flight>
<depth-of-field-blur path="rules/depth-of-field-blur.md">Selective rack-focus — GSAP-tween `filter: blur()` (+ slight opacity dim) on off-focus layers via a `--dof` var while the focal element stays sharp; single pull, two-plane rack, or blur-the-cluster-while-pushing-in. Finite, deterministic, seek-safe. Tags: blur, depth-of-field, focus, rack-focus, dim, spotlight</depth-of-field-blur>
</rules>

## Layout & Network

<rules>
<avatar-cloud-network path="rules/avatar-cloud-network.md">Avatars on an elliptical ring with SVG connection lines to a center point, staggered entry. Cloud center coordinates must match the centerpiece element exactly. Tags: avatar, cloud, network, social-proof, stagger</avatar-cloud-network>
<3d-page-scroll path="rules/3d-page-scroll.md">Full webpage rendered as a tilted 3D card whose internal content scrolls to reveal specific sections. Pair with asr-keyword-glow for on-page keyword highlighting. Tags: 3d, page, scroll, webpage, tilt, perspective, product-demo</3d-page-scroll>
<center-outward-expansion path="rules/center-outward-expansion.md">Elements start clustered at screen center and expand outward to final positions. Each element gets its target position via CSS once; GSAP tweens transform `x` / `y` offsets to 0 in lockstep with a shared driver. Tags: expansion, scatter, center, reveal, layout, sync</center-outward-expansion>
<split-tilt-cards path="rules/split-tilt-cards.md">Two cards side-by-side with opposing rotationY tilts (+/- baseTilt) and entry slides from their respective sides. Continuous floating runs in phase opposition (`Math.PI` offset). Tags: 3d, cards, split, tilt, comparison, symmetric</split-tilt-cards>
<orbit-3d-entry path="rules/orbit-3d-entry.md">Elements flip in from 3D space (`rotateX` + `rotateY` + `translateZ`) then settle into a continuous elliptical orbit. **Critical**: entry MUST flip in-place at the orbital starting position (`gsap.set` BEFORE phase 1), not at scene center. Tags: orbit, 3d, flip, ellipse, circular, icon, entry, continuous</orbit-3d-entry>
<ai-tracking-box path="rules/ai-tracking-box.md">AI detection overlay — yellow `#facc15` L-bracket corners + confidence label (fluctuating 95-99%) following a target on a sine arc path. Box position recomputed per-frame from target position (never tweened separately). Tags: ai, tracking, bounding-box, detection, corner, ml</ai-tracking-box>
<depth-scatter-assemble path="rules/depth-scatter-assemble.md">N elements scatter into / reassemble from a rotating 3D depth-cloud — each starts at a deterministic index-derived 3D offset (translateZ + rotateX/Y + scatter) and settles to a clean flat layout; tumble-swap and radial-explode variants. preserve-3d + perspective, transform-only, seek-safe. Tags: 3d, scatter, assemble, tumble, depth, perspective, glyphs</depth-scatter-assemble>
<anchored-layout-expand path="rules/anchored-layout-expand.md">Edge-pinned container grows/collapses along ONE axis and in-flow content reflows — pill springs open into a dropdown, panel grows a sub-task stack, input card steps taller as typed text wraps, pane expands over a neighbor. Transform-only (layout authored expanded; mask + sheet slide, or proxy-driven scaleY + inverse counter-scale) since width/height tweens are forbidden; the push on following content shares the SAME tween so the seam never separates. Tags: expand, collapse, anchored, dropdown, accordion, panel, reflow, push, mask, counter-scale</anchored-layout-expand>
</rules>

## SVG & Icons

<rules>
<svg-icon-enrichment path="rules/svg-icon-enrichment.md">Animate internal SVG elements (rotating hands, oscillating blades, pulsing dots, dash-flow lines) so icons feel alive. **Critical**: use SVG `setAttribute('transform', 'rotate(deg cx cy)')` for explicit center — CSS `transform-origin` + `transform-box: fill-box` interprets origin in bbox-local coords (off-center for thin lines). Tags: svg, icon, animation, micro-animation, rotation, pulse</svg-icon-enrichment>
<svg-path-draw path="rules/svg-path-draw.md">SVG outline draws itself stroke-by-stroke via `stroke-dasharray` / `stroke-dashoffset`. Measure with `getTotalLength()` at composition setup, set initial dashoffset = length, GSAP tweens to 0. For circular progress rings, rotate the stroke `-90deg` so drawing starts at 12 o'clock. Tags: svg, stroke, draw, vector, path, dasharray</svg-path-draw>
</rules>

## Idle & Ambient

<rules>
<sine-wave-loop path="rules/sine-wave-loop.md">Continuous breathing/idle ambient motion. Two forms: GSAP `sine.inOut` yoyo with finite repeats (preferred when standalone) or onUpdate reading `tl.time()` (preferred when multiplying onto another live value). Tags: idle, loop, breathing, sine, ambient</sine-wave-loop>
<ambient-glow-bloom path="rules/ambient-glow-bloom.md">Un-triggered soft radial glow that blooms in behind a hero element and holds with a bounded idle breathe, or a single-pass traveling sheen across a surface. No click, no word-sync; peak opacity ≤ ~0.45, finite/deterministic. Tags: glow, bloom, ambient, radial, sheen, hero</ambient-glow-bloom>
</rules>

## Transition & Motion

<rules>
<reactive-displacement path="rules/reactive-displacement.md">Physical-collision transition where an entering element's GSAP tween drives the exiting element's displacement. Three concurrent tweens at the same timeline position with victim durations 40-50% of the intruder's. Tags: transition, physics, collision, displacement, push</reactive-displacement>
<press-release-spring path="rules/press-release-spring.md">Tactile button press: linear compression then spring recovery via two adjacent GSAP tweens on the same property. Variations: color transition, shadow depth via CSS vars, release burst, background glow. Tags: spring, press, button, interaction, physics, glow, burst</press-release-spring>
<physics-press-reaction path="rules/physics-press-reaction.md">Physical click simulation — two sequential GSAP scale tweens (down to 0.9, up to 1.0) approximate a spring with overshoot. Pass a single targets array `["#cta", "#cursor"]` to compress both together for tactile contact feel. Tags: spring, click, physics, press, interaction, cursor</physics-press-reaction>
<cursor-click-ripple path="rules/cursor-click-ripple.md">Animated cursor moves to a target, depresses cursor + target together on click, emits an expanding ripple with attack-decay opacity envelope. Element lives in DOM from t=0 with `opacity: 0` (no conditional rendering). Tags: cursor, click, ripple, interaction, mouse, button, keyframes</cursor-click-ripple>
<cursor-drag path="rules/cursor-drag.md">The drag verb for driven cursors — grab (press dip + lift), travel (semi-transparent ghost rides the cursor in exact lockstep via matched tweens), drop-snap into a placed field with selection chrome. Variants: fill-handle auto-fill (linear travel + stepped `tl.set` cell reveals), corner-handle proportional resize (uniform scale, origin at the anchor corner — never width/height), grab-lift-reorder (tilt + shadow, neighbor springs into the vacated slot). Tags: cursor, drag, drop, ghost, handle, resize, reorder, snap, interaction</cursor-drag>
<multi-cursor-choreography path="rules/multi-cursor-choreography.md">N (2–4) labeled independent cursor actors work one canvas simultaneously — collaborative-canvas ambience. Per-actor deterministic waypoint tables (explicit fromTo legs + rests), name-tag pills in distinct colors, grab/drop/hover actions at chorus intensity on an interleaved beat grid (one payoff at a time, zone-partitioned paths, no collisions); camera locked — any pan is the canvas group translating. Tags: cursor, multi-cursor, collaboration, ensemble, canvas, name-tag, choreography, ambient</multi-cursor-choreography>
<control-target-sync path="rules/control-target-sync.md">Live-sync couple — a scrubbed/typed/picked control and its bound target change in the SAME beat: readout tween + target transform tween share one timeline label, duration, and ease (continuous scrub), or one threshold state array carries both sides (per-keystroke / dropdown-pick steps). Distinct from `reactive-displacement` (collision physics, one-shot transition). Tags: control, scrub, live-sync, mirror, panel, editor, readout, ui</control-target-sync>
<scale-swap-transition path="rules/scale-swap-transition.md">Coordinated morph between two DOM elements at the same screen center. Exit cluster shrinks + fades; entrance pops in with `back.out(2)` overshoot. Tags: transition, morph, scale, swap</scale-swap-transition>
<card-morph-anchor path="rules/card-morph-anchor.md">Container morphs apparent size + corner radius + surface treatment between two shots, then fades to reveal the real target underneath. HyperFrames substitutes uniform `scale` for the forbidden `width`/`height` tween, plus paint-only `borderRadius`/`background`/`boxShadow`. Tags: morph, anchor, transition, border-radius, container, shape, handoff</card-morph-anchor>
<theme-crossfade-morph path="rules/theme-crossfade-morph.md">Whole-theme in-place morph under a fixed anchor — background, typography, radii, icons, chrome and logos blend simultaneously (~0.3s) through N pre-styled skins while one anchor element never moves. Stacked complete layers + opacity-only crossfade, anchor rendered once on top (or per-layer at identical geometry); static camera. Single container instead → `card-morph-anchor`. Tags: theme, skin, crossfade, morph, anchor, reskin, cycle, ui</theme-crossfade-morph>
<spring-pop-entrance path="rules/spring-pop-entrance.md">The canonical ENTRANCE pop — an element (or staggered group) arrives by springing `scale: 0 → 1` with `back.out` overshoot, `fromTo` so it's correct at t=0 under seek. Single hero, staggered group (≤500ms cap), overshoot tuned by personality. Distinct from `press-release-spring` (a click/press reaction). Tags: spring, entrance, pop, scale-in, overshoot, stagger, arrival</spring-pop-entrance>
<motion-blur-streak path="rules/motion-blur-streak.md">Fake directional velocity blur on a fast entrance / camera push-through — blur peaks at max speed, resolves to 0 at the settle. Two paths: SVG `feGaussianBlur` stdDeviation on the motion axis (proxy-tweened), or a deterministic echo/ghost trail that collapses into the lead. Entrances / mid-shot only. Tags: motion-blur, streak, velocity, ghost, echo, fast</motion-blur-streak>
<waterfall-entry path="rules/waterfall-entry.md">Staggered ARRIVAL cascade — words/elements whip in from below, each starting before the previous settles, an accelerating wave that resolves composed. Title cards, segment openers, list intros. Binary 0→1 opacity via `tl.set` — never fade an arrival. Tags: entrance, cascade, stagger, kinetic-text, title-card, arrival, waterfall</waterfall-entry>
<particle-burst path="rules/particle-burst.md">Deterministic particle / confetti events — confetti pop that bursts up and drifts down on gravity (optional instant-shrink), dot burst from behind text, glyph dissolve to particles. Fixed pool, index-seeded launch values, one `ease: "none"` driver whose onUpdate computes each particle as a pure ballistic function of time — scrub-safe mid-flight, ≤ ~40 particles. Tags: particles, confetti, burst, dissolve, ballistic, deterministic, punctuation</particle-burst>
<nudge-curve path="rules/nudge-curve.md">Slow-fast-slow three-phase group slide (power3.in ramp → linear burst → power4.out tail, 10/65/25 distance, tail ≥3× ramp-in) to reposition a composed group and reveal content during the burst. Tags: slide, reposition, group-motion, nudge, slow-fast-slow</nudge-curve>
</rules>

## Effect Recipes (moved from hyperframes-creative)

<rules>
<gsap-effects path="rules/gsap-effects.md">Drop-in GSAP timeline patterns — typewriter, audio visualizer, and other reusable choreography blocks. Tags: gsap, recipe, drop-in, typewriter, audio-visualizer</gsap-effects>
<css-marker-patterns path="rules/css-marker-patterns.md">Pure CSS + GSAP implementations of marker-highlight drawing modes — highlight (yellow sweep), circle (hand-drawn ellipse), burst (radiating lines), scribble (chaotic), sketchout (rough rectangle outline). Tags: css, marker, highlight, text, emphasis</css-marker-patterns>
</rules>

## See Also

- `blueprints-index.md` — the scene-shape templates (this skill's "blueprints") that compose these rules into full shots
- `techniques.md` — broader motion-design techniques (SVG path drawing, Canvas 2D, CSS 3D, kinetic type, variable fonts, compositing); a few rules cite it
- `transitions/` — scene-transition catalog (shared skill; story owns `transition_in`, the harness injects it)
