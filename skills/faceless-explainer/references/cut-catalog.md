# Cut catalog — within-frame seams (worker-built)

> **A worker build-recipe (Step 5) — the sibling of `../hyperframes-animation/rules/`, not a second motion doc.** These are within-frame cuts the **frame worker builds INSIDE its own composition** (Z-scale + blur + opacity tweens, or per-word x-staggers, all on the frame's own paused GSAP timeline). They are **not** the between-frame transition: story owns that via `transition_in`, which the harness's injector stamps from a **separate registry vocabulary** (`crossfade` / `blur-crossfade` / `push-slide` / `zoom-through` / `squeeze`) — the catalog names here (**cut-the-curve / inverse-zoom / waterfall**) are **not** valid `transition_in` values. Use this catalog when a frame's shot sequence has an internal seam — a within-scene text/element swap, a **Scene-to-Scene** cut (a `Scene` is a time window WITHIN one frame, **not** a frame-to-frame boundary), or a text-to-text line change — and you want it to read as one continuous move instead of a hard slideshow cut. (`zoom-through` lives in both worlds: a whole-frame wrapper transition in the registry, an element-level Z-cut here — same idea, different scope.)

Four techniques that create depth and continuity:

1. **Zoom-Through** — within-scene text swaps, Z-axis, moving TOWARD the viewer
2. **Inverse Zoom-Through** — Z-axis swaps moving AWAY from the viewer
3. **Cut the Curve** — between-scene transitions on x/y
4. **Waterfall Cut** — word-by-word cut-the-curve with staggered exits and entries

All four are the same underlying principle: **cut at peak velocity, match direction and
speed on both sides of the cut.** The differences are axis, scope, and granularity.

**Choosing which at a seam:** for an UNFINISHED phrase (building one larger idea across
several visually distinct scenes that still approach the same point — multi-line text, a
run of consecutive cards) use **cut-the-curve** / **waterfall**. For a STATE CHANGE (turning
to a NEW part of the video — most often hook → context, between two distinct chapters) use
**zoom-through**, and **inverse zoom-through** for an arrival / payoff beat. Chain these so
the frame's internal seams feel like one camera moving through the content.

---

## Blur Logic (applies to all Z-axis variants)

Blur sells the speed at the cut, but it must scale with the SUBJECT SIZE:

| Subject                                                | Peak blur   | Why                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text-scale (headline, line, word group)                | **10px**    | At 20px text smears into illegibility — the eye loses the word it was tracking and the cut reads as a glitch, not speed. At 20px letterforms go mushy mid-cut; 10px keeps them readable. |
| Full-frame surface (terminal window, card, screenshot) | **18–20px** | Big surfaces have edges and texture that survive heavy blur; lighter blur on a full-frame move reads as a rendering hiccup instead of motion.                                            |

Both sides of a cut use the SAME peak blur — the value must match at the swap frame.
Apply blur to the WRAPPER, never to individual children.

---

## 1. Zoom-Through (forward)

### The Problem

Text enters, holds, exits. Then next text enters, holds, exits. Each text block is
independent — no depth, no continuity. The video feels like a slideshow.

### The Principle

A velocity-matched cut on the Z-axis. You **never see both texts at the same time.** The
outgoing text scales toward the viewer (accelerating), blur and opacity peak at the cut
point hiding a hard swap, and the incoming text continues scaling up from behind
(decelerating into the focal plane). One continuous forward motion, two different texts.

### The Three Phases

**Phase 1: Exit** — text accelerates forward (toward viewer)

- Scale: `1.0 -> 1.2`, Blur: `0px -> 10px` (text-scale; see Blur Logic), Opacity: `1.0 -> 0.15`
- Scale/blur easing: `power3.in` (steep acceleration)
- Opacity easing: `none` (linear — even dimming, separated from scale)
- Duration: 0.2s

**Phase 2: Hard cut** at peak velocity + peak blur

- Outgoing: `opacity: 0` (instant via `tl.set`)
- Incoming: `opacity: 0.15, scale: 0.75, blur: 10px` (instant via `tl.set`)
- All properties match at the cut: blur, opacity, and scale DIRECTION (both scaling up)

**Phase 3: Entry** — text continues forward (growing into focal plane)

- Scale: `0.75 -> 1.0`, Blur: `10px -> 0px`, Opacity: `0.15 -> 1.0`
- Easing: `expo.out` (steep initial burst matching exit velocity, long settle)
- Duration: 0.5s

### Why Opacity Must Be Separate on Exit

Scale uses `power3.in` but that keeps opacity near 1.0 for most of the tween. Splitting
opacity to its own tween with linear ease makes the dimming even. On entry, all properties
can share `expo.out`.

---

## 2. Inverse Zoom-Through (backward)

The mirror: the camera "pulls back" instead of pushing through. The outgoing element
RECEDES away from the viewer; the incoming element arrives OVERSIZED (as if it had been
just behind the camera) and retracts into the focal plane. Both move in the shrinking
direction — same-direction rule preserved, just reversed.

**When to use over the forward variant:** arrival beats. The incoming element lands with
presence because it comes from larger-than-frame — right for a payoff line ("That changes
today."), a giant reply, or a held end-state. Forward zoom-through reads as _progressing
through_ content; inverse reads as _arriving at_ content.

### The Three Phases

**Phase 1: Exit** — element recedes (away from viewer)

- Scale: `1.0 -> 0.8`, Blur: `0px -> 10px` (text-scale)
- Scale/blur easing: `power3.in`; Opacity: `1.0 -> 0.15` on `none` (separate tween)
- Duration: 0.2s

**Phase 2: Hard cut**

- Outgoing: `opacity: 0` via `tl.set`
- Incoming: `opacity: 0.15, scale: 1.25, blur: 10px` via `tl.set`

**Phase 3: Entry** — incoming retracts into place

- Scale: `1.25 -> 1.0`, Blur: `10px -> 0px`, Opacity: `0.15 -> 1.0`
- Easing: `expo.out`, Duration: 0.5s

---

## 3. Cut the Curve (Scene Transitions)

### The Principle

Use cut-the-curve for **all scene-to-scene transitions** on x and y axes. The outgoing
scene's hero element accelerates in one direction, the cut lands mid-motion, and the
incoming scene's hero element continues moving in the **same direction** and decelerates.
Nothing exits fully off-screen and nothing enters from fully off-screen — **speed plus
opacity fading trick the eye**; the partial moves are enough.

### Same Path, Same Direction

If Scene A's hero slides left, Scene B's hero enters from the right and continues sliding
left. Both move leftward. One continuous motion.

| Direction | Scene A exit   | Scene B entry start | Scene B entry end |
| --------- | -------------- | ------------------- | ----------------- |
| Leftward  | `x: 0 -> -230` | `x: +230`           | `x: 0`            |
| Rightward | `x: 0 -> +230` | `x: -230`           | `x: 0`            |
| Upward    | `y: 0 -> -230` | `y: +230`           | `y: 0`            |
| Downward  | `y: 0 -> +230` | `y: -230`           | `y: 0`            |

### Velocity matching via mirrored eases

The cleanest match: exit `power4.in` and entry `power4.out` with the SAME distance and
duration — mathematically the two halves of one `power4.inOut` composite, so the entering
element picks up at exactly the 50% point of the notional path at identical velocity
(e.g. 230px / 0.3s ≈ 3,070 px/s at the cut on both sides).

The fade trick: the exit's opacity completes at ~25–30% of its travel (fade duration
≈ 0.18–0.3s vs motion 0.3–0.34s) — the element vanishes while still visibly accelerating,
and nothing has to reach the frame edge. Entry fades IN fast from ~0.35 under its
deceleration. Time the LAST fading element to die right at the hard cut — gaps where
nothing is moving read as awkward dead air.

### Rules

- Use cut-the-curve for all scene transitions — it's the default, not an accent
- Same direction on both sides; mirrored `.in`/`.out` eases, same distance + duration
- Exit duration short (0.2–0.4s), entry duration >= exit duration
- Partial travel + fade, never full off-screen moves

---

## 4. Waterfall Cut (word-by-word cut-the-curve)

Cut-the-curve at WORD granularity — the strongest version of the leftward cut for
text-to-text seams. Each word of the outgoing line ramps out on its own pronounced curve;
each word of the incoming line cascades in mid-flight. The stagger turns the cut into a
wave the eye rides across the seam.

### Exit (per word)

- Motion: `x: 0 -> -230` over 0.34s on **power4.in** — a much more pronounced ramp than
  the usual power2: the word barely creeps, then RIPS
- Fade: `opacity -> 0` over 0.18s (separate tween, `power1.in`) — completes when the word
  is only ~25–30% into its travel
- Stagger: reading order, ~0.022s per word, timed so the LAST word finishes fading right
  at the hard cut

### Entry (per word)

- `fromTo x: +230 -> 0, opacity: 0.35 -> 1` over 0.3s on **power4.out** — the mirrored
  back half of the composite; every word ignites already moving at matched velocity
- Waterfall stagger with SHRINKING gaps (start 0.05s, multiply by ~0.84 per word) so the
  cascade accelerates across the line — the cascade should speed up word over word, not run
  at a flat per-word delay
- Pre-set all words to `x: +230, opacity: 0` at build time — `immediateRender: false`
  alone leaves un-started words sitting visible at rest during the stagger window

### Whole-line variant

A single-line beat (e.g. a big intro line) exits as one group with the same pronounced
ramp, but stretch its fade to ~0.3s ending ~0.02s before the cut — a lone element that
fades early leaves dead air that a word cascade would have covered.

---

## Choosing a Variant

|                | Zoom-Through                | Inverse Zoom                | Cut the Curve     | Waterfall Cut             |
| -------------- | --------------------------- | --------------------------- | ----------------- | ------------------------- |
| Scope          | Within-scene text swap      | Arrival/payoff beat         | Between scenes    | Text-to-text seam         |
| Axis           | Z, toward viewer            | Z, away from viewer         | X / Y             | X, per-word               |
| Peak blur      | 10px text / 20px full-frame | 10px text / 20px full-frame | none required     | none (fade does the work) |
| Opacity at cut | 0.15                        | 0.15                        | exit faded by cut | last word dies at cut     |
| Feel           | progressing through         | arriving at                 | carried sideways  | a wave across the seam    |

---

## Anti-Patterns

| Don't                                    | Why                                         | Instead                                                |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Two texts visible during a zoom-through  | Overlapping text breaks the Z-axis illusion | Hard cut at blur peak, one text at a time              |
| 20px blur on text-scale subjects         | Letterforms smear; reads as a glitch        | 10px for text, 18–20px only full-frame                 |
| Elements on different paths across a cut | Eye tracks one direction, cut goes another  | Same property, same direction                          |
| Mismatched blur/opacity at the swap      | Visible flash or brightness jump            | Identical values at the cut frame                      |
| Gentle easing on entry (`power2.out`)    | Entry velocity feels slower than exit       | Mirror the exit: `power4.out` / `expo.out`             |
| Full off-screen exits / entries          | Wastes time and breaks the speed illusion   | Partial travel + early fade                            |
| Lone element fading long before its cut  | Dead air at the seam                        | Fade ends ~0.02s before the cut, or use a word cascade |
| Zoom-through on body text                | Small text at 0.75 scale is unreadable      | Only headlines and short phrases                       |
| Scene cuts without cut-the-curve         | Static cuts feel like a slideshow           | Cut-the-curve is the default                           |
