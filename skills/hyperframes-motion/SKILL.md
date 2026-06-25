---
name: hyperframes-motion
description: "Design, see, and debug GSAP motion as data in a HyperFrames composition — to a professional (10/10) standard. Run `npx hyperframes motion` to surface every tween's keyframes, then `--shot` to render a true-3D onion-skin of the real element, so you reason about an element's MOTION over time — add/move/remove keyframes, refine a path, trace a shape (logo / glyph / icon), tune a 3D flip/tumble, debug 'why does it move there', reproduce a reference, or critique an animation like a motion designer (spacing, weight, easing, pivots, choreography) before editing. Supports multi-stroke traces (pen-up gaps) for shapes with holes or detached parts. Use whenever the task is about where/when/how something moves or whether motion reads as professional; for authoring new scenes from scratch see hyperframes-animation, for the dev-loop CLI see hyperframes-cli."
---

# HyperFrames Motion

Editing motion by reading `keyframes: [{x:0},{x:-260}]` in source is guessing — the numbers don't show the _shape_, the timing, or what rotation/scale/3D actually look like. `npx hyperframes motion` surfaces every GSAP tween and its keyframes (with absolute times) as editable data; then `--shot` renders a **true-3D onion-skin of the real element** so you verify the motion by eye — all before you render.

This is **read-then-edit-source**, not a mutation command — it never changes files. Pair it with `inspect` (layout over the timeline) and `render` to ship. For the composition contract (the single paused timeline, `data-duration`, determinism) see `hyperframes-core`; to author motion from scratch see `hyperframes-animation`.

The goal isn't "the keyframes are correct" — it's **motion indistinguishable from a professional motion designer's.** That takes a trained eye (what to look at) and a diagnostic habit (how to catch what's wrong). The two sections below — **Think like a motion designer** and **The diagnostic pass** — plus **`references/motion-craft.md`** (the depth: easing values, durations, the amateur-tell catalog, the pivot fix, the 10/10 gate) are how you get there.

## Think like a motion designer (the eye)

Motion communicates **physics and intent**. Every choice reads either as "a real thing with mass moved for a reason" or as "a value was linearly interpolated." The high-leverage rules (full values + sources in `references/motion-craft.md`):

