# Motion language — the move vocabulary + the motion doctrine + the seek-safe core

> The motion layer for **Step 4 (Visual design)**. When you write a frame's **time-coded shot sequence**, you name each scene's move **inline from the vocabulary below** — a named palette of the moves the golden corpus actually uses. Each move carries the **backing rule id** in this skill's local `../hyperframes-animation/rules/`; cite that id so the move resolves to a real recipe when a **frame worker** implements it in Step 5 (the worker reads the rule body in `../hyperframes-animation/rules/<id>.md` — it reproduces the move, it does not guess from the name). You name motion by **role / move name**, never by raw GSAP curve, ms, or stagger formula — the worker maps the curve. Between-frame **transitions are not yours**: story names `transition_in`, the harness injects it; that injected transition **is** the frame's exit. For cuts a worker builds INSIDE a frame (within-scene swaps, scene-to-scene seams), see the catalog in `cut-catalog.md`.

A good code-change explainer feels like one continuous film — one camera, one motion feel, **smooth and timed to the voiceover** — not a pile of slides that animate once and freeze. In a PR explainer the development often _is_ the reveal: the diff hunk typing in, the before→after morph, the impact stat landing. The doctrine in Part 2 is load-bearing: when in doubt, do what it says.

---

# Part 1 — the move vocabulary

Reach into this palette when naming a scene's motion. Pick the move that matches the beat, name it in the shot sequence, and cite the rule id after `→`. The blueprints (`../hyperframes-animation/blueprints/`) name these same moves in their `rule mapping`; you're drawing from one shared palette. Compose 2–4 across a shot's scenes (entrance → sequential reveal → settle), not all at once.

## Kinetic type

- **hard-cut / flash word-swap** — a word or line replaces the previous one on an instant cut (no fade/roll); the swap itself is the beat. → `discrete-text-sequence`
- **in-place token cycle** — a fixed line holds and only its variable slot changes, token → token → token. → `discrete-text-sequence`
- **per-word staggered reveal** — a phrase assembles word-by-word (or chunk-by-chunk), each landing on its own beat. → `dynamic-content-sequencing`
- **kinetic beat-slam** — short phrases slam in on a shared percussive beat array, each with a distinct entrance, resolving on a locked finale; the recipe for "punchy / rhythmic" taglines. → `kinetic-beat-slam`

## Typewriter

- **type-on with caret** — text types in character-by-character behind a blinking caret. → `discrete-text-sequence` (+ `context-sensitive-cursor` for the caret blink / color)
- **backspace-and-retype** — the line types, deletes the last word(s), and retypes a new one (typo-correction, reframe). → `discrete-text-sequence` (+ `context-sensitive-cursor`)

## Count-up / data

- **value-scaled counter** — a number counts up and its font size grows with the value, so the climb itself escalates. → `counting-dynamic-scale`
- **bars / progress / star wipe** — a number paired with a graphic that fills: bar-height stagger, a progress bar / ring filling, a fractional star-rating wipe. → `stat-bars-and-fills`

## Reveal / decode

- **3D char flip-decode** — characters flip in 3D and resolve from scrambled glyphs to the real text (decryption feel). → `hacker-flip-3d`
- **SVG self-draw** — an outline / icon / ring draws itself stroke-by-stroke. → `svg-path-draw`

## Camera

- **push / focus / drift** — a sequential camera move on the frame root (pull-back → focus → push) plus continuous micro-drift; the cinematic baseline. → `multi-phase-camera`
- **zoom-to-target** — zoom into a non-centered element (scale + counter-translate to keep it framed). → `coordinate-target-zoom`
- **pan / focus-lock** — a virtual camera transforming one `.world` wrapper to pan / zoom / lock onto a region. → `viewport-change`
- **camera-cursor-tracking** — the viewport locks to a moving focal point (a typing cursor), static framing then focal-locked tracking. → `camera-cursor-tracking`

## Layout motion

- **cluster→outward expansion** — elements start clustered at center and expand outward to their final positions in lockstep. → `center-outward-expansion`
- **orbit** — elements flip in from 3D space and settle into a continuous elliptical orbit (entry flips in-place at the orbital position). → `orbit-3d-entry`
- **split-tilt cards** — two cards side-by-side with opposing rotationY tilts, entering from their respective sides (comparison / before-after). → `split-tilt-cards`
- **logo/avatar ring + connectors** — avatars or logos on an elliptical ring with SVG connection lines to a center point, staggered entry. → `avatar-cloud-network`

## Surface / UI

- **3D page-scroll reveal** — a full webpage as a tilted 3D card whose internal content scrolls to reveal specific sections. → `3d-page-scroll`
- **cursor click + ripple** — a cursor moves to a target, depresses with it on click, and emits an expanding ripple. → `cursor-click-ripple`
- **button press** — a tactile press: compression then spring recovery, optional release burst / glow. → `press-release-spring` (or `physics-press-reaction` for a click that compresses cursor + target together)
- **keyword glow** — keywords light up with glow + scale + color on an attack-decay-rest envelope, synced to a word rail. → `asr-keyword-glow`

