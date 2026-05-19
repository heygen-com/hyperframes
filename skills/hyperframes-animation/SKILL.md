---
name: hyperframes-animation
description: Promo-video scene blueprints and atomic animation rules for HyperFrames. Use when authoring multi-phase brand-reveal, social-proof, product-demo or comparison scenes; or when a specific effect like hacker-flip text, avatar-cloud, vertical ticker, or coordinate-target zoom is requested. HyperFrames-native — single paused GSAP timeline, seek-safe, deterministic.
---

# HyperFrames Animation

Scene-level choreographies (**blueprints**) and self-contained motion recipes (**rules**) for HyperFrames promo videos. Ported from the Remotion `promo-animation-skills` skill — same visual semantics, restructured around HyperFrames' seek-driven render model:

- One paused GSAP timeline per composition, registered to `window.__timelines[data-composition-id]`
- All timing in **seconds** (not frames); `data-start` / `data-duration` carry phase windows
- Only deterministic state — no `Math.random()`, no `Date.now()`, no infinite repeats
- GSAP transform aliases (`x`, `y`, `scale`, `rotation`); never tween layout properties

For the broader HyperFrames composition contract see `hyperframes-core`. For GSAP-specific reference (eases, transform aliases, the animated-property allowlist) see `hyperframes-gsap`.

## When to Use

- Building a promo video and you want a complete multi-phase scene structure → start with a **blueprint**
- You need a specific motion technique (decode text, ticker, avatar cloud, etc.) → use a **rule**
- You're porting Remotion examples into HyperFrames — every rule includes a Remotion-→-HyperFrames mapping section

## Scene Blueprints

Each blueprint describes a complete multi-phase choreography with phase pipeline, glue code, and a working sample composition.

<blueprints>
<blueprint
  id="proof-logo-chain"
  path="blueprints/proof-logo-chain.md"
  role="social-proof"
  duration="6-10s"
  phases="5"
  uses="hacker-flip-3d, vertical-spring-ticker, coordinate-target-zoom, avatar-cloud-network"
  triggers="brand reveal, social proof, #1 tool, million users, trusted by">
  Logo threads through 5 phases: hacker-flip text → text swap → logo centers → avatar cloud + counter → partner brand logos.
</blueprint>
<blueprint
  id="concept-demo-decode-pan"
  path="blueprints/concept-demo-decode-pan.md"
  role="concept-demo"
  duration="6-10s"
  phases="4"
  uses="hacker-flip-3d, camera-cursor-tracking, discrete-text-sequence"
  triggers="decode effect, scene transition, search bar typing, show then demonstrate">
  Shot 1 hacker-flip decode → horizontal camera pan with parallax → Shot 2 cursor-tracked typing.
</blueprint>
<blueprint
  id="brand-reveal-assemble-zoom"
  path="blueprints/brand-reveal-assemble-zoom.md"
  role="brand-reveal"
  duration="4-6s"
  phases="5"
  uses="discrete-text-sequence, coordinate-target-zoom, sine-wave-loop"
  triggers="brand reveal, zoom into logo, hero focus, wide to close-up">
  Companion text assembles beside hero → companion exits + recenters → camera zooms into hero → hero breathes.
</blueprint>
<blueprint
  id="takeover-ticker-displace"
  path="blueprints/takeover-ticker-displace.md"
  role="takeover"
  duration="5-8s"
  phases="4"
  uses="vertical-spring-ticker, reactive-displacement, sine-wave-loop"
  triggers="rolling text then logo, push text away, slot machine, logo enters forcefully">
  Typewriter + ticker build context → hero enters from off-screen and physically pushes the text out → hero breathes.
</blueprint>
<blueprint
  id="demo-page-scroll-spotlight"
  path="blueprints/demo-page-scroll-spotlight.md"
  role="demo"
  duration="5-9s"
  phases="4"
  uses="3d-page-scroll, asr-keyword-glow"
  triggers="show the feature, product demo, webpage in 3D, scroll to feature">
  3D-tilted webpage card → scrolls to feature section → keywords glow synced to ASR → key element pops forward in 3D with a radial spotlight.
