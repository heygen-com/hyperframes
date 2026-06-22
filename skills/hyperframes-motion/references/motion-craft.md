# Motion craft — the designer's eye, in numbers

What separates a 10/10 motion (indistinguishable from a pro's) from a competent 5. Read this when authoring or critiquing motion; the SKILL's "Think like a motion designer" and "Diagnostic pass" sections are the short form, this is the depth + the actual values.

The throughline: **motion communicates physics and intent.** Every choice (curve, duration, pivot, stagger) either reads as "a real thing with mass moved for a reason" or as "a value was linearly interpolated." The amateur tells below are all violations of that.

---

## 1. Spacing vs timing — the master distinction

- **Timing** = total duration (the container). **Spacing** = how the value is distributed across it (the content, i.e. the easing). They're orthogonal: changing timing just makes the same robot faster/slower.
- **Slope = velocity.** On a value-vs-time graph, steep = fast, flat = stopped/held. Ease-in = ramp up, ease-out = ramp down, ease-in-out = S-curve.
- **Even spacing reads robotic** — nothing in nature holds constant velocity; only machines do. **Varied spacing reads alive** — fast→slow encodes weight, slow→fast encodes urgency. In the onion-shot, even ghost spacing = linear = wrong (unless a steady spin/conveyor is literally the subject).

## 2. Easing — which curve for which job

| Job                            | Curve                     | Why (physics)                                                                                  |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| **Entrance** (lands on screen) | **ease-out** (decelerate) | already moving, slows to rest. The UI default.                                                 |
| **Permanent exit** (leaves)    | **ease-in** (accelerate)  | starts at rest, accelerates away — no landing to register. Keep it short or it feels sluggish. |
| **On-screen A→B move**         | **ease-in-out**           | starts and ends at rest, peaks mid-move.                                                       |
| **Hover / press feedback**     | ease-out, fast (80–150ms) | immediate responsiveness.                                                                      |

Named cubic-beziers (CSS / GSAP equivalents):

- `ease-out` = `cubic-bezier(0,0,.58,1)` · Material standard = `cubic-bezier(.4,0,.2,1)` · M3 emphasized-decel = `cubic-bezier(.05,.7,.1,1)`.
- Strong decel (heavy, premium): `expo.out` / `cubic-bezier(.14,1,.34,1)`, `power3.out`.
- **Anticipation** (dip back before the move): `back.in` / `cubic-bezier(.68,-.55,.27,1.55)`.
- **Overshoot + settle** (pass target, ease back): `back.out` / `cubic-bezier(.34,1.56,.64,1)`.
- **Elastic / bounce** oscillate past the endpoints — GSAP `elastic`/`bounce` only (no cubic-bezier can do it). Reserve for genuinely springy/playful subjects; cheesy on serious or large-travel motion.
- **`linear`/`none`**: only for a literal constant-velocity subject (a steady spinner, a conveyor, a marquee). Never for organic motion.

**Asymmetric easing = weight.** Symmetric S-curve in both directions = zero-gravity float (the #1 amateur tell). A falling thing accelerates (ease-in down); a rising/bouncing thing decelerates (ease-out up).

## 3. Weight & physics

- **Floaty/weightless is the #1 tell.** Caused by symmetric easing + too-long duration for the element's size + uniform spacing (no clustering at the landing).
- **Heavy:** longer slow-in (builds momentum), can peak fast, gradual slow-out, **minimal/no overshoot**, more anticipation. Curves: `power3.out`/`expo.out`.
- **Light:** quick acceleration, clean snap to rest or a tiny bounce; can change direction fast. `back.out` (small overshoot) ok.
- **Settle / follow-through:** motion shouldn't stop dead at the target. Primary move → small overshoot (5–15% of travel) → settle back, each stage shorter than the last. Velocity approaches zero asymptotically, not a cliff.
- **Anticipation:** before a primary move >~200ms, a small counter-move (10–20% of the main amplitude, 2–6 frames @24fps) telegraphs it.
- **Arcs:** large moves (>~100px) follow a curved path, not a straight diagonal. A straight ghost trail on an organic move = missing arc. Small moves (<40px) can be straight (curvature imperceptible).

## 4. Choreography & hierarchy

- **One focal point at a time.** If ≥3 unrelated elements animate at once with equal weight, the eye has nowhere to land → chaos. The focal element leads (moves first, biggest motion contrast); supporting cast is shorter/simpler.
- **Parent leads, children follow.** Container animates first, then contents cascade — motion itself encodes "this is the container, these are its contents."
- **Stagger ≈ 15% of element duration** between successive items (e.g. 30ms for a 200ms fade); cap the whole sequence ≤500ms so the last item isn't forgotten. Stagger is a tool, not a default — use it only when sequential reveal communicates hierarchy.
- **One secondary motion per primary**, not three. Card slides in + shadow deepens = good; + scale + blur + bounce = noise.

## 5. Duration — the numbers

| Interaction                       | Range      |
| --------------------------------- | ---------- |
| Press/active feedback             | 80–150ms   |
| Hover, tooltip, small overlay     | 150–250ms  |
| Element entrance (small → medium) | 200–400ms  |
| Full-screen / route transition    | 350–500ms  |
| Complex multi-element reveal      | 400–700ms  |
| Bounce/elastic (must settle)      | 800–1200ms |

Perception: <~100ms (≈6 frames @60fps) reads as an instant "snap" regardless of curve; <~230ms is felt-but-not-read; >1000ms reads as a delay, not an animation. **Match duration to size** — a tiny element animating 600ms is always floaty; target 150–250ms. (Frame budgets @60fps: 200ms=12f, 300ms=18f, 500ms=30f.)

## 6. Restraint

Every animated property must earn its place by doing one of: **orient** (where did it go / what state), **feedback** (an action registered), or **express** (purposeful personality). If it does none, it's decorative noise — cut it. Test: remove the animation — if the UI is no worse, the motion lacked appeal. **Match the reference/brief's channels exactly**; invented channels read as _wrong_, not richer (see SKILL "Subtractive self-verify").

---

## The amateur-tell catalog — spot → fix

| #   | Tell                                     | Spot (in the onion-shot / filmstrip)                                                                     | Fix                                                                                                                               |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Linear / no ease**                     | even ghost spacing; starts & stops at same speed; robotic                                                | ease-in-out (or ease-out for entrances); cluster keyframes at start/end                                                           |
| 2   | **Uniform timing across elements**       | every element same duration/curve/delay                                                                  | vary by hierarchy & size; no two identical unless unison is the point                                                             |
| 3   | **Floaty / weightless**                  | symmetric easing; no clustering at landing; too-long for size                                            | asymmetric ease; shorter slow-out with a decisive arrival; shrink duration to match size                                          |
| 4   | **No anticipation**                      | primary move starts cold, "teleports" into motion                                                        | 2–6f counter-move (10–20% amplitude) before the main move                                                                         |
| 5   | **No follow-through / settle**           | motion stops dead at target; velocity cliff-drops                                                        | overshoot 5–15% then settle; `back.out`/spring; asymptotic stop                                                                   |
| 6   | **Pops / dead frames / ambiguous holds** | sudden jump with no in-between; 2+ identical frames mid-move; a hold that reads as "broke"               | add in-betweens / smooth handles; make holds ≥8f & intentional or remove                                                          |
| 7   | **Conflicting eases on one element**     | position decelerates while opacity accelerates; two transforms peak at different times → "fights itself" | one motion personality per move; sync property curves or stagger them deliberately                                                |
| 8   | **DISTORTION — wrong pivot** (see below) | rigid shape skews/shears; whole thing swings around a remote point; scales from a corner                 | `transform-box: fill-box` (SVG) + explicit `transformOrigin`/`svgOrigin`; rigid = translate/rotate/uniform-scale only, never skew |
| 9   | **Over-animation**                       | squint test finds no focal point; ≥3 elements moving unrelated                                           | reduce to 1–2 dominant elements; sequence attention; cut decoration                                                               |
| 10  | **Over-interpretation**                  | output has channels the reference/brief never showed (added fade/scale/bounce/sheen)                     | match the reference literally; each extra property needs an explicit reason                                                       |
| 11  | **Wrong duration**                       | arrives before the eye can track (too fast) / attention wanders (too slow)                               | use the duration table; match to element size; test at real speed                                                                 |
| 12  | **No stagger / flat choreography**       | related items appear simultaneously, no hierarchy                                                        | stagger 30–80ms; first item = primary attention                                                                                   |
| 13  | **Missing arcs**                         | straight ghost trail on an organic/large move                                                            | curve the spatial path (intermediate offset keyframe / motionPath)                                                                |
| 14  | **Easing mismatch to subject**           | heavy thing bounces like a balloon; light chip drags                                                     | heavy → `power3/expo.out`, little overshoot; light/playful → `back.out`                                                           |

---

## Useful 3D construction patterns

The common failure in product-motion evals is **2.5D styling pretending to be 3D**. Shadows, gradients, and slanted rectangles are not enough when the brief names a 3D mechanism. Build the mechanism in CSS/GSAP, then check the strip for proof.

**CSS cuboid / data tower:** a bar or cube needs separate faces. Minimum: `.front`, `.right`, and `.top` faces with consistent dimensions, `transform-style: preserve-3d`, parent `perspective`, and transforms such as `translateZ(depth/2)`, `rotateY(90deg) translateZ(width/2)`, `rotateX(90deg) translateZ(height/2)`. If the side/top faces are not visible in at least one frame, judges will read it as a flat tile. For charts, labels should be anchored outside the faces or on billboards so they stay readable during yaw.

**Carousel / orbit:** depth must change over time. Front items are larger/brighter/higher z-index; rear items are smaller/dimmer/partly occluded. Side cards need `rotationY` plus `translateZ`, not just `x` and `scale`. Satellites should counter-rotate if readability matters. If every item stays equally bright and never passes behind anything, the orbit is flat.

**Foldout / hinge:** the transform origin is the brief. Left wing opens from its right edge, right wing from its left edge, top flap from its top edge, etc. Set `transform-origin` explicitly and check that the edge stays pinned while the panel foreshortens. A center-pivot spin fails even if it looks pretty.

**Exploded layer stack:** the exploded hold is the explanation frame. Give every layer enough z/y separation, contrast, and label space. Avoid dark translucent layers on dark backgrounds; avoid grid/detail noise behind text; avoid over-occluding the middle layers. Reassembly must land as one clean stack with no z-fighting or drift.

**3D proof checklist before stopping:** at least one frame shows side/top/rim/edge thickness; front/back ordering changes; labels remain legible at the hero pose; no face collapses to black or disappears; final pose is settled and aligned.

---

## Useful 2D production patterns

The common failure in useful 2D motion is **making a prettier animation that weakens the product message**. These pieces are overlays, dashboards, process explainers, route maps, and comparison graphics; the motion is only excellent if the viewer understands the information faster.

**Broadcast lower-third / overlay package:** the container leads, then identity, role, underline, and stat chip follow in hierarchy order. Use masks/clips for text, not loose fades. The end state must be usable over footage: compact, aligned, high contrast, and readable at thumbnail scale. If every part animates with equal amplitude, it reads as parts, not a package.

**KPI state swap / digit reel:** preserve the card's identity while the data changes. Keep the background, border, and anchor stable; animate only the contents that are changing. Numbers need `font-variant-numeric: tabular-nums`, fixed digit cells, clipped reels, and integer offsets (`digit * cellHeight`) so width and baseline never jitter. Pair the number motion with the chart/progress motion in the same time window; a number finishing before the chart starts feels disconnected. Filmstrip readability beats implementation purity: if a per-digit reel or overlapping old/new value creates half-hidden fragments in sampled frames, use a single-slot whole-value stepped ticker instead (`$842K` holds, `$6.8M` holds, `$10.1M` lands). Judges need to see complete values during the swap, not a technically plausible but visually broken odometer.

**Process timeline:** the final frame is the product. Reveal one active step at a time, draw the connector in sync with activation, and make the final four-step layout larger/cleaner than the transition frames. If the sequence is clever but the last frame is cramped, it is not shippable. Verify by reading only the last filmstrip cell: all step titles and status icons should be clear without replaying the motion.

**Before/after comparison wipe:** preserve comparison semantics. The divider/handle is the hero motion, but labels and badges must stay pinned to their side of the comparison and must not drift into the opposite panel. The after panel should reveal through a mask/clip, not by replacing the whole composition. Use a large tactile handle with a visible overshoot/settle; then introduce callouts after the wipe so the viewer first understands the comparison.

**2D proof checklist before stopping:** the named mechanism is visible in the middle frames; final information is readable in the last frame; no text baseline or digit width jitters; labels stay attached to their subjects; one focal point moves at a time; no added styling changes the semantics of the product graphic.

---

## High-amplitude motion graphics

When the brief asks for "crazy," "cinematic," "explosive," "liquid," "hologram," "flythrough," "orbital," or similar spectacle, the quality bar changes: the final design must be good, but the **transition mechanism is the product**. The middle of the strip must prove the named mechanism without needing playback context or the prompt text.

**Use a three-beat structure:** setup pose (what is moving), signature action (the mechanism, largest on screen), hero landing (settled product pose). Do not spend the first half on small fades or text setup. Put the signature action between roughly 20-70% of the duration, with at least two distinct sampled frames showing progress.

**Make the named object visible before it transforms.** A liquid logo morph that starts from one dot fails; show every source blob at readable size before merge. A shatter/rebuild needs enough shards to prove breakage, but each shard must still be part of a recognizable original. Crack lines or glow marks alone do not prove shatter; panels/shards must visibly separate on arced paths, rotate as meaningful pieces, and then rebuild in a leader-follow sequence. A crystal assembly needs separated facets before they lock into the mark.

**Scale for strip judging.** In eval galleries, a 1920px frame often becomes a 220px thumbnail. Any mechanism element smaller than roughly 32px at 1080p will vanish; key labels should be 28-44px minimum; hero objects should occupy 40-75% of frame width during the signature beat. When choosing between more details and larger readable parts, choose larger parts. Put the peak action on a sampled moment, not between samples: hold or broaden the signature pose for 8-14 frames so one strip cell unmistakably shows the mechanism.

**Organic morphs need deformation, not just translation.** Liquid, elastic, smoke, and blob motions require visible squash/stretch, overlap, elastic settle, and surface continuity. If separate circles simply move into a final mark, it reads as layout animation, not liquid morph. Use overlapping blobs, masks/clip-paths, scale anisotropy, and a final ripple/shear that settles back to a rigid logo.

**Liquid logos need a continuous mass, not just stretched dots.** If strict reviewers keep calling the merge rigid after you add squash/stretch, replace the construction with a real goo/metaball phase: SVG filter or blur/contrast compositing, a large merged sheet, and visible tendrils that collapse into the final mark. The v44 eval only cleared the liquid cap after the strip showed one continuous goo body before the diamond lockup.

**Data ribbons need payloads.** A beautiful curve by itself is a trail, not a data ribbon. Put chips, packets, ticks, or labeled tokens on the path; show them accelerating along the curve; land them into a readable output cluster. The path should explain where objects travel, not replace the objects. The strip needs a whip frame with overshoot and an echo trail, then a separate landing frame with a clean product pipeline; if the curve is still the final composition, it reads as a demo.

**Data systems must finish as product graphics.** A whip, stream, ribbon, or packet swarm should land into aligned, usable information architecture: lanes, docks, labels, metrics, or a compact pipeline. If the last frame still follows the curved path, or the chips are floating around a decorative spline, it is a motion demo. Final state rules: align output labels to a shared baseline, make every label at least 28px at 1080p, and give the viewer a clear left-to-right or center-out reading order.

**Camera flythroughs must land centered.** A flythrough is only premium if depth and occlusion happen before a clean hero pose. Keep the final object in frame, centered, and settled; avoid ending on a cropped edge or tiny receding stack. During the move, at least one foreground element should pass in front of the camera/object, and the hero should finish at readable scale.

**True flythrough proof:** one object must cross the camera plane. In the strip, a card should become huge, crop off one or more edges, occlude the hero or background, and then clear. If every card remains fully visible, the scene reads as parallax, not a flythrough. Depth cues (blur, speed lines, opacity) are secondary; they cannot replace a geometric crossing. A stack of readable cards sliding in depth is still not a flythrough unless the sampled frames prove a camera-through-card whip: a foreground card must momentarily dominate/crop the frame, then clear to the centered hero.

**Flythroughs need sustained, multi-card depth.** One giant occluding card can lift a parallax move to "convincing," but strict reviewers still cap it below ship level if the strip reads as a single foreground wipe followed by a static hero card. Show at least two depth events: a huge cropped foreground pass, then a second offset card or side card changing front/back order before the landing. Hold the cropped pass long enough for a sampled frame, but also keep another sampled frame where the viewer sees layered cards receding around the hero. The final card must settle centered; the depth proof must not depend on a single blur smear.

**Helix/orbit systems need one undeniable crossing.** Depth is proven when one node/card passes in front, another passes behind, and size/opacity/occlusion change with depth. Tiny equal-brightness satellites arranged around a circle read as flat decoration. Make the nearest object large enough to overlap the core, dim the far side, and counter-rotate labels so at least the landing pose is readable. For orbit locks, author explicit front and rear passes: a front satellite must overlap the core at high opacity while a rear satellite is dimmed or masked behind it. Do not leave the occluder as a static backing plate in the final pose; if the bright front object remains parked behind/around the core, judges read it as clutter rather than a pass. The crossing object must visibly travel through front/core/back depth and then resolve into a clean, premium system layout.

**Orbit crossings and orbit landings are separate beats.** If the same bright satellite both proves the front crossing and stays visible near the core at the end, it reads as a backing plate or clutter. Use the crossing satellite boldly at peak scale, then move it to a small side-module position or fade it into the support system before the lock label appears. The last sampled frame should show the core, lock state, and supporting rings/modules with clear hierarchy; no large green object should remain behind the hero unless it is the hero.

**Orbital command centers need more than one obvious occluder.** A single giant foreground pass can lift the score, but strict judges still cap it around 8.5 if the rest of the system does not read as a designed orbital machine. Show at least three states in sampled frames: rear satellite partially hidden behind the core, front satellite covering the core, then multiple small modules locked into readable ring positions. The final frame should look like a premium command UI, not a leftover planet plus labels.

**Resolve orbits into docks, not residue.** After a big front pass, convert the motion energy into a designed system: 3-5 small module docks, connector lines, a clear lock label, and subdued rings around the core. The crossing satellite should disappear, shrink into a dock, or hand off to final modules; if it remains as a large green object near the core, the last frame reads like leftover animation state. The v41 eval cleared the orbital cap only after the final frame became a command-center layout with locked modules and connectors.

**Helix/orbit landings need a system pose.** After the crossing, the final frame should read as a premium platform/system graphic: central core or spine, aligned label, supporting modules, and a clear hierarchy. A thin stream with one label is a successful mechanism but not a 9+ landing.

**Dashboard foldouts need useful content at the end.** A hinge/fold mechanism can score high only if the unfolded panels become a useful dashboard: large metric, chart, status, and at least one label group that reads in the last strip cell. Do not spend all pixels on wireframe chrome. The hinge proof should pass through an edge-on or steep-yaw frame, then resolve into readable panels; a restrained 20-degree turn usually reads as flat.

**Kinetic type needs clean typography before particles.** For launch-title cards, the phrase must stay readable in every sampled frame after the first reveal. Accent shapes, shockwaves, and streaks should support the text's reading order; if they draw more attention than the letters, they lower the score. Prefer whole-glyph or whole-word masks that preserve final typography over fragmented duplicate-letter slices; if sampled frames show broken glyphs, the build is capped no matter how energetic the impact is. For strict per-letter prompts, give each glyph its own clean mask cell and stagger the cells enough that a strip frame shows a clear sequence; avoid white scan lines crossing through letterforms at the sampled peak. Clean glyph masks alone can become too simple for a high-impact title card; pair the clean per-letter reveal with one authored shockwave/scale/underline beat that reads as energy without damaging the letters.

**Kinetic type needs one unmistakable sampled impact frame.** A clean staggered title plus a crisp underline still scores like 8.5 if reviewers describe it as a "controlled title build." Put the signature beat on a sampled cell: the word should visibly squash/overshoot or scale as a unit, the underline/shockwave should occupy a large area, and accent streaks should radiate from the landing without crossing through the letters. Do not rely on tiny sparks or fast lines between samples. Make the impact frame feel like a poster moment, then immediately settle to the clean final lockup.

**Audio-reactive stings need grouped beat states.** Random-looking bar variance caps around 7. Author 3-4 clear beat groups: anticipation dip, impact expansion, rebound, decay. The central badge must visibly compress/rebound on the same beats as the waveform, and rings should be large enough to read in the strip. Make at least one sampled frame show a physically obvious squash or rebound of the badge, not just changed bar heights. If the badge squash is subtle at thumbnail size, change its state as well as its transform: a wide impact plate with a contact shadow, colour inversion, and a held squash frame reads better than a thin scaled rectangle. Keep the badge transform in one non-overlapping tween or keyframe sequence; overlapping `.to()` calls on the same element's scale/y channel often cancel the intended peak.

**Crystal/logo assembly needs final silhouette discipline.** Build the final mark from computed facet positions before animating the assembly. The last frame must match the requested silhouette (hexagon, diamond, wordmark, etc.); a pretty starburst that misses the shape is not a logo assembly. Keep the separated mid-frame facets large enough to explain the construction path, then lock them exactly. Do not let the largest shard paths crop off-frame or make the final mark small; strict judges need both the assembly beat and the final logo to occupy hero scale.

**Remove eval-only copy.** Explanatory captions are useful while authoring but must not be present in the scored final composition unless the prompt explicitly asks for them. A client-ready motion graphic uses only product-facing labels, titles, metrics, or brand text.

**8.5 means the mechanism exists but the direction is still indecisive.** The fix is usually not more particles. Make the one peak frame more obvious and the landing more premium: kinetic type needs a visible per-letter reveal, not only streaks around readable words; liquid morphs need overlapping volume and a ripple/surface-continuity moment, not just blobs arriving; data ribbons need a deliberate overshoot beyond the dock and snap-back; shatter/rebuild needs a single lead panel or shard that the eye follows through both break and return; audio-reactive pieces need bars grouped into designed beat states; orbits need a front object actually covering the core and a rear object visibly hidden behind it. For shatter/rebuild, "lead" means the lead panel is larger, brighter, and lower-distraction than every other piece during both scatter and return; merely outlining it while all pieces move equally still reads as no focal leader. But do not solve focus by turning the shatter into a zoomed panel transition, and do not rely on crack strokes if the pieces barely diverge: the middle frames still need meaningful separated pieces, visible rotation, arced scatter, and a clear break/rebuild path. For orbit/helix depth, make occlusion literal: a front satellite should overlap a large portion of the core, while a rear satellite is dimmed or masked by a core-coloured layer.

**Support effects cannot replace the named motion.** v62 made kinetic type louder with rings, streaks, and a bigger burst, but strict jurors still scored 8.7-8.8 because the strip proved "effects around readable words" more than weighty masked overshoot in the glyphs. For kinetic type, the letter motion is the product: show whole glyphs entering through masks, stretching/compressing on impact, overshooting their baselines, and settling cleanly. Add shockwaves only after that evidence is visible.

**Lead-shard choreography must not duplicate the source.** v62 added a bright shatter lead card, but sampled frames showed duplicate "Signal Graph" text and a crowded rebuild, so strict jurors still capped it. If you promote a lead panel, hide or dim the original panel while the lead is in flight, keep the lead lower-distraction than the final card, and restore one precise final layout. A lead is successful only if the eye can follow it through scatter and return without seeing two competing copies of the same content.

**Audio reaction needs anticipation, impact, and decay in the sampled strip.** Bars plus rings can still look generic if the badge deformation is subtle. Stage three visible states: pre-impact anticipation (badge lifts or inhales, bars quiet), impact (badge/container squashes or inverts while grouped bars spike), and decay (bar groups settle through two or more designed levels). Keep the text rigid. If the strip only shows "busy bars" around a static label, it stays under 9.

**One giant foreground wipe is not a full flythrough.** v62 made the foreground crop obvious and improved the final hero card, which helped two jurors, but one strict juror still read it as a single pass-through/slide rather than a cinematic camera move across offset cards. Build a real corridor: at least two offset depth planes cross at different times/angles, rails or background cards recede consistently, and the final hero object resolves from the same camera move. A large occluder is proof of crossing; it is not the whole flythrough.

**Hologram scan glow is secondary to depth.** v62 amplified scan lines and sweep glow, but two jurors capped the foldout because the post-open yaw/depth proof was subtle. After the hinge unfold, hold a frame where the opened panel group visibly yaws or floats in z with side panels offset from the center, then settle to readable labels. If the only obvious event is the hinge opening, the hologram reads as a flat dashboard reveal with glow.

**v63 confirmed construction fixes beat louder effects.** Starting from the stronger v61 panel, v63 improved the rows it changed when the construction changed: shatter cleared after the source graph tile was hidden while a single lead graph card carried the scatter/rebuild; hologram cleared after a held post-open yaw/depth pose; orbital stayed ship-level with the designed module object; flythrough improved only when two offset foreground planes crossed the camera instead of one giant wipe. Prefer these construction changes over adding particles, glow, or extra labels.

**Data ribbons need an explicit overshoot artifact at docking.** v66 isolated the successful part of v64: payload chips overshot past their dock targets while a brief overshoot ring/band appeared around the landing rail, then everything snapped back into a clean Ingest/Transform/Deliver flow. That moved data ribbon from `1/3 shipIt` to `3/3 shipIt` even under a fresh panel. For path-to-flow graphics, do not rely on easing alone to imply overshoot; show one sampled cell with the payloads visibly past target and a transient snap cue, then remove the cue before the final hold.

**Kinetic type still needs a premium final poster.** v63's stronger glyph squash/overshoot moved two jurors to 9+, but one strict juror still capped it because the final lockup felt simple. After the letter-weight evidence is visible, design the final title frame like a finished broadcast package: intentional hierarchy, supporting rule/underline, balanced negative space, and no generic leftover streaks. Do not stop at readable words plus a shock beat.

**Audio-reactive needs a designed end state, not just proof of reaction.** v63 still capped audio because the VOICE READY resolve read clean but not premium. Treat the final as an audio product card: grouped bars should resolve into an intentional waveform shape, the badge should feel integrated with the meter, and decay should settle into a designed rhythm display. If the final frame is just a label above generic bars, stricter jurors call it useful but not 9+.

**Flythrough needs density after the camera move.** v63's two-plane camera crossing was accepted by two jurors, but one still capped it because the final AUTOMATE card felt sparse. The fix is not another foreground wipe; it is a richer hero landing from the same camera move: one main card plus secondary layer hints, status chips, rails, or depth shadows that make the final frame feel like a cinematic product scene instead of a single centered card.

**Static final detail is not enough for flythrough 9s.** v68 isolated the v64-style final-card detail on top of v63. Jurors agreed the richer AUTOMATE card made the row more client-ready, but still capped it because the proof was concentrated in one crossing event and the last third became mostly a centered hold. For 9+, add living product-scene depth after the crossing: a second offset card/front-back reorder, parallaxing side cards that settle into context, or subtle late rail/status motion that resolves from the camera move. The final card can gain chips/details, but the scene around it must still prove the flythrough did not stop at one wipe.

**Crystal polish cannot rescue flat construction.** v69 added late internal facets, specks, and glints to the v63 crystal assembly; the blind-ready comparison still dropped because two jurors read the final third as busier, not more premium. For crystal/logo assembly, do not spend another version on highlight passes after the object is already assembled. Change the construction: make separated facets larger and visibly multi-faced, hold one mid-frame where depth and rotation are undeniable, then keep the assembled mark alive with a subtle yaw/tilt or face parallax that proves volume. The final hold should feel like a constructed object, not a flat translucent badge with effects.

**Crystal construction beats crystal polish.** v70 changed only crystal construction against the v63 champion and a blind panel promoted it: crystal moved from raw `8.07` to `8.73`, won `3/3` jurors, and became `3/3 shipIt`. The winning change was not more shine; it was larger separated shards, visible multi-faced geometry through the middle cells, later lockup, and subtle post-lock volume. Keep the remaining caveat: jurors still noticed the older champion had a cleaner hex silhouette. For the next crystal attempt, preserve v70's depth proof while tightening the final hex mark silhouette.

**Do not let final polish weaken proven mechanics.** v64 added final-frame decoration to several already-strong builds and the panel got worse: small mark details did not make liquid feel more liquid, a framed audio meter did not prove badge compression, arc guides did not make crystal more premium, and unrelated panel noise pulled orbital down. Treat final polish as useful only when it preserves or amplifies the core sampled mechanism. If a row is already near 9, first identify the exact missing evidence; do not add generic frames, halos, guide arcs, or status chips and assume they raise ship quality.

**The 8/10 plateau is a direction problem.** When reviewers say "clean but not shippable," the missing piece is rarely another tween. It is usually one of: no dominant lead object, no poster-quality last frame, stale construction guides still visible, a signature beat that happens between sampled frames, or too many small details instead of one bold readable action. Fix order: final frame design → one peak strip cell → focal leader → cleanup. Do not keep adding secondary effects; they make an 8 busier, not better.

**Two unchanged strict panels means change construction pattern.** If two consecutive eval versions keep the same under-9 score and the same notes after you already increased amplitude, held the peak, and cleaned the final frame, stop tuning the same implementation. Replace the mechanism: kinetic type may need a different per-letter mask system rather than bigger shockwaves; shatter may need true clipped card regions or separated DOM panels rather than extra floating fragments; flythrough may need a real CSS/Three camera corridor instead of oversized duplicate occluder cards; orbit may need an authored front/back mask stack with fewer rings, not louder satellites. Treat repeated 8/8.5 as evidence that the construction model is capped.

**Use `motion` to catch transform-model bugs before judging.** If `npx hyperframes motion` warns that CSS `transform` is being overwritten by a GSAP tween, move the starting transform into `gsap.set()` and leave CSS for layout/styling. A flythrough/card/orbit can look acceptable in one sampled strip while the motion surface reveals that rotation, scale, or z-depth is being discarded when GSAP writes `x`, `y`, or `scale`. Fix the transform contract before increasing spectacle.

**Judge raw panel averages, not rounded medians.** Median/rounded gallery scores can hide a hard juror that still sees the mechanism as partial. In v41-v43 the headline panel showed all prompts at 9+, but raw averages exposed persistent sub-9 caps for liquid deformation, badge impact cleanliness, flythrough cinema, and orbital occlusion. Track per-juror raw scores, raw prompt averages, and strict raw failures before claiming a one-shot skill is solved.

**If cleanup does not move the hard juror, stop polishing.** v45 cleaned badge text, flythrough gate text, and added a second orbital pass, but the hard raw scores stayed unchanged. That is evidence the issue is construction-level, not roughness-level. The next move should be a different motion model or a stronger eval prompt/surface, not smaller corrections to the same strip.

**Panel noise is real; do not re-learn from unchanged prompts.** Fresh independent juror panels can move unchanged prompts by 0.3-0.5 points even when the artifacts are byte-identical. In v47 the panel cleared 9/10 raw prompts; v49-v50 changed only the orbital construction but fresh panels also pulled unrelated liquid, shatter, flythrough, hologram, and helix rows below 9. Treat cross-version regressions on unchanged rows as judge variance unless the artifact changed. For optimization, compare the changed prompt and keep the best full-panel snapshot; do not rewrite stable constructions because one fresh panel was harsher.

**Orbit occlusion cannot be hinted.** Repeated v47-v50 orbital attempts showed that dimming, labels, split helper halves, and bigger satellites still scored 8-8.5 when the strip did not make a front/back pass feel like a designed cinematic system. For 9+, the orbit should be authored around the occlusion beat from the start: one rear module visibly disappears behind a core-shaped mask, one front module covers the core without becoming a flat banner, and the final docked command pose must still look premium. Helper labels such as "front" or "behind" are eval scaffolding, not motion design; they do not substitute for real depth.

**Do not fake orbital depth with 2D layer choreography.** v51 made the rear module large, held it behind the core in the strip, added a foreground lock module, and improved the final command UI; the strict panel still read front/back occlusion as partial. This means z-index/mask choreography can prove "some overlap" but not "cinematic 3D orbit." For orbital command centers, build the scene as true depth: a parent orbit plane with `transform-style: preserve-3d`, satellites positioned with `translateZ`/`rotateY`/scale from a shared angle parameter, explicit near/far z-order or a real 3D renderer, and motion shots from front/top/side/iso. If the implementation cannot show the rear satellite crossing behind the core from at least two camera angles, change the construction model before judging.

**A huge rear card is still not proof of an orbit.** v52 used a true CSS-3D orbit plane, `translateZ`, and a core mask; two of three jurors still scored orbital 8.4 because the rear module was implied while the foreground pass was the only undeniable occlusion. v53 made the rear card much wider and held it behind the core; all three jurors still scored 8.4-8.6 because it read as partial module-level occlusion. The next construction jump is not "bigger card" or "longer hold": build the rear pass as an explicit split object, with left/right visible lobes behind the core driven by the same orbit parameter and the core hiding the center, or use a real 3D object/render path. The scored strip must contain one frame where the rear module is unmistakably behind the core and another where a front module unmistakably covers it.

**Split rear lobes must read in the scored strip, not only the tight proof.** v54 split the rear satellite into left/right lobes and improved the headline aggregate to 9.01, but orbital still averaged 8.7 because two jurors read rear occlusion as implied in the gallery strip. If you use split lobes, make the held strip frame unmistakable: bright capsule ends on both sides of the core, close enough to read as one hidden object, with the core visibly occupying the gap. If only one side is obvious or the viewer has to infer the missing center, the construction is still capped.

**After split caps fail twice, leave DOM cards.** v55 moved the rear caps farther outside the core and boosted their contrast; the strip finally showed both caps, but two jurors still marked orbital occlusion partial and orbital averaged 8.67. That is the stop condition for DOM-card orbital choreography. The next attempt should use a different representation: an actual 3D mesh/object orbiting a sphere, or an eval surface/prompt that explicitly judges the side/top/iso motion shots. Do not spend another version nudging flat caps, masks, or labels.

**Renderer depth still needs visual identity.** v56 moved orbital to a canvas-rendered, z-sorted scene, but jurors still scored orbital 8.4 because the rear satellite looked like another cyan glow/ring behind the core. Real depth alone is not enough if the hidden object blends into the core. Make the rear and front satellites visually distinct from the core and from each other: different hue/value, readable module IDs on the visible ends, and a silhouette that remains recognizable when the center is occluded.

**A proof slab is not a satellite.** v57 made the rear object high-contrast amber with M7 labels on both exposed ends; two jurors accepted it, but the raw orbital average still stayed below 9. v58 exaggerated the slab and added a core-shaped occlusion cutout; scores got worse because strict jurors read it as less client-ready and still not a convincing satellite pass. The next model should look like a real orbiting module: a central bus and side panels/antennae whose middle passes behind the core, not a wide banner whose only job is proving occlusion.

**Small realistic satellites can hide the proof.** v59 changed the rear object into a more client-ready satellite bus with side panels, but all jurors still scored orbital below 9 because the occlusion became readable as generic depth cues again. The successful direction is not realism at small scale; it is a large, unmistakable module-level crossing that still looks designed. If the module silhouette is too small for the 220px strip, judges will call the front/back pass implied even when the renderer is correct.

**Evidence can prove occlusion and still fail ship quality.** v60 added tight/rear/front evidence frames, and all jurors agreed the orbit had real front/rear occlusion; they still rejected it because the object read like a proof slab rather than a useful command-center graphic. The next construction must be a large designed orbital module/system object: side arrays, central bus, bevels, lights, and a clean docked UI pose. Do not choose between a giant rectangular proof banner and a tiny realistic satellite; make the occlusion object large enough for the strip and designed enough to ship.

**Audio-reactive badges should deform the container, not the label.** v47 cleared the audio-reactive cap by keeping the VOICE READY text rigid while the badge container held a bright inverted squash/rebound on a sampled frame. If the word itself stretches, strict reviewers describe the midpoint as rough; if only the bars move, they call the badge reaction insufficient. The sampled impact cell should show the container color/scale/y changing in sync with grouped waveform peaks, with the text still readable.

**Audio impact cannot front-load the whole piece.** v65 made the container squash more obvious and kept the label readable, which got two jurors to ship, but the hard juror capped it because the early hit felt oversized and the back half became comparatively static. Balance the reaction across the strip: clear anticipation, a strong but not overwhelming impact, rebound, then two designed decay states before the final meter. The label should stay rigid, but the visual energy must continue through the final half instead of peaking once and coasting.

**Audio meters need late micro-motion after they ship.** v67 reduced the first hit, kept the VOICE READY label rigid, and added a late integrated meter; even under a much harsher panel the audio row moved to `3/3 shipIt`. The remaining critique was that the last quarter still felt nearly static. For audio-reactive stings, land the product card early enough to read, but keep two subtle final-quarter states alive: meter bars breathing, a faint decay rail, or a restrained live indicator pulse. Do not stretch the label, and do not make the first impact larger to compensate for a dead ending.

---

## Rigidity vs distortion — the pivot diagnostic (fixes the classic "the whole thing skews" bug)

**Decide first:** should this element _deform_? A logo, badge, card, icon, text block, padlock body, gear — **rigid**: it may only translate, rotate, and **uniformly** scale; it must never shear/skew or stretch non-uniformly. Only organic/rubber/squash-stretch subjects deform.

**Why rigid things skew anyway — the SVG transform-origin trap:** a DOM element's `transform-origin` is relative to its own box, but an **SVG element's default origin is the parent SVG's `0,0`** — not the element's center. So a rotate/scale on an SVG node swings or grows around a remote corner → "the whole graphic arcs around an off-screen point" / "it skews as it rotates." This is exactly the icon-lock failure (the body sheared instead of the shackle hinging cleanly).

**Fix:**

1. `transform-box: fill-box` on the SVG element → makes `transform-origin` (and `%`) relative to the element's own bbox. Resolves the majority of SVG pivot bugs.
2. Or GSAP `svgOrigin: "x y"` (SVG-canvas coords) / `transformOrigin: "50% 50%"`, with `smoothOrigin: true` to avoid a jump when the origin changes mid-timeline.
3. Pick the **semantic pivot**: a hinge (lid, shackle, door) rotates about its hinge edge; a dial/gear about its center; a squash scales from the contact edge (bottom).
4. **Never** apply `skew` to a rigid element. If you see unexpected shear, check for stray skew (matrix/3D-decomposition can introduce it) and for a wrong origin.
5. Verify by frame-stepping the transform: the geometry must stay rigid; the pivot must match intent.

---

## The 10/10 gate — don't ship until all pass

**Perceptual:** watched at real speed, nothing reads as "glitch/off"; squint test → intended focal element still dominant; first frame clean at rest; last frame fully settled (no element mid-drift).
**Curve:** no unintended linear segments or velocity kinks; overshoot is authored, not accidental; co-animating properties tell one coherent physical story.
**Physics:** consistent mass per element (ease/duration match implied weight); no floaty drift — decisive landing; anticipation before big moves; follow-through, not dead stops.
**Choreography:** never ≥3 unrelated elements at once; clear lead→follow sequence; stagger only where hierarchy is intended; duration matches scale.
**Geometry:** every rigid element stays rigid (no unintended shear/skew); transform-origins explicit & semantic; `transform-box: fill-box` on CSS-animated SVG.
**Restraint:** every animated property has a reason; nothing animated that the brief/reference didn't ask for; no animation is load-bearing scaffolding hiding a design gap.

## Animation vocabulary — name the right idiom (web/UI motion)

Pros reach for a _named idiom_ rather than inventing motion. Pick the idiom the brief implies, then execute it cleanly. (Condensed from the animations.dev vocabulary.)

**Entrances/exits:** fade · slide-in · scale-in · **pop-in** (appears with a slight overshoot) · **reveal** (uncovered via clip-path/mask). Default entrance ease = ease-out.
**Transitions between states:** **crossfade** (one out as another in, same spot) · **morph** (one shape smoothly becomes another) · **shared-element / layout animation** (an element travels+resizes to its new spot instead of snapping — keeps identity) · **continuity / direction-aware** (forward slides one way, back the other) · **accordion** (height expand/collapse) · **view transition**.
**Sequencing:** **stagger** (items one after another, small delay) · **orchestration** (deliberately timing several so they feel coordinated) · **fill mode** (keep first/last frame styles before/after) · **stepped** (discrete steps, e.g. a counter).
**Feedback:** hover · **press/tap** (subtle scale-down so it feels physical) · **ripple** (circle from the tap point) · **shake/wiggle** (error) · hold-to-confirm · rubber-banding (resist + snap past a boundary).
**Looping/ambient:** marquee · **pulse** (gentle repeating scale/opacity to draw attention) · **float** (gentle drift so a static thing feels alive) · orbit · yoyo/alternate · idle.
**Polish idioms:** **clip-path/mask** reveal · **line-drawing** (SVG path draws itself via stroke-dash) · **number ticker** + **tabular numbers** (fixed-width digits so they don't shift — use for any counter/odometer) · **typewriter** · **text morph** (per-character) · **skeleton/shimmer** (loading sheen) · **before/after slider** · blur.

**Spring physics (when motion should feel physical, not timed):** a spring is defined by **stiffness/tension** (pull toward target — higher = snappier), **damping** (how fast it settles — lower = more bounce), and **mass** (heavier = slower). Think in **perceptual duration** (when it _feels_ done, ignoring micro-settle), **velocity**, and **momentum** (carries velocity after a drag/interruption). Prefer springs for gesture-driven/interruptible motion; **interruptible** = can be smoothly redirected mid-flight (don't restart from zero).

**Performance (so it never janks):** animate **transform & opacity only** — they're GPU-composited; animating width/height/top/left causes **layout thrashing** + dropped frames (**jank**). Hint with `will-change` sparingly. Target 60fps; a dropped frame is a missed draw deadline.

**Accessibility:** respect **`prefers-reduced-motion`** — tone down or replace large motion (big travel/parallax/spin) with a fade for users who opt out.

Sources: animations.dev/vocabulary (web-motion idioms, spring terms) · Disney _Illusion of Life_ (12 principles) · Material Design 1/3 motion (duration + easing tokens) · IBM Carbon motion (stagger, duration tokens) · Apple HIG/SwiftUI · web.dev easing · Val Head _Designing Interface Animation_ · easings.net / Penner · CSS-Tricks SVG transform-origin · GSAP CSS plugin docs · After Effects graph-editor critique canon (Mt. Mograph, OlafMotion).