## Morph / handoff

- **scale-swap** — two elements at the same screen center hand off: the outgoing cluster shrinks + fades as the incoming one arrives. → `scale-swap-transition`
- **card morph-anchor** — a container morphs apparent size + corner radius + surface between two shots, then fades to reveal the real target beneath (HyperFrames uses uniform `scale`, not `width`/`height`). → `card-morph-anchor`

## Seam cuts (worker-built, inside a frame)

The velocity-matched cuts a worker authors between a frame's own Scenes. Name the seam in the shot sequence; the recipe is in the catalog, not a single `../hyperframes-animation/rules/` id.

- **zoom-through / inverse zoom-through** — a within-scene swap on the Z-axis; forward reads "progressing through", inverse reads "arriving at" (payoff). → `cut-catalog.md`
- **cut-the-curve** — a scene-to-scene cut where both sides move the same direction at matched velocity. → `cut-catalog.md`
- **waterfall cut** — cut-the-curve at word granularity, a wave across a text-to-text seam. → `cut-catalog.md`

## Emphasis / marker

- **highlight / circle / burst / scribble** — a marker-drawn emphasis on a word or element: yellow highlight sweep, hand-drawn circle, radiating burst, scribble, or rough sketch-outline. → `css-marker-patterns`

## Aliveness during a hold (use sparingly — see Part 2)

- **subtle jitter** — the sanctioned way to keep a settled frame alive: a small, low-amplitude positional/scale jitter on the held element. The motion-graphics trick that reads "alive" without reading "weak." → `sine-wave-loop` (low-amplitude register)
- **live SVG internals** — internal SVG parts move so an icon feels alive (rotating hands, oscillating blades, pulsing dots, dash-flow); fine because it's the subject doing something, not a card breathing. → `svg-icon-enrichment`
- **finite bounded ambient** — a single bounded breathe/drift on ONE held hero, only when genuinely needed; de-emphasized — prefer sequential reveal or jitter first. → `sine-wave-loop`

## The added moves — now backed by local rules

Five moves the golden corpus needs were added to this skill's `../hyperframes-animation/rules/`, rounding out the vocabulary above:

- **depth-of-field / selective-blur** — blur the off-focus subset to spotlight the focal element → `depth-of-field-blur`
- **motion-blur streak** — directional velocity blur on a fast fly-in / camera push-through → `motion-blur-streak`
- **3D depth scatter-assemble** — glyphs/elements scatter into a tumbling 3D cloud, then reassemble → `depth-scatter-assemble`
- **spring-pop entrance** — the canonical entrance pop; default to a smooth long-tail settle, overshoot only when explicitly playful → `spring-pop-entrance`
- **ambient glow / bloom** — un-triggered soft glow blooming behind a static hero → `ambient-glow-bloom`

---

# Part 2 — the motion doctrine (load-bearing)

These four rules are the difference between a clip that reads as a serious code-change explainer and one that reads as an agent-made PowerPoint. Follow them as written.

## 1. Smooth beats bouncy — `power3` is the default

Elements should use **long-tail decel curves that let them settle smoothly. `power3` is enough in most cases.** No bouncy, no overshoot, no `back.out` / `bounce.out` / `elastic.out` as a default.

Bouncy is the **#1 instant turn-off** in user-made Remotion / HyperFrames videos, and the agent almost never gets it right — it thinks bouncy adds emphasis, but it buys that emphasis at the cost of cleanliness. The serious motion-design shops feel the same. **Smooth always wins.** Overshoot is demoted to a **rare, explicitly-playful exception** (a consumer/fun logo slam, a deliberate bell-hit) — never the house style. Name the intent as a long-tail settle; the worker maps `power3` (or `expo.out` on a fast arrival). See `../hyperframes-animation/rules/spring-pop-entrance.md` — it now leads with the smooth settle. (The exact form of that settle is a critically-damped spring; the worker has a baked, seek-safe `springEase` — ζ=1 — in `../hyperframes-animation/adapters/gsap-easing-and-stagger.md` → Spring Eases for when the settle is the hero. Real physics, same doctrine — not a license for bounce.)

## 2. Sequential reveal in the back ~50%, timed to the voiceover

This is the anti-PowerPoint mechanism — sharper than "put development in the middle."

- **Don't dump everything on screen in the first ~25%** of the scene. Rushing all content in up front is exactly what forces the slideshow feel.
- **Reveal each piece — a line, a card, even an h1 — when the voiceover mentions it**, sequencing reveals across the **later ~50%** of the scene. Same amount of agent work, but the cut becomes coherent and gains rhythm.
- **Less is more.** Fewer things on screen, each arriving on its VO beat, beats a full canvas that animated once and froze.