</blueprint>
<blueprint
  id="hook-counter-burst"
  path="blueprints/hook-counter-burst.md"
  role="opening-hook"
  duration="3-5s"
  phases="4"
  uses="counting-dynamic-scale, center-outward-expansion, multi-phase-camera, svg-icon-enrichment"
  triggers="opening hook, statistic, counter, dramatic number">
  Counter grows + enriched SVG icons expand outward from center, wrapped in multi-phase camera.
</blueprint>
<blueprint
  id="workflow-approve-press"
  path="blueprints/workflow-approve-press.md"
  role="workflow"
  duration="4-6s"
  phases="4"
  uses="press-release-spring"
  triggers="review and approve, step-by-step workflow, user control, approve button, AI with you">
  Headline top + center video demo + 3D-tilted step indicators left + action button right that presses to confirm.
</blueprint>
<blueprint
  id="problem-mockup-overwhelm"
  path="blueprints/problem-mockup-overwhelm.md"
  role="problem"
  duration="4-6s"
  phases="4"
  uses="card-morph-anchor"
  triggers="too many platforms, overwhelmed creator, complex workflow, surrounded by tasks">
  Mockups appear → platform icons scatter → center mockup scales down + crossfades into avatar → task bubbles surround.
</blueprint>
<blueprint
  id="cta-orbit-collapse"
  path="blueprints/cta-orbit-collapse.md"
  role="cta"
  duration="5-8s"
  phases="5"
  uses="orbit-3d-entry, cursor-click-ripple, center-outward-expansion, sine-wave-loop"
  triggers="works for any genre, multiple categories, click to generate, versatile tool">
  Category icons enter with 3D flip and orbit a center CTA → cursor clicks → icons collapse inward → product demo springs out and floats.
</blueprint>
<blueprint
  id="cta-morph-press"
  path="blueprints/cta-morph-press.md"
  role="cta"
  duration="4-6s"
  phases="4"
  uses="sine-wave-loop, scale-swap-transition, physics-press-reaction"
  triggers="logo morphs into button, CTA animation, cursor clicks button, brand to action">
  Hero enters and breathes → morphs into CTA via scale-swap → cursor enters via spring path → physics-based click compresses cursor + CTA together.
</blueprint>
<blueprint
  id="comparison-split-cards"
  path="blueprints/comparison-split-cards.md"
  role="comparison"
  duration="4-6s"
  phases="3"
  uses="split-tilt-cards, sine-wave-loop"
  triggers="two features, side by side, brand + team, dual capabilities, scale your">
  Title slides down → two feature cards enter from opposite sides with opposing 3D tilts (+12° / -12°) → floating pill badges attach to each card's inner edge.
</blueprint>
<blueprint
  id="metric-video-text-pivot"
  path="blueprints/metric-video-text-pivot.md"
  role="metric"
  duration="5-8s"
  phases="4"
  uses="3d-text-depth-layers, sine-wave-loop"
  triggers="accuracy rate, engagement increase, show feature then stat, big number reveal, metric emphasis">
  Product video centered + floating → video slides left and giant stat (3D depth layers) appears right → both exit and kinetic text types center-screen with accent keywords → gradient pill scales behind a closing phrase.
</blueprint>
<blueprint
  id="messaging-multi-phrase"
  path="blueprints/messaging-multi-phrase.md"
  role="messaging"
  duration="7-8s"
  phases="3"
  uses="dynamic-content-sequencing, context-sensitive-cursor"
  triggers="multiple phrases typing, sequential statements, typing with highlight, dual-color text">
  Multiple phrases type sequentially in hard cuts; each phrase has main + accent segments with a context-sensitive cursor whose color switches at the segment boundary. Timeline computed from `chars × charSpeed + hold`.
</blueprint>
</blueprints>

> All Remotion blueprints have been migrated.

## Atomic Rules

Use when you need a specific effect detail, or when no blueprint matches your task.

### Text & Typography