- **Spacing ≠ timing.** Timing is the duration; spacing is how the value is distributed across it (the easing). On the curve, **slope = velocity**. **Even spacing reads robotic** (only machines hold constant velocity); **varied spacing reads alive.** In the onion-shot, evenly-spaced ghosts = linear = wrong unless a steady spin/conveyor is literally the subject.
- **Easing has a job.** ease-**out** for entrances (decelerate to rest — the UI default), ease-**in** for permanent exits, ease-**in-out** for on-screen moves. **Asymmetric easing = weight; symmetric = zero-gravity float (the #1 amateur tell).** `linear`/`none` only for a literal constant-velocity subject.
- **Give it weight.** Floaty is the top tell — fix with asymmetric easing, a decisive landing (cluster frames at the end), and a duration matched to size (a tiny element over 600ms always floats; target 150–250ms). Heavy → strong decel (`power3/expo.out`), little overshoot; light/playful → small overshoot (`back.out`).
- **Anticipation + follow-through.** A big move (>~200ms) earns a tiny counter-move before it; motion shouldn't stop dead — overshoot 5–15% then settle.
- **Choreograph one focal point.** Never ≥3 unrelated elements moving at once. Parent leads, children follow; stagger ≈15% of duration; one secondary motion per primary, not three.
- **Restraint.** Every animated property must orient, give feedback, or express — else cut it. **Match the reference/brief's channels exactly**; invented channels read as _wrong_, not richer.

## The loop

1. **Surface** — `npx hyperframes motion [dir|file]` (defaults to `./index.html` + sub-compositions).
2. **Read** the keyframe list against your intent (add `--json` for exact data).
3. **Edit** the `keyframes` / property values in the composition `<script>`.
4. **Verify** — `motion --shot out.png` renders the motion; check it by eye, then `inspect` / `render`.

**Stop condition (don't thrash).** Iterate until faithful and another edit wouldn't clearly help — usually **≤5 rounds, never more than ~8** (a 40-run grid showed quality flat past ~5; extra rounds just over-edit). Tracing a known target? Keep it in view and re-check each round. Past ~5 with no clear gain, **stop and ask the user**.

**Formula shortcut.** If the shape has a known parametric form (heart, ∞/lemniscate, star, spiral, circle), author it directly from the formula and verify **once** — don't iterate. The loop's value is for non-formula shapes (objects, glyphs, words, icons) where you can't compute the points.

## Internal eval improvement loop

When dogfooding this skill against internal evals, keep the eval suite, artifacts, juror packets, score sheets, and hidden references **outside the repo/PR**. The PR should update only the skill guidance and its normal references.

Use a versioned loop:

1. Run baseline vs current skill on the same prompts, model, budget, tools, and references.
2. Judge blind paired outputs with the rendered MP4, frame strip, `motion --json`, and `motion --shot` evidence.
3. Extract failure patterns, not prompt-specific answers: what channel was missing, what motion read wrong, what evidence would have caught it, what GSAP/3D construction rule should change.
4. Patch the skill with only the generalized diagnostic or construction rule.
5. Run the next eval version and keep only changes that improve several prompts or fix a recurring class of miss.

Promotion rule: a lesson belongs in the skill only if it is reusable across prompts or explains a high-severity failure mode. Do not paste hidden prompt details, judge labels, target logos, one-off coordinates, or benchmark tricks into the skill. Write the lesson as **tell → fix → verify** so future agents can apply it to new motion, not just replay an eval answer.

**Renderable timeline contract.** A scored/rendered composition has one source of time: the paused seekable timeline HyperFrames drives. Do not include `requestAnimationFrame`, elapsed-time preview loops, timers, or pseudo timelines that keep animating during render. Register the real timeline under `window.__timelines[compositionId]` and expose consistent `duration`, `time`, `seek`, and `progress` semantics; previews can wrap the same seek surface, but they must not fight it.

**The render path binds the timeline by `data-composition-id` — this is the #1 "looks fine, ships broken" trap.** The snapshot/render runtime resolves the root's `data-composition-id` and seeks `window.__timelines[<that exact id>]`; if the `.clip` root has no `data-composition-id`, or the timeline is registered under a different key (e.g. the loose `window.__timelines = { main: tl }`), the render binds **nothing** and emits the static build-time DOM **frozen at `t=0`**. Critically, `--shot` seeks `window.__timelines` directly so it renders the motion **fine** — the two paths **disagree silently**, and source/`--shot` looking correct does not mean the real render works. So: put `data-composition-id="<id>"` on the `.clip` root and register the timeline under that **exact id** — `window.__timelines["<id>"] = tl` (or `window.__timelines = { "<id>": tl }`); the key must equal the root's `data-composition-id`, or the render binds nothing. Confirm with the real render/`validate`/`snapshot` path, not only `--shot`.

**`onUpdate` / `modifiers` ARE seek-safe here — but only if pure.** The engine renders each frame with `timeline.totalTime(t, false)` (verify in `packages/core/src/runtime/adapters/gsap.ts`: it nudges `+0.001` with events suppressed, then seeks to `t` with **`suppressEvents: false`**). So GSAP `onUpdate` and `modifiers:{}` callbacks **do fire on seek** — per-frame DOM writes they drive (morphing an SVG `d` / `points`, a `textContent` count-up, a path-follower) update correctly. The common GSAP folklore that _"onUpdate doesn't run when you seek"_ does **not** apply to HyperFrames; do not avoid the technique on that basis. The real requirement: the callback must be a **pure, idempotent function of the timeline's current value/progress** — recompute from the tween value every call; never accumulate, read a frame delta, or touch wall-clock — because the engine nudges then re-renders and seeks arrive at arbitrary, repeated, out-of-order times. `modifiers:{}` is naturally pure and is the safest default; reserve `onUpdate` for writes that aren't a single tweened property. (What still freezes under seek: `requestAnimationFrame` / elapsed-time loops, timers, and anything not on the registered paused timeline.) **Verify by seeking** the paused timeline backward and forward at several times in real headless Chrome and asserting the rendered attribute/text actually changed and is identical across back-and-forth seeks — a Node-only geometry self-check proves the math is right, not that the engine ever calls it.

Three corollaries that bite repeatedly: (1) **Drive followers from global time, not construction order.** A path-follower, a count-up, or a derived value must be a pure closed-form function of `tl.time()` (in one master `onUpdate`) — never `parseFloat(el.style.…)` of another tween's rendered output, and never tied to one child tween's local progress; those resolve differently under arbitrary seek order. (2) **Own `t=0` explicitly.** `fromTo`/`from` immediate-render their _from_-state at **build** time, so after construction the DOM sits on the last-built tween's start, not the composition's `t=0`; give every animated element a timeline-resident zero state (a `set()`/tween at position 0) so seeking back to 0 reproduces frame 1 exactly. (3) **Animate values through a real channel,** not a discrete `textContent`/`set()` swap with no tween — a stepped value with no animated channel has nothing for the engine to interpolate on seek.

```bash
npx hyperframes motion                      # whole project
npx hyperframes motion --selector '#hero'   # one element
npx hyperframes motion compositions/s2.html # one composition file
npx hyperframes motion --json               # machine-readable (agents)
npx hyperframes motion --shot path.png      # onion-skin screenshot (3D, all channels)
```

**The shot is ground truth.** Numbers say what you wrote; `--shot <png>` shows what it does. It seeks the **live timeline** at N steps and renders the **real element** at each — true-3D ghosts (foreshortened/edge-on for rotationX/Y/Z + z, sized by scale, filled with its colour, faded by opacity; path coloured by time, ghost spacing = velocity). It reads what actually rendered, so it catches eased / dynamic / 3D motion the numbers hide. Works on **any** animated element (`--selector '.clip'` falls back to sampling the root's animated descendants). Author → `--shot` → open the PNG → check against your target, before render.

**`--shot` is ground truth for an element's MOTION (path, transform, 3D pose) — not for painted structure.** It onion-skins one element's bounding box, so it cannot show masked-type letterforms entering, an SVG metaball/goo merge, multi-face cube shading, exploded-layer legibility, or multi-card flythrough composition — for those it draws abstract marker boxes that look broken even when the piece is fine. For structural / multi-element / filter-painted mechanisms, verify with **`npx hyperframes snapshot <dir> --at t1,t2,t3`**, which seeks the live timeline and screenshots the **real painted stage** (all elements, SVG filters applied) into a contact sheet. Use `--shot` for "how does this element move", `snapshot --at` for "what does the frame actually look like".

If render diagnostics cannot run, be honest about it. Do not claim visual verification from source inspection alone; record the exact sample times a reviewer should inspect, the expected visual evidence at each beat, what was checked statically, and what remains unverified.

**Frame what you're editing.** A head-on render lies twice — in-place motion collapses to a dot, 3D to a flat stack. Pick the framing:

| Want to…                                                               | Flag                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| make a small / centred motion legible (default on)                     | _(zoom-to-fit; `--no-fit` to disable)_              |
| separate **in-place / overlapping** ghosts (a pulse, an in-place flip) | `--layout strip` (filmstrip, one cell per keyframe) |
| inspect **one phase** densely (e.g. a single bounce)                   | `--from 2.0 --to 3.0`                               |
| reveal **3D** that's ambiguous head-on (flips, tumbles)                | `--angle top` · `side` · `iso` · `yaw,pitch`        |
| change sample count · focus one element                                | `--samples 13` · `--selector '#hero'`               |

**For any 3D motion (rotationX/Y/Z or z), render at least THREE camera angles before you trust it** — e.g. `front` + `top` + `side` (or `iso`). One viewpoint hides depth: a flip reads as a static stack head-on, a tumble looks flat, an edge-on pose vanishes. Confirm the motion matches your intent in **all three** (a vertical-axis flip reads from `top`, a horizontal-axis flip from `side`, a general tumble from `iso`). For **in-place / overlapping** motion (a pulse, an in-place flip) the head-on render stacks every ghost on one spot — switch to `--layout strip` so each keyframe gets its own cell. Zoom-to-fit is on by default.

## Reading the output

```
#hero position  to/keyframes  @1s→4.4s (3.4s)
  0% {x:0 y:0}  33% {x:-180 y:-60}  67% {x:-320 y:40}  100% {x:-460 y:-20}
```

Each line is a tween — target, property group, method/shape, timing — then its keyframes as `pct% {props}`. x/y are GSAP **offset** pixels (the element's translate from its CSS home; +x right, +y down); rotation / scale / opacity / colour show too when animated. That's the data you edit. To _see_ the motion (shape, timing, 3D), use `--shot` (above). Full `--json` schema: **`references/reading-the-surface.md`**.

## Multi-stroke / pen-up (shapes with gaps)

A single element can trace a shape in **multiple strokes** with pen-up gaps between them — needed for anything with holes or detached parts (a `?`'s dot, an icon counter, separate letters/digits) where one continuous line would draw a wrong connector.

**Convention: each stroke is its own position tween; a 0-duration `set()` between them is the pen-up jump.** The command composites an element's strokes into one shared-scale trace and **does not draw across the gaps**:

```js
tl.to("#pen", {
  keyframes: { "0%": { x: -100, y: -150 }, "100%": { x: 80, y: -120 } },
  duration: 1,
}); // stroke 1
tl.set("#pen", { x: 80, y: 120 }); // pen up → jump
tl.to("#pen", { keyframes: { "0%": { x: 80, y: 120 }, "100%": { x: 85, y: 140 } }, duration: 0.5 }); // stroke 2
```

Full pattern (words, icons, holed glyphs, how it surfaces, and the single-stroke fallback): **`references/multi-stroke.md`**.

Staggered stroke reveals alone do not prove pen-up. For eval-grade trace work, make the lift, jump, and re-contact visible, or at least model it explicitly with `set()` gaps plus pen hide/show. A reviewer should be able to see from the shot or source that disconnected parts were not drawn through with an invisible connector.

## Layered motion: nest elements (don't fight last-write-wins)

GSAP is **last-write-wins per element + property**: two tweens animating the same element's `y` (or `rotation`, or `scale`) clobber each other, so you can't cleanly layer independent motions onto one element. When the brief has channels that are **independent in phase or rate** — an orbit AND an axial spin at a different rate, a flight path AND a wing-flap, a bounce AND a roll, a trajectory AND a wobble/bob — put them on **nested elements**:

- **parent** carries the primary trajectory (the path: `x`/`y`/`z`, the orbit),
- **child** carries the secondary, independent motion (a bob on its own `y`, a flap on `scaleX`, an axial spin on `rotation`, a wobble on `rotationZ`).

```js
tl.to("#group", {
  keyframes: { "0%": { x: -380, y: 0 }, "100%": { x: 380, y: 0 } },
  duration: 4,
  ease: "none",
}); // parent: path
tl.to(
  "#core",
  {
    keyframes: { "0%": { y: 0 }, "50%": { y: -40 }, "100%": { y: 0 } },
    duration: 4,
    ease: "sine.inOut",
  },
  0,
); // child: independent bob
```

The child's rendered position is the **composition** of both, so `--shot --selector '#core'` (the leaf) shows the combined motion — the corner markers inherit the full ancestor transform, and the orbit camera handles the chain. Use nesting whenever cramming everything into one tween would force you to trade one channel for another. For motion that genuinely derives from a **single parameter** (a parametric path), one keyframes block is correct — reach for nesting only when channels would otherwise collide.

The text surface shows it too: a nested element's block prints `↑ composed with #group: x −360..360, y −100..100, …` (the ancestor's motion **extent**, so a closed loop isn't hidden as `0→0`). Don't conclude "no path" from a child's own tween — read the `↑ composed with` line (or the `--shot`).

### Patterns that separate a 9 from a 5

These are the layered-motion mistakes that look fine in the numbers and fail on screen:

- **A fast channel needs its own dense tween.** A wing-flap, shimmer, or rotor wobble at "many cycles" can't share the path's coarse keyframe grid (you'll get ~12 lazy cycles, not rapid). Put the high-frequency channel on its **own** tween/child with enough stops (or a short `repeat`), decoupled from the path.
- **Squash stays flat to the ground — even while spinning.** If an element both rolls/spins **and** squashes on impact, they fight on one element: the squash rotates with the spin and skews off-axis. Split them — **spin on an inner child, squash (scaleX/scaleY) on an outer wrapper** that doesn't rotate — so the squash stays aligned to the floor.
- **Rigid things must stay rigid — set the pivot.** A logo, badge, icon, card, padlock body, gear may only translate, rotate, and **uniformly** scale — never shear/skew or stretch non-uniformly. The classic bug: an **SVG element's `transform-origin` defaults to the parent SVG's `0,0`**, not its own center, so a rotate/scale swings or grows around a remote corner ("the whole thing skews / arcs around an off-screen point"). Fix: `transform-box: fill-box` on the element (origin becomes its own bbox) **and/or** GSAP `svgOrigin`/`transformOrigin:"50% 50%"` with `smoothOrigin:true`; pick the **semantic pivot** (a hinge — lid/shackle/door — rotates about its hinge edge; a gear about its center). If a rigid shape shears in the `--shot`, it's the origin (or a stray `skew`), not the keyframes. Full decision tree + fix: `references/motion-craft.md` § pivot diagnostic.
- **"Points along travel" = the path tangent.** For heading/banking that follows the path, derive the rotation from the **velocity direction** (`atan2(Δy, Δx)` between keyframes), not an eyeballed linear ramp — and remember `#hero`'s notch points **up** at `0°`, so add the offset that maps `0°` to your travel convention.
- **Lock coupled phases.** If a spin should track the orbit (or a flip the bounce), derive both from the **same parameter** so they don't drift; if they're meant to be independent, give them clearly different rates.
- **Verify every named channel.** Before stopping, check each channel in the brief against the render one by one — a layered motion fails by dropping _one_ channel (the bob, the bank), not by getting the headline path wrong.
- **Deliver the channel that's named, at a magnitude that reads — don't substitute.** "Rotate-in" means real `rotation` (±90° or more), not a vertical offset that approximates it; "overshoot" means actually passing the target and easing back (`back.out`), not just arriving. A subtle stand-in reads as the wrong channel. After authoring, confirm the named thing is _visibly_ that thing (rotation looks like rotation).
- **Make fast or chaotic motion legible — add a trail.** A whip, a chaotic pendulum, a fast orbit reads as a blur or a jumble in any single moment (and in the played clip). Lay down a faint **motion trail / echo** — a fading path, or a few ghost copies along the element's recent positions — so the path itself reads. Confirm it in `--shot`.
- **Match the target's complexity — don't over-interpret.** More channels is not more faithful. A simple steady spin is a constant-gap rotation — do **not** add arc-length oscillation, a wobble, a pulse, or a secondary phase the target doesn't show. When reproducing a reference, the highest score comes from the **same channels at the same simplicity**, not from embellishment; invented detail reads as _wrong_, not richer. (This is the #1 way a careful build loses to a plain one.)
- **Useful 3D must be constructed, not suggested.** If the brief says cube, carousel, foldout, token, layer stack, or isometric towers, build the actual 3D structure: separate faces, correct `transform-origin`, `transform-style: preserve-3d`, parent `perspective`, depth/scale/occlusion, and readable hero poses. A slanted flat rectangle with a shadow is still flat. For bars/towers, make top/front/side faces or a CSS cuboid; for hinges, rotate from the hinge edge; for carousels/orbits, front/back ordering must visibly change.
- **A 3D hero must not land face-flat, and the depth must actually occlude.** If the final `rotateY` resolves to a multiple of 0 / 90 / 180 / 360° the front face sits square to camera and reads as a flat panel — land on a true 3/4 (`rotateY ≈ -25..-35°` with a slight `rotateX`) so a second face and an edge stay visible, and bias the tumble so no _held_ instant sits face-flat or passes through a slab pose. Set `perspective` **once** on the parent stage (a child re-declaring `transformPerspective` double-flattens), and put `transform-style: preserve-3d` **and** `backface-visibility: hidden` on **every** rotating ancestor in the chain or back faces bleed through. **Verify by rendering** a mid-tumble and a near-final frame (sample at slightly _less_ than duration — `t=duration` can land past the last drawn frame); a lint/validator pass is not 3D proof.
- **Orbital systems need literal rear occlusion, not z-index theatre.** A satellite crossing behind a core must be built from a real depth model (`translateZ` / orbit plane / camera angle / explicit near-far ordering), not just a flat card hidden by another flat card. The rear pass must show visible module material on both sides of the core while the core hides the center, then a separate front module must cover the core. Make the occluding object a large designed module/system object (central bus, side arrays, bevels, lights, clean docked pose), not a giant proof banner and not a tiny realistic satellite whose proof disappears in the strip. Verify front, top/side, and iso `motion --shot` views plus the scored filmstrip. If `translateZ` plus a core mask still reads as "implied," switch construction: split the rear satellite into left/right behind-core lobes driven by one orbit parameter, or use a real 3D renderable object. Do not keep enlarging the same flat card.
- **Grouping properties silently flatten `preserve-3d` and break z-sort.** Putting `opacity` < 1, `filter`, `clip-path`, `mask`, or `overflow` other than `visible` on a `preserve-3d` element collapses its 3D rendering context to a flat plane (per the CSS Transforms spec), so a glow/blur/soft-shadow on an occluded body can render **in front** of the occluder despite a correct `translateZ`. Keep occluding and occluded 3D bodies free of these — paint depth with **coplanar** gradients/borders instead of a stacking-context-promoting shadow — and drive the orbit from a single phase angle (`x = R·sinφ`, `z = R·cosφ`) so the path is a real circle that crosses front-to-back, not a lateral slide on a fixed plane.
- **Exploded 3D stacks fail when the middle frame is unreadable.** A layer-stack or architecture graphic is only useful if the exploded hold explains the system. Keep every separated layer high-contrast, rigid, labeled, and spaced; do not hide dark layers behind each other, add grid noise that competes with labels, or reassemble with lingering drift/z-fighting. The hold frame must be the clearest frame, not the messiest.
- **Data/UI transitions must prove the named mechanism.** A KPI swap that asks for an odometer/ticker needs visible digit reels or per-digit masked motion; replacing text with a fade is a miss even if the final card is clean. A before/after wipe needs pinned labels and a divider/handle that visibly overshoots or settles; if the strip cannot show the tactile mechanism, make it larger and simpler.
- **Useful 2D must preserve semantic identity.** Broadcast packages, KPI cards, timelines, route maps, and before/after comparisons are product communication tools first. Keep anchors stable, final text large, and labels pinned to the thing they explain. Do not trade correctness for style: a prettier wipe loses if the before/after sides stop reading as a comparison; a prettier timeline loses if the final four steps are not instantly readable.
- **Digit reels and state swaps need mechanical evidence.** For counters and KPI swaps, use tabular numbers, clipped per-digit reels, shared baselines, and synchronized chart/progress changes. The middle frames should show the old state leaving and the new state arriving through the same spatial logic; if the strip looks like a fade between two finished cards, the mechanism did not land.
- **Ticker frames must stay readable in the filmstrip.** If per-digit reels or overlapping old/new values create fragmented sampled frames, switch to whole-value stepped states (`$842K` → `$6.8M` → `$10.1M`) or another single-slot ticker where only one complete value is visible at a time. A mathematically correct odometer still fails if the judge strip catches half-hidden digit fragments.
- **A morph changes geometry, not just occupancy.** If the brief says morph, logo morph, icon morph, liquid merge, or shape-to-shape, alter shared path/point/shape data with MorphSVG or deterministic interpolation, or construct an equivalent continuous geometry transform. A fade, scale, slide, mask reveal, or crossfade into a separate final asset is a replacement, not a morph.
- **Trust the emitted geometry string, not the comment beside it.** Morph/lockup failures hide in coordinates that contradict the prose: a `Q ctrl end` whose control equals the segment start (collapses to a straight line); an 8-point "square" target whose corner verts are inset closer to centre than its edge-midpoint verts (renders as a cushion/blob — corner magnitude must be **≥** edge-midpoint magnitude per axis); or a "rounded" mark built from `clip-path` polygon + `border-radius` (radius rounds the bounding box, not the clipped vertices, so corners stay sharp). For real fillets emit explicit corner arcs (`Q`/`C`/`A`), not `clip-path`+radius. Drive any fill from the **same** morph progress so its mass grows with the shape instead of crossfading by opacity. **Verify:** run the geometry function at the endpoints _and_ mid-morph and read the literal numbers; zoom a final-frame corner for a true arc vs a hard point.
- **Cursor causality is coordinate-anchored.** For cursor-led product/UI motion, author the hover/down/up/click beats at fixed target coordinates. Ripples, press rings, and click feedback originate from the click coordinate and stay pinned there for the pulse; do not sample the moving cursor during the pulse. State changes start after the decisive down/up beat, and every panel, popover, toast, card expansion, or run result has a named trigger.
- **Crazy motion must prove the mechanism in the middle frames.** A polished final frame is not enough. The strip must show the named action at large scale: five blobs visibly merging for "liquid logo morph"; payload chips riding the curve for "data ribbon"; cards flying through camera and landing centered for "flythrough"; front/back node crossings for "helix/orbit." If a judge can only infer the mechanism from the title or the last frame, it is a 5-7, not a 9.
- **Schedule the hero beat for the strip.** Do not let the signature action happen entirely between sampled frames. Broaden or hold the peak for 8-14 frames so one sampled cell clearly shows the whip, squash, fold, crossing, shatter, or assembly. A good video with no readable peak frame will still judge like an 8.
- **The signature beat must occupy the frame.** For motion-graphics prompts that ask for "explosive," "cinematic," "liquid," "flythrough," "hologram," or "orbital," reserve 55-75% of the canvas for the hero action during at least one beat. Tiny satellites, labels, chips, dots, or dashboard panels will disappear in a 220px eval strip. Make the mechanism readable at thumbnail scale first, then add detail.
- **Do not let trails replace objects.** Trails/echoes clarify a fast path, but the actual subject still has to exist at readable size. A luminous S-curve without payload chips is only a path; a helix glow without large alternating nodes is only a decorative line. Put the carried objects on the path, stagger them, and make one front/back crossing undeniable.
- **Land the final hero pose.** Camera moves and 3D flythroughs fail if the subject flies past, crops off-frame, or ends as a tiny label cluster. End with a centered, settled, readable product pose: hero object 40-60% of frame width, labels outside the object, no important text under 28px at 1080p, and no element still drifting.
- **No demo scaffolding in the final frame.** Explanatory captions like "five blobs merge..." or "demo state" make the piece read as an eval artifact, not a client-ready motion graphic. If text appears, it must be part of the requested design (headline, label, KPI, product term). Remove instructional copy before scoring.
- **The landing must be a useful designed graphic, not the residue of the motion.** A data ribbon must resolve into a clean horizontal flow with aligned docks and labels; a helix must resolve into a premium system hero, not a narrow vertical demo; a shatter/rebuild must land as a better organized card than it started. If the last cell is merely "the moving parts stopped," the build caps around 8.
- **Focal hierarchy must be authored, not hoped for.** Give every complex piece one lead object or lead moment per phase: the word that punches first, the shard that anchors assembly, the panel that opens the system, the module that locks on. If all parts have equal amplitude and timing, the strip reads as busy and loses the 9 even when every channel exists.
- **Preserve live typography.** Kinetic type can use masks, wipes, swaps, or per-letter staggers, but sampled frames must never show broken duplicate glyph fragments that make the word harder to read. If a fancy slice treatment harms the phrase, replace it with whole-word or whole-glyph masking and put the energy into surrounding streaks, underlines, shockwaves, and scale beats.
- **Kinetic type must prove weight in the letters, not only around them.** Streaks, rings, and underlines are support effects; strict judges cap the piece if the strip shows readable words plus effects but not a controlled masked overshoot. Make at least one sampled frame show the glyphs themselves entering through masks with visible squash/overshoot/settle, while the final lockup stays clean.
- **8.5 is not enough for crazy motion.** If the mechanism exists but still feels "solid, not shippable," make the sampled peak and final poster more decisive. Do not add small secondary details. Instead: stronger per-letter evidence, a larger liquid-contact frame, explicit dock overshoot and snap-back, one lead shard/panel, grouped waveform beats, or a satellite visibly covering/being hidden by the core.
- **A flythrough needs a true camera-crossing proof.** Scaling/parallaxing cards around a centered hero is not enough. At least one foreground card must grow large enough to crop past the frame edge or visibly occlude the hero, then clear to a settled landing. A single giant wipe can still read as a slide transition; use two or more offset depth planes/cards, a coherent camera corridor, and a centered product-grade hero card. Add speed-line/blur cues only after the geometry proves a pass-through; cues cannot substitute for the crossing.
- **After the flythrough, the hero card still has to ship.** A sparse centered card after a cinematic pass gets capped. The final frame needs product-scene density: secondary layer hints, status chips, depth shadows, rails, or surrounding context that resolves from the camera move without cluttering the hero. Static chips on the card are not enough if the last third becomes a hold; keep a second offset card/front-back reorder or subtle late parallax alive until the landing.
- **A flythrough's "grow huge" must be real z, and z must stay under the perspective distance.** Drive a flythrough card's size from `translateZ` under CSS `perspective:P` (on-screen size = `P/(P−z)`), **not** a `scale()` tween — a scale keeps the card centred and proportional and reads as a zoom, not a pass-through. Never push a keyframe to `z ≥ P`: the projection `P/(P−z)` goes non-positive and the card silently flips behind the camera and vanishes. Reach the frame-cropping `z` while `opacity` is still **1** (fade only _after_ the dominant pose), and put an **opaque** `z-index:0` backdrop behind the 3D world or a dark scene composites white in headless. **Verify:** compute `P/(P−z)` at every keyframe — it must be positive and yield the intended 5×-plus crop with `opacity==1` at the peak.
- **Hologram foldouts need post-open depth proof.** A hinge unfold plus scan glow is only partial if the strip never shows the opened dashboard yawing or floating in depth. Hold one sampled frame after the panels face camera where the group has visible yaw/parallax/z separation, then settle to readable labels.
- **Audio-reactive pieces need a designed resolved meter.** The badge can squash and the bars can spike, but the final frame must look like an intentional audio product card, not a label over generic bars. Resolve grouped bars into a designed waveform/meter shape integrated with the badge. Keep the label rigid, balance the first impact so it does not consume the whole piece, and keep subtle meter motion alive through the final quarter.
- **Mark fidelity matters after spectacle.** Crystal/logo assembly must land on the requested mark silhouette (hexagon, diamond, wordmark, etc.), not a pretty adjacent starburst. Use guides or computed positions for final facets, then add highlight. A premium hold with the wrong silhouette is still not ship-level.

## Reproducing a motion from a reference (one-shot)

With a reference in hand (a clip, a filmstrip, an animated icon) you can usually nail it in **one pass** — the skill is to **decompose before you author**, not guess-then-thrash:

1. **List the moving parts** — what moves independently (the two bell strokes; track + knob; each digit reel). Each is an element/tween.
2. **Name each part's channels** from the frames — position path, rotation, scale, opacity, colour, SVG shape — reading the start pose, end pose, and key in-betweens.
3. **Read timing off the frames.** They're time-ordered: frame `i` of `N` sits at `t = i/(N−1) × duration`. Even spacing = linear; bunched frames = slow there (ease). Note sequence and stagger — what leads, what lags.
4. **Map to literal keyframes** at the `%` those poses fall on, with enough stops to trace the curve and the easing the spacing implies.
5. **Author once, then confirm** with a single `--shot`/render laid next to the reference. A clean decomposition lands first try; if one channel is off it's almost always one you mis-read in step 2 — fix that one, don't restart.

The reference is ground truth for the **target**, the way `--shot` is ground truth for your **output**. Read both; never reason from memory of "what a bell does".

**Author only what you saw.** Reproduce the channels actually present in the reference and stop — resist "improving" it. If the reference is a plain steady spin, ship a plain steady spin. Over-reading a simple motion (adding a pulse, an oscillation, an extra easing phase) is the most common one-shot failure: it loses to the naive build that just matched the reference.

**Then run the diagnostic pass** (next section) before you finish — at minimum the **subtractive self-verify** (nothing _missing_ **and** nothing _extra_; anything in your output that isn't in the reference is invented — delete it). That's what catches the silent failures a "looks right" glance misses.

## The diagnostic pass — critique like a motion designer

Don't stop at "the channels are present." Run your `--shot` / rendered filmstrip through the same critique a pro does — this is what moves a 6 to a 10. Each check is **spot → fix**; the full catalog (14 tells) and the values are in `references/motion-craft.md`.

1. **Read at speed, then frame-step.** Watch the clip 2–3× — does it read clearly, one focal point at a time, no "was that a glitch?" Then check **frame 1** (clean at rest?) and the **last frame** (fully settled — nothing mid-drift, no lingering velocity?).
2. **Squint / focal-point test.** Defocus: is the element you _intended_ as the focal point still the one your eye lands on? If ≥3 unrelated things move at once, there's no focal point → cut or sequence them.
3. **Read the spacing in the onion-shot.** Ghost spacing = velocity. **Even spacing → linear → robotic** (add ease, cluster frames at start/end). **No clustering at the landing → floaty** (the #1 tell — asymmetric ease + decisive arrival + shorter duration). **Straight ghost trail on an organic/large move → missing arc** (curve the path).
4. **Weight & finish.** Does each element's ease/duration match its implied mass (heavy ≠ light)? Big move without **anticipation**? Motion that **stops dead** instead of overshoot-and-settle? Fix per the tell catalog.
5. **Geometry — rigid stays rigid.** Any rigid shape shearing/skewing or swinging around a remote point = wrong pivot (see the "Rigid things must stay rigid" pattern + `motion-craft.md` § pivot diagnostic). This is the silent killer on icons/logos.
6. **Subtractive self-verify (always last).** Matching a reference is two checks, not one: nothing _missing_ **and** nothing _extra_. List every visible feature in YOUR output — every shape, motion, styling effect — and cross off each that also appears in the reference/brief. **Anything left over is invented — delete it.** This catches the silent failures: a gloss/sheen the flat icon doesn't have, positional scatter or scale-jitter on a motion that stays put, a second cycle the reference plays once, a bevel/shadow on a clean line icon. A faithful build subtracts these; don't ship them.

### The 9 ways a one-shot loses 9→6 (check each before you ship)

A careful build still scores a 6, not a 9, when it trips one of these — the recurring killers from real evals. Each is **tell → fix**:

1. **Under-powered signature beat.** The ONE motion the brief is about must read at a glance — bold amplitude/contrast. A damped swing needs a _large_ first swing that visibly decays; an X must close into a _full bold_ X; a morph's deformation must be _obvious_. Subtle is not tasteful here — under-playing the headline move reads as "didn't do it." → Push the key channel's magnitude until it reads in a thumbnail.
2. **Dead-hold timing.** The action completes in the first third, then 5 frozen frames pad the clip. → Distribute keyframes across the _whole_ duration so every frame shows progress; hold at most a beat. Match the duration to the action (a 250ms toggle is 8 frames, not 4s of hold).
3. **Misses the target's end pose.** For a reproduction, the LAST frame must land on the reference's final pose — open the ref's last frame beside yours. A pretty arc that over/under-rotates past the settle still fails. → Verify the end pose explicitly; tune magnitude to land it.
4. **Organic motion that doesn't deform.** Liquid / squash / elastic done with rigid parts teleporting (uniform dots, no squash&stretch, no metaball merge, no jiggle) reads dead. → If it could be done with `position` alone, it isn't organic — add volume-preserving squash/stretch, eased arcs, an elastic settle, the sheen.
5. **Frame-integrity break.** The subject must be present and on-frame in EVERY frame incl. the last — nothing flew off, scaled to 0, faded out, or separated so far the parts leave the frame (the over-decompose trap). → Scan all 8 cells; a blank/half-empty cell = a broken timeline, fix before shipping.
6. **Sloppy geometry / alignment.** Eyeballed geometry reads as amateur and is what strict reviewers kill: an X with uneven arms or an off-center cross, digit reels drifting off a shared baseline, a shape a few px out. → **COMPUTE** the geometry, don't eyeball it (equal lengths, a shared center point, integer reel offsets = `digit × cellHeight`). And **transform ONLY the moving part** — never rotate/scale a group that includes a rigid sibling (rotating the whole padlock group is exactly what skews the "rigid" body). Verify symmetry & alignment in the shot.
7. **Demo-label contamination.** The final frame includes explanatory helper text or labels that are not in the brief. → Delete every caption that explains your mechanism; only keep product-facing copy the prompt requested.
8. **Mechanism without a client-ready landing.** The middle frames work, but the last frame is sparse, cramped, or not a useful graphic. → Design the end state first, then make the motion arrive there exactly.
9. **Depth cues without occlusion.** 3D elements scale or dim, but nothing actually passes in front/behind. → Force one overlap/crop/front-back crossing large enough to read in the strip.

### The 8→10 plateau fix

If the build scores around 8, it usually means the mechanism exists but the direction is still weak. Do this pass before stopping:

1. **Delete demo residue.** Remove every helper caption, explanatory label, placeholder word, and path guide that would not appear in a client deliverable.
2. **Redesign the last frame as a poster.** Pause on the final cell only. It should be a finished title card, dashboard, pipeline, logo, or system hero without needing the previous frames. If not, redesign the landing before tuning motion.
3. **Make one sampled frame unmistakable.** Choose the strip cell where the signature action peaks and exaggerate it: bigger crop, stronger occlusion, wider squash, clearer beat, larger lead shard, brighter lock-on.
4. **Add a focal leader.** In every phase, one element leads by size, brightness, timing, or contrast. Equal motion across many parts reads as a demo, not direction.
5. **Remove stale construction paths.** Trails, curves, guides, and helper rings should fade out or resolve into useful structure by the final frame. A path that remains decorative after delivering payloads lowers the score.
6. **Check the strip at thumbnail size.** If the mechanism or landing only works when zoomed in, it is still an 8. Make fewer things bigger.

Stop when it passes the **10/10 gate** (`references/motion-craft.md`): perceptual, curve, physics, choreography, geometry, restraint — all clean.

## Editing keyframes

Percentages are **tween-relative**; edits go in the composition `<script>`. Move = change `x`/`y` at that `%`; add = insert a new `"P%": { x, y }` keeping ascending order; remove = delete the `"P%"` entry; retime = change `duration` / position. Object-form, offset math, and converting a flat `to(x)` into keyframes: **`references/editing-keyframes.md`**.

```js
tl.to(
  "#hero",
  {
    keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 120, y: -80 }, "100%": { x: 240, y: 0 } },
    duration: 2,
    ease: "power1.inOut",
  },
  1.0,
);
```

## Routing

| Want to…                                                                                                      | Read                                |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Make motion read as professional (easing values, durations, weight, pivots, the tell catalog, the 10/10 gate) | `references/motion-craft.md`        |
| Understand the keyframe surface + `--json` shape                                                              | `references/reading-the-surface.md` |
| Trace a shape with holes / gaps / separate letters                                                            | `references/multi-stroke.md`        |
| Add / move / remove / retime keyframes in source                                                              | `references/editing-keyframes.md`   |
| Avoid the common failure modes                                                                                | `references/gotchas.md`             |
| Author brand-new motion / pick a rule or blueprint                                                            | `hyperframes-animation`             |
| Run `lint` / `inspect` / `preview` / `render`                                                                 | `hyperframes-cli`                   |

## Gotchas (full list: `references/gotchas.md`)

- **x/y are offsets, not absolute canvas coords.** `{x:0,y:0}` = the element's CSS layout spot; values are deltas from there.
- **Head-on `--shot` can mislead** — in-place motion stacks on one spot and 3D flattens; reach for `--layout strip`, `--from/--to`, or `--angle` (above) to frame what you're editing.
- **One continuous line can't do holes** — if you see a wrong connector across a gap, you want multi-stroke (above), not more keyframes.
- **Studio holds are filtered.** A `set("#el", { …, data: "hf-hold" })` is an internal position-hold the Studio injects — never author or edit it by hand.
- **Dynamic tweens** (computed selectors / data-driven keyframes) can't be statically resolved and surface with fewer details; author literal `keyframes: {…}` when you want them editable.

## Boundaries

- GSAP only. Lottie / Three.js / CSS / WAAPI motion does **not** surface here — see the relevant `hyperframes-animation` adapter.
- It reads and screenshots; it never writes. All edits are yours to make in source, then `--shot` to verify.
- Don't restate `hyperframes-core` rules (single paused timeline, determinism) — they still apply.