Practically: a frame's shot sequence front-loads almost nothing — the entrance carries only what the VO is saying at t=0, and the rest of the elements wait in the timeline for their spoken cue. A reveal maps onto a development-class move from Part 1 (`per-word staggered reveal`, `cluster→outward expansion`, a `count-up`, an `asr-keyword-glow` synced to the word rail).

## 3. No lazy breathing, no bad pan/push — "no motion over bad motion"

The agent's two reflexive ways to fake "aliveness" both read cheap:

- **No lazy breathing.** Scaling cards/text up and down in a circular loop to look "alive" is the cheap tell. Don't reach for it.
- **No bad slow pan / push in the back half.** A slow pan or push on elements in the later ~50% of a scene **disrupts the viewer's sightline and causes eye discomfort** — it actively makes the frame worse, not better.

The fix for both is the same: **stagger element reveals in time with the script** (rule 2). And the governing principle: **"I'd rather have NO motion than BAD motion."** A held, still frame is better than a frame kept "alive" by breathing or a drifting camera. The **only sanctioned aliveness** during a hold is **subtle jitter** — a small low-amplitude jitter that keeps a frame from feeling dead without looking weak (it's in Claude videos now). Everything else holds.

## 4. Internal seams are velocity-matched cuts

When a frame has an internal seam — a within-scene swap, a Scene-to-Scene cut, a text-to-text line change — make it a **velocity-matched cut**, not a hard slideshow cut: cut at peak velocity, match direction and speed on both sides. The catalog (the four techniques, the blur logic, and which to use when) is `cut-catalog.md`; the moves are listed under **Seam cuts** in Part 1.

## One-line summary

Smooth long-tail (`power3`) over bouncy; reveal sequentially in the back ~50% timed to the VO (not dumped in the first 25%); no lazy breathing and no bad slow pan/push — prefer stillness, with subtle jitter as the only aliveness; cut at peak velocity with matched direction/speed (→ `cut-catalog.md`).

---

# Part 3 — the seek-safe core (hard rules)

The frame is a **paused GSAP timeline seeked frame-by-frame**, so some "continuous" intents from a real-time engine can't render — don't name them. These are non-negotiable regardless of doctrine.

- **No infinite / forever motion** — "particles loop endlessly," "logo rotates forever," "marquee on repeat." Any aliveness (the subtle jitter, a live SVG internal, a needed bounded ambient) is a **finite tween over the hold**, never `repeat` / `yoyo`.
- **No randomness or wall-clock** — no `Math.random` particle fields, no `Date.now` drift. Every render must be identical; name deterministic motion only (stagger and any variation derive from the element index).
- **Entrances use `fromTo`** — state the from-state explicitly so a seek to `t=0` lands the element correctly; never rely on a CSS-hidden start (it renders visible before the tween claims it, and flickers under seek).
- **No CSS `transition` / `@keyframes` for motion** — CSS animation runs on the browser clock, independent of the HF seek clock; it desyncs and flickers. Drive all motion inside the paused GSAP timeline.
- **Entrance + sequential reveal only — no mid-video exit.** The frame unmounts via the harness transition; that injected `transition_in` **is** the exit. Exit motion belongs only to the final frame. (Worker-built seam cuts in `cut-catalog.md` are within-frame, not the frame's exit.)

## Forbidden — the failure modes

**Slideshow (the primary failure):** everything dumped on screen in the first ~25%; content enters then freezes; nothing revealed on its VO cue. Fix with rule 2 (sequential reveal timed to the VO).

**Cheap aliveness:** circular breathing as "life"; a slow pan/push in the back half disrupting the eye; many elements floating independently as "motion." Fix with rule 3 (stillness + subtle jitter only).

**Bouncy:** `back.out` / `bounce.out` / `elastic.out` as the default entrance; hand-keyed overshoot. Fix with rule 1 (`power3` long-tail; overshoot only when explicitly playful).

**Always:** no `repeat` / `yoyo`; no `Math.random` / `Date.now`; no all-elements-entering-simultaneously (sequence or stagger).

## Naming motion in a shot — example

> Scene 1 (0.0–1.0s): solid field; hero headline enters via **per-word staggered reveal** (`dynamic-content-sequencing`) on a smooth long-tail settle (`power3`); slow **push** on the root (`multi-phase-camera`) holds steady — no back-half re-push.
> Scene 2 (1.0–3.0s): as the VO names each changed file, five file chips reveal **sequentially** via **cluster→outward expansion** (`center-outward-expansion`), then a **value-scaled counter** (`counting-dynamic-scale`) ticks the +/− line total up beneath them — the back-half reveal, timed to the script, not dumped at t=0.
> Scene 3 (3.0–4.2s): hold on the result; **keyword glow** (`asr-keyword-glow`) lands on the payoff word as the VO says it; settles and holds still — at most **subtle jitter** (`sine-wave-loop`, low amplitude) keeps it alive; no breathing, no drift.

Name the move + its rule id (or `cut-catalog.md` for a seam cut) per scene; let the worker pick curves, ms, and stagger — defaulting to `power3`.