<rules>
<hacker-flip-3d path="rules/hacker-flip-3d.md">Character-level 3D rotation with deterministic glyph substitution (decryption). GSAP `back.out` ease + per-glyph `onUpdate` for the flicker hash. Tags: text, 3d, reveal, decode</hacker-flip-3d>
<vertical-spring-ticker path="rules/vertical-spring-ticker.md">Slot-machine vertical scrolling using stepped GSAP tweens within a masked column. Tags: text, ticker, scroll, vertical</vertical-spring-ticker>
<counting-dynamic-scale path="rules/counting-dynamic-scale.md">Counter where font size grows with the value for escalating emphasis. Single GSAP tween on a numeric proxy. Tags: counter, scale, font-size, number, dynamic</counting-dynamic-scale>
<discrete-text-sequence path="rules/discrete-text-sequence.md">Replace entire text states at time thresholds for non-linear typing (typos, holds, bulk additions, backspaces). GSAP onUpdate-driven reverse search. Tags: text, typing, discrete, threshold, non-linear</discrete-text-sequence>
<asr-keyword-glow path="rules/asr-keyword-glow.md">Highlight keywords with glow + scale + color synced to ASR word timestamps. Two GSAP tweens per word drive a CSS custom property `--glow` through attack-decay-rest envelope; all visual effects derive from the variable via `calc()`. Tags: asr, audio-sync, highlight, glow, keyword, text, speech, css-vars</asr-keyword-glow>
<3d-text-depth-layers path="rules/3d-text-depth-layers.md">Multiple offset text layers (N divs at `(i*dx, i*dy)` with decreasing alpha) create a stacked 3D extrusion illusion on large typography. JS builds the layer stack once at composition setup with `document.createElement`; GSAP tweens the parent container for entry/breath. Tags: text, 3d, depth, layers, shadow, typography, stacked</3d-text-depth-layers>
<context-sensitive-cursor path="rules/context-sensitive-cursor.md">Typing cursor whose `background-color` switches at segment boundaries (white during main, accent during highlight) plus square-wave blink via `(tl.time() % cycle) < cycle/2`. Character slicing, color switching, and blink all fold into one master `onUpdate` reading `tl.time()`. Tags: cursor, color, context, typewriter, styling, segment</context-sensitive-cursor>
<dynamic-content-sequencing path="rules/dynamic-content-sequencing.md">Pre-compute a flat `[{startTime, endTime, ...}]` array from a script of `{textMain, textAccent, charSpeed, hold}` entries. Each phrase's window = `chars × charSpeed + hold`. Master `onUpdate` finds the active entry from `tl.time()` and passes `activeT = tl.time() - phrase.startTime` to the renderer. Content-driven duration, no hand-tuned offsets. Tags: timeline, sequencing, dynamic, duration, script-driven, content-aware</dynamic-content-sequencing>
</rules>

### Camera & Viewport

<rules>
<coordinate-target-zoom path="rules/coordinate-target-zoom.md">Zoom into non-centered elements via scale (outer wrapper) + counter-translation (inner wrapper). Tags: camera, zoom, scale, translate</coordinate-target-zoom>
<camera-cursor-tracking path="rules/camera-cursor-tracking.md">Two-phase virtual camera that locks the viewport to a moving focal point (typing cursor) — static initial framing then focal-point-locked tracking. Uses browser-native `getBoundingClientRect()` / `ctx.measureText()` after `document.fonts.ready`, never `charWidthRatio`. Tags: camera, tracking, viewport, two-phase, typing</camera-cursor-tracking>
<multi-phase-camera path="rules/multi-phase-camera.md">Sequential camera-zoom system (pull-back / focus / push) plus continuous micro-drift. Expressed as a sequence of GSAP scale tweens on a single wrapper plus a finite yoyo or `onUpdate` for the drift. Tags: camera, zoom, phase, drift, scale, cinematic</multi-phase-camera>
<viewport-change path="rules/viewport-change.md">Virtual camera — simulate zoom / pan / focus-lock by transforming a single `.world` wrapper containing all scene content. Single-element composite transform `translate(x,y) scale(S)`; counter-translate math is `T = -offset × S` (note: DIFFERENT from coordinate-target-zoom's nested-wrapper formula `T = -offset`, easy to confuse). Background on `.scene` not `.world`; `overflow: hidden` REQUIRED. Tags: viewport, camera, zoom, pan, focus-lock, virtual-camera</viewport-change>
</rules>

### Layout & Network

<rules>
<avatar-cloud-network path="rules/avatar-cloud-network.md">Avatars on an elliptical ring with SVG connection lines to a center point, staggered entry. Cloud center coordinates must match the centerpiece element exactly. Tags: avatar, cloud, network, social-proof, stagger</avatar-cloud-network>
<3d-page-scroll path="rules/3d-page-scroll.md">Full webpage rendered as a tilted 3D card whose internal content scrolls to reveal specific sections. Tilt is static CSS; GSAP tweens the scroll-content's `y`. Pair with asr-keyword-glow for on-page keyword highlighting. Tags: 3d, page, scroll, webpage, tilt, perspective, product-demo</3d-page-scroll>
<center-outward-expansion path="rules/center-outward-expansion.md">Elements start clustered at screen center and expand outward to final positions. Each element gets its target position via CSS once; GSAP tweens transform `x` / `y` offsets to 0 in lockstep with a shared driver (e.g. counter). Tags: expansion, scatter, center, reveal, layout, sync</center-outward-expansion>
<split-tilt-cards path="rules/split-tilt-cards.md">Two cards side-by-side with opposing rotationY tilts (+/- baseTilt) and entry slides from their respective sides. Continuous floating runs in phase opposition (`Math.PI` offset) for organic breathing. Two nested wrappers per card isolate entry from float aliases. Tags: 3d, cards, split, tilt, comparison, symmetric, layout</split-tilt-cards>
<orbit-3d-entry path="rules/orbit-3d-entry.md">Elements flip in from 3D space (`rotateX` + `rotateY` + `translateZ`) then settle into a continuous elliptical orbit around a focal point. **Critical**: entry MUST flip in-place at the orbital starting position (`gsap.set(el, {x: cos*R, y: sin*R, opacity:0})` BEFORE phase 1), not at scene center — otherwise items teleport visibly when phase 2 begins. Center label needs `translateZ(220px) + z-index 9999` to stay above orbiting items inside `preserve-3d` stage. Tags: orbit, 3d, flip, ellipse, circular, icon, entry, continuous</orbit-3d-entry>
<ai-tracking-box path="rules/ai-tracking-box.md">AI detection overlay — yellow `#facc15` L-bracket corners + confidence label (fluctuating 95-99%) following a target on a sine arc path. Box position recomputed per-frame from target position (never tweened separately). Sine-driven label confidence is deterministic. Lost-then-reacquired variant: box chases for 40% of escape window then freezes + opacity drops to 30% + "LOST" label, then snaps to new position with "REACQUIRED · 99%". Tags: ai, tracking, bounding-box, detection, corner, yellow, ml</ai-tracking-box>
</rules>

### SVG & Icons

<rules>
<svg-icon-enrichment path="rules/svg-icon-enrichment.md">Animate internal SVG elements (rotating hands, oscillating blades, pulsing dots, dash-flow lines) so icons feel alive. Per-element GSAP yoyo / linear tween, or a shared scene-ticker `onUpdate` for many sine motions consolidated. **Critical**: use SVG `setAttribute('transform', 'rotate(deg cx cy)')` for explicit center — CSS `transform-origin` + `transform-box: fill-box` interprets origin in bbox-local coords (off-center for thin lines), causes hands to fly around an arc. Tags: svg, icon, animation, internal, micro-animation, rotation, pulse</svg-icon-enrichment>
<svg-path-draw path="rules/svg-path-draw.md">SVG outline draws itself stroke-by-stroke via `stroke-dasharray` / `stroke-dashoffset`. Measure with `getTotalLength()` at composition setup, set initial dashoffset = length, GSAP tweens to 0. For circular progress rings, rotate the stroke `-90deg` around the circle center so drawing starts at 12 o'clock. Tags: svg, stroke, draw, vector, path, dasharray</svg-path-draw>
</rules>

### Idle & Ambient

<rules>
<sine-wave-loop path="rules/sine-wave-loop.md">Continuous breathing/idle ambient motion. Two forms: GSAP `sine.inOut` yoyo with finite repeats (preferred when standalone) or onUpdate reading `tl.time()` (preferred when multiplying onto another live value, e.g. a pop scale). Tags: idle, loop, breathing, sine, ambient</sine-wave-loop>
</rules>

### Transition & Motion

<rules>
<reactive-displacement path="rules/reactive-displacement.md">Physical-collision transition where an entering element's GSAP tween drives the exiting element's displacement. Three concurrent tweens at the same timeline position with victim durations 40-50% of the intruder's. Tags: transition, physics, collision, displacement, push</reactive-displacement>
<press-release-spring path="rules/press-release-spring.md">Tactile button press: linear compression then spring recovery via two adjacent GSAP tweens on the same property. Variations: color transition, shadow depth via CSS vars, release burst (radial glow keyframes), background glow. Replaces Remotion's frame-windowed if/else with timeline-sequential tweens. Tags: spring, press, button, interaction, physics, glow, burst</press-release-spring>
<physics-press-reaction path="rules/physics-press-reaction.md">Physical click simulation — two sequential GSAP scale tweens (down to 0.9, up to 1.0) replace the Remotion subtractive-spring formula. Pass a single targets array `["#cta", "#cursor"]` to compress both together for tactile contact feel. Tags: spring, click, physics, press, interaction, cursor</physics-press-reaction>
<cursor-click-ripple path="rules/cursor-click-ripple.md">Animated cursor moves to a target, depresses cursor + target together on click, emits an expanding ripple with attack-decay opacity envelope. Element lives in DOM from t=0 with `opacity: 0` (no conditional rendering); single GSAP `keyframes` tween gives the `0 → peak → 0` opacity arc in one declaration. Tags: cursor, click, ripple, interaction, mouse, button, keyframes</cursor-click-ripple>
<scale-swap-transition path="rules/scale-swap-transition.md">Coordinated morph between two DOM elements at the same screen center. Exit cluster shrinks + fades the outgoing (fade ~30% of shrink dur); entrance pops in with `back.out(2)` overshoot. Z-index on incoming hides exit residue. Tags: transition, morph, scale, swap</scale-swap-transition>
<card-morph-anchor path="rules/card-morph-anchor.md">Container morphs apparent size + corner radius + surface treatment between two shots, then fades to reveal the real target underneath. HyperFrames substitutes uniform `scale` for the forbidden `width`/`height` tween, plus paint-only `borderRadius`/`background`/`boxShadow`. Eye-tracking anchor between shots. Tags: morph, anchor, transition, border-radius, container, shape, handoff</card-morph-anchor>
</rules>

> All Remotion source rules have been migrated and eval-verified (Wenbo 2026-05-19 — 27 rules / 9 cells each via 3-way v1 Remotion / v2 HF-with-rule / v3 HF-base-only comparison).

## Examples

<examples>
<example
  id="proof-logo-chain"
  path="examples/proof-logo-chain.html"
  blueprint="proof-logo-chain"
  duration="8s">
  Full Authority scene — hacker-flip 'HyperFrames' → 'HTML Video' lockup with rolling `render / ship` ticker → logo recenters → '60 FPS' static label with scale-pulse + avatar cloud + SVG connection lines → partner brand-logo strip. Single paused GSAP timeline drives all five phases.
</example>
<example
  id="concept-demo-decode-pan"
  path="examples/concept-demo-decode-pan.html"
  blueprint="concept-demo-decode-pan"
  duration="7s">
  'Spark your next campaign' hacker-flip decode in Shot 1 → horizontal pan with parallax exit → 'Tell me how to target parents' cursor-tracked typing in Shot 2 search bar. Demonstrates browser-native text measurement (no charWidthRatio) and piecewise Math.min camera tracking.
</example>
<example
  id="brand-reveal-assemble-zoom"
  path="examples/brand-reveal-assemble-zoom.html"
  blueprint="brand-reveal-assemble-zoom"
  duration="5s">
  'Just ask' discrete-assembly companion beside 'GWISpark' + pink star logo → companion slides out and container recenters → camera zooms 5.5× into the star → star breathes (sine onUpdate, multiplicative). Demonstrates three nested transform layers (scale → translate → recenter) and brandTextWidth measurement after fonts.ready.
</example>
<example
  id="takeover-ticker-displace"
  path="examples/takeover-ticker-displace.html"
  blueprint="takeover-ticker-displace"
  duration="7.5s">
  'Ask about any' typewriter + 'audience → topic → market' ticker → pink-magenta logo enters from offscreen-right with rotation+scale impact → text pushed left and fades (40-50% of hero duration) → logo breathes with dual-frequency sine (1.0s scale, 1.33s rotation). Demonstrates reactive-displacement causal link and multiplicative breathing on a non-1 final scale.
</example>
<example
  id="demo-page-scroll-spotlight"
  path="examples/demo-page-scroll-spotlight.html"
  blueprint="demo-page-scroll-spotlight"
  duration="9s">
  OpusClip landing page recreated as a 3D-tilted card with navbar, hero title, CTA row, and video carousel. Six title keywords ('1 long video, 10 viral clips') glow synced to ASR timestamps via CSS `--glow` variable + per-word two-tween envelopes. Page scrolls down 280 px to reveal the carousel; main video pops forward 80 px in 3D with a radial spotlight dimming surroundings.
</example>
<example
  id="hook-counter-burst"
  path="examples/hook-counter-burst.html"
  blueprint="hook-counter-burst"
  duration="3.5s">
  Counter "0 → 90 %" with dynamic font scaling (0.20W → 0.42W), four enriched SVG icons (clock with linearly rotating minute hand, scissors oscillating ±15°, video frame with phase-offset pulsing red dot, play button with scale pulse) expanding outward from center, multi-phase camera (0.92 → 1.0 → 1.08). Demonstrates shared-ease lockstep sync between counter and icon expansion + a single scene-ticker onUpdate consolidating all internal SVG motion.
</example>
<example
  id="cta-morph-press"
  path="examples/cta-morph-press.html"
  blueprint="cta-morph-press"
  duration="5.5s">
  "GWI Spark" lockup with breathing-rotated star logo → morphs into a pink "Find out more" CTA pill via scale-swap (hero shrinks + fades, CTA pops with back.out(2)) → cursor hard-cuts in at off-screen bottom-right and approaches via spring path → physics-based click compresses both cursor and CTA together using a single GSAP target array. Demonstrates conditional-render-free morph via permanent DOM + opacity tweens, hard-cut cursor opacity via 0.001s fromTo, and synchronized press via shared tween targets.
</example>
<example
  id="workflow-approve-press"
  path="examples/workflow-approve-press.html"
  blueprint="workflow-approve-press"
  duration="5.5s">
  "AI edits WITH you" headline slides down → center editor mockup scales in (CSS-mockup fallback when ./assets/editor-demo.mp4 is missing) → 3 review steps stagger-enter on the left flank (3D-tilted +15°) and snap through pending → active → complete states via `tl.set({ attr: data-state })` → Approve button (3D-tilted -15°) bouncy entry with finite-yoyo glow pulse on `--btn-glow-blur` → linear depression then linear return (no overshoot per the "tactile not bouncy" rule) → backgroundColor crossfades to success green + label swaps via `tl.set({ textContent })` + checkmark pops with back.out(1.6). Demonstrates the discrete state machine replacement for Remotion's `currentStep = sceneFrame < 60 ? 1 : …` frame-conditional logic.
</example>
<example
  id="problem-mockup-overwhelm"
  path="examples/problem-mockup-overwhelm.html"
  blueprint="problem-mockup-overwhelm"
  duration="6s">
  Three video-platform mockups (YouTube Studio left, TikTok Creator center, Instagram Reels right) spring-in with back.out(1.4) → nine scattered platform icons stagger-enter with back.out(1.6) → at 3.20s the center mockup morphs via uniform `scale: 1 → 0.6875` (replaces Remotion's forbidden width/height tween) + paint-only `borderRadius: 28 → 110px` + `background` gradient swap + `boxShadow` glow ramp, all driven by power3.out tweens at the same timeline position → at 85% of morph the mockup container fades to 0 revealing a cyan-teal-blue avatar circle rendered underneath at z-index 20 (the "hand-off" trick) → 8 task bubbles ("Edit hours of raw footage", "Reframe for vertical", …) stagger-enter in a radial pattern around the avatar with back.out(1.4) → idle phase: shared scene-ticker onUpdate drives mockup floating (gated to pre-morph), orbit-dot cycling, avatar breath (multiplicative on pop scale), and bubble micro-float. Demonstrates `card-morph-anchor` hand-off, conditional-render-free DOM with opacity gating, and replacement of all `Math.sin(frame * ...)` continuous motion with a single shared onUpdate scene-ticker reading `tl.time()`.
</example>
<example
  id="comparison-split-cards"
  path="examples/comparison-split-cards.html"
  blueprint="comparison-split-cards"
  duration="5s">
  Title slides down → left card (+18° rotateY, shadow falls right) and right card (-18° rotateY, shadow falls left) enter from their sides with `power3.out` over 0.7s (right staggers ~0.33s after left) → pill badges pop in at the cards' inner edges with `back.out(1.7)`. Continuous floating consolidated in one scene-ticker onUpdate: cards y ±6px / rotation ±1° with `Math.PI` phase offset between left and right (opposed breathing); badges shared y ±5px. Ambient dual-glow tints background.
</example>
<example
  id="messaging-multi-phrase"
  path="examples/messaging-multi-phrase.html"
  blueprint="messaging-multi-phrase"
  duration="7.5s">
  "Build video with **HTML**" → "Seek **any frame**" → "Render to **MP4**" typed sequentially on black at 150 px. Three phrases in `SCRIPT`, timeline computed from `chars × 0.083s + hold`. One master `onUpdate` writes `textContent` to `.phrase-main` + `.phrase-accent`, switches cursor `background-color` between white and cyan (`#32FFF6`) at each phrase's main → accent boundary, and drives a 1.0s square-wave blink via `(tl.time() % 1.0) < 0.5`. Holds: 1.0s, 1.0s, 2.0s (longer closing beat). Natural TOTAL ≈ 7.98s; `data-duration="7.5"` clips the final hold. Cached `lastIdx` pointer with bidirectional fallback makes the linear scan seek-safe under preview scrubbing.
</example>
<example
  id="cta-orbit-collapse"
  path="examples/cta-orbit-collapse.html"
  blueprint="cta-orbit-collapse"
  duration="6.5s">
  Six genre icons (Music, Gaming, Education, Sports, Vlogs, Podcast) enter staggered with 3D flip (`rotateX:90 → 0`, `back.out(1.4)`) and orbit a central "Drop a video link · Get free clips" CTA at 0.25 rad/s. Three nested wrappers per icon (`.icon-pos` orbit x/y, `.icon-collapse` scale/opacity, `.icon-entry` 3D flip) separate concerns so the master `onUpdate` writing orbit + collapse never collides with the per-icon entry `fromTo`. Cursor enters off-screen-right, slides to the white button via `back.out(1.3)`, depresses cursor (0.85) + button (0.95) + boxShadow glow + single white ripple via GSAP `keyframes` (`scale: 0.3 → 5.0`, `opacity: 0 → 0.7 → 0`). Icons collapse via `gsap.parseEase("back.out(1.6)")` called inside the onUpdate (radiusFactor 1→0, two-segment opacity envelope 1→0.5→0). Demo card springs out from the collapse point with `back.out(1.6)`, CTA + cursor fade out concurrently, demo floats with finite-yoyo breathing (±8 px, ±1°). Internal SVG enrichment (note bounce, button pulse, book sway, ball spin, record blink, podcast waves) on a separate shared scene-ticker.
</example>
<example
  id="metric-video-text-pivot"
  path="examples/metric-video-text-pivot.html"
  blueprint="metric-video-text-pivot"
  duration="6.5s">
  "Hyper**Frames**" badge top; mock captioned video card centered (3D-tilted +15° rotateY, slow float ±6px) → at 2.20s video slides to 29% W and "MP4" appears on right as a 5-layer green depth stack (built with `document.createElement`) with `back.out(1.6)` entry + breathing → at 3.86s both video and stat exit left (`x: -W*0.5 / -W*0.7`, scale 0.8), kinetic text typing-stage fades in center → 23-char line 1 "HTML **pages** become **video**" + 15-char line 2 "frame by frame." type char-by-char at 30 ch/s with accent-green segments (static CSS `.accent` color, not ASR glow envelope) → gradient pill (purple → green) scales in behind line 2 (`scaleX 0→1`, `scaleY 0.5→1`) with radial glow halo. Three nested wrappers per moving element (`.pos / .float-or-breath / .tilt`) isolate concerns. Cursor blink derived from `Math.floor(t * 2) % 2` with color swap (green on accent segments).
</example>
</examples>

## Remotion → HyperFrames Quick Reference

| Remotion                                                     | HyperFrames                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `useCurrentFrame()`                                          | `tl.time()` inside an `onUpdate` callback only                          |
| `useVideoConfig().fps / width / height`                      | Constants matching `data-width` / `data-height` on the composition root |
| `spring({ frame, fps, config })`                             | GSAP tween with a matching ease: see mapping table below                |
| `interpolate(frame, [a,b], [x,y], { extrapolate: 'clamp' })` | `gsap.to(el, { value: y, duration: (b-a)/fps, ease: '…' })`             |
| `<AbsoluteFill>`                                             | `<div style="position: absolute; inset: 0;">`                           |
| `<Img src={staticFile("foo.png")}>`                          | `<img src="./assets/foo.png">`                                          |
| Inline JSX component                                         | HTML element (generated by JS where dynamic)                            |
| `random(seed)`                                               | Pure-int hash: `((i * 374761393 + t * 668265263) >>> 0)`                |
| `frame * 0.003` continuous drift                             | Finite `yoyo` tween with computed `repeat:`                             |

### Spring → GSAP ease mapping

| Remotion `spring({ stiffness, damping })` | GSAP ease                          |
| ----------------------------------------- | ---------------------------------- |
| 180, 12 (bouncy)                          | `back.out(1.4)`                    |
| 150, 14 (snappy)                          | `back.out(1.6)` or `back.out(1.7)` |
| 120, 14 (stepped, mild overshoot)         | `back.out(1.4)`                    |
| 100, 18 (calm settle)                     | `back.out(1.2)` or `power3.out`    |
| 80, 18 (firm)                             | `power3.out`                       |
| 80, 20                                    | `power2.out`                       |
| 45, 22 (gentle, slow)                     | `power2.out`                       |

These are approximations — visually indistinguishable for 0.4–0.8s tween ranges. For physically exact springs, use `gsap.registerPlugin(CustomEase)` and fit a Bezier curve to the spring response.

## Critical Constraints (apply to every blueprint and rule)

- **Single paused timeline per composition** — registered to `window.__timelines["composition-id"]`.
- **`data-duration` on the root** governs render length, not the GSAP timeline's intrinsic length.
- **Pre-calculated layout constants** — never derive positions from `getBoundingClientRect()` at tween time.
- **GSAP transform aliases only** (`x`, `y`, `scale`, `rotation`) — `width` / `height` / `left` / `top` are forbidden.
- **No infinite repeats** — `repeat: -1` is forbidden; compute finite repeats from `data-duration`.
- **No nondeterministic state** — no `Math.random()`, no `Date.now()`, no `performance.now()`, no network fetches. State must be a pure function of `tl.time()`.

## See Also

- `hyperframes-core` — composition structure, data attributes, clips, sub-compositions, deterministic render contract
- `hyperframes-gsap` — GSAP API reference scoped to HyperFrames (eases, allowlist, transform aliases)
- `hyperframes-cli` — `npx hyperframes lint / validate / inspect / preview / render`
- `hyperframes-creative` — design.md handling, palettes, visual styles, motion principles
