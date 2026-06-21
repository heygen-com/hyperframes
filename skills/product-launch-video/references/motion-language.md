# Motion language — product-launch visual-design judgment

> The motion-judgment layer for **Step 4 (Visual design)**. You name **each shot's choreography, spring intent, beat rhythm, holds, stillness, and the idle-motion budget** while enriching `STORYBOARD.md` frames; the **frame worker** maps intent to concrete GSAP eases / ms / stagger / code (via `hyperframes-animation`). A good promo feels like one continuous whole — one camera, one spring feel, **every shot directed across its full length** — not a pile of slides that animate once and freeze. You reference motion by **role**, never by curve: eases / durations resolve from `frame.md`'s motion tokens, named `entry` / `emphasis` / `exit` / `drift` (the pack's exact keys may differ); the worker maps the curve. Between-frame **transitions are not yours** — story names `transition_in`, the harness injects it.

## A frame is a shot, not a slide

The single failure that makes a promo read as PowerPoint: a frame whose content **animates in over the first ~0.8s, then freezes** for the rest of its duration while a slow drift plays underneath. The entrance is not the shot — it's the **first beat** of it. You direct the **whole duration**.

Three layers fill a shot, each governed by a different rule:

| Layer                     | What                                                                                             | Rule                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Camera** (macro)        | ONE correlated move on the frame root — slow drift / dolly / push / parallax pan                 | **always on, the whole shot** — this is the "someone is filming this" layer |
| **Choreography** (action) | the beat develops: entrance → mid-shot move (reveal / rearrange / morph / emphasis hit) → settle | **fill the duration** — a shot animated only at entry is a slide            |
| **Idle life** (texture)   | ambient continuation on the 1-2 elements that hold a live slot — breathing, glow, float          | **budgeted** — this is where screensaver lives; cap it                      |

The reconciliation that matters: **mandate choreography, budget idle life.** Purposeful, sequential motion that carries information should fill the shot; ambient, simultaneous motion that carries none should be capped. Many elements each floating independently reads as _screensaver / UI animation_; a shot that only enters then freezes reads as _slideshow_. Avoid both — **one camera move + a directed multi-phase action + 1-2 living elements**, nothing scattered.

## Multi-phase choreography — direct the full shot

Every non-still frame's timeline is choreographed across its length, not front-loaded into the entrance:

```
entrance → development → settle
```

- **entrance** — the beat's primary content arrives (hero `entry` / `heavy`; groups staggered).
- **development (the phase that's usually missing → PPT)** — mid-shot, the content _does something_: a second element reveals, elements rearrange to a new layout, a card morphs to its next state, a count-up runs, an emphasis hit lands on the keyword. This is the motion that separates video from slides.
- **settle** — the shot resolves and holds for its read; the camera + idle life continue underneath (never a hard freeze).

**Architecture:** in hyperframes only the **exit** is forbidden mid-video (the frame unmounts; the harness transition _is_ the exit). Everything _before_ the settle — including rich mid-shot development — is free and seek-safe. Build the development phase; skip only the exit (unless you are the final frame).

When you name a **`blueprint`**, the development phases come from its recipe — write the composition note **shot-by-shot** to match. When you name **no blueprint**, the **≥3 cited effects ARE the phases** — sequence them (one enters, one develops, one emphasizes); **don't fire them all at t=0** (simultaneous entry collapses three phases into one slide).

## Spring intent (by role, not curve)

| Intent     | Feel                                        | Use                                               |
| ---------- | ------------------------------------------- | ------------------------------------------------- |
| **entry**  | confident slight overshoot, settles quickly | primary element entry (default)                   |
| **gentle** | soft slide-in, no overshoot                 | background elements, subtle motion                |
| **snappy** | tight overshoot, nearly instant             | UI elements, small icons, buttons                 |
| **heavy**  | weighted deceleration                       | large images, prototype screenshots, hero visuals |
| **slam**   | bouncy overshoot, intentionally loud        | logo / bell / impact moments                      |

**Consistency:** similar elements share one intent (all icons `snappy`, all hero images `heavy`). Don't invent a unique ease + duration per element.

**Forbidden:** `bounce.out` / `elastic.out` (dated; real objects decelerate, they don't bounce — low overshoot for `entry` is fine, high overshoot only for clearly playful moments); a unique ease+duration per element (visual noise).

## Duration intent

Reference by **tier** ("instant feedback" / "state change" / "layout change" / "entry animation"); the worker maps concrete ms / frames at 30fps. **A single entry should not exceed ~800ms** — for a longer buildup, use multi-element stagger or a development phase, **not** one long tween.

**Phase-to-phase within a shot is swift** — when one element makes way for the next (development), the outgoing move runs ~75% of an entry; arrival is deliberate, hand-off is quick. (The between-frame **exit** is the harness's transition, never your within-shot motion.)

## Stagger cap

When staggering N elements, **total ≤ 500ms** (longer feels dragged):

- **3-7 elements** — normal stagger, total 300-700ms.
- **8+ elements** — tighten per-item delay, or stagger only the first few and enter the rest with the last.
- Never let stagger run past 500ms.

## Beat structure across frames (the cross-frame rhythm)

Rhythmic videos breathe: tension → release → tension → release. A clean reference shape for a ~46s video:

| Phase          | Duration | Rhythm             | Frame type                         |
| -------------- | -------- | ------------------ | ---------------------------------- |
| Slow setup     | 6-10s    | slow build         | hero establish, VO not yet present |
| Fast montage   | 6-10s    | ~2s each           | quick cuts every 1.5-2s            |
| Process reveal | 12-18s   | continuous, no cut | screen recording, real workflow    |
| Closure        | 3-5s     | still, breathable  | logo, URL, CTA                     |

Allocate motion by a frame's energy: **high-energy** (hook, CTA) → faster entry, tighter stagger, `snappy`, busier development; **breathable** (brand reveal, emotional beat) → slower entry, `gentle`, longer hold, minimal development; **data** (stat, feature) → medium rhythm, clean stagger, count-up as the development phase.

## Hold time — read time, not freeze time

After an element enters it must stay long enough to read (the worker maps concrete frames). "Hold" means **don't cut early** — the camera + idle life keep playing underneath; it is never a hard freeze.

| Content                              | Minimum hold |
| ------------------------------------ | ------------ |
| display text (1-3 words)             | ~1s          |
| short sentence                       | ~1.5s        |
| data / statistic                     | ~1.5s        |
| product screenshot                   | ~2s          |
| complex visual (diagram, comparison) | ~2.5s        |
| hero / climax word                   | ~1-1.4s      |

Narration shorter than the needed hold → the frame's `duration` should still give the visual its read time.

## Stillness before climax — the marked exception

Archive signature: a **0.3-0.75s pause** between the major action and its confirmation / result — the silence builds tension before the landing. It lands **because the rest of the video is choreographed** — stillness is a contrast against motion, so it only reads when motion is the baseline (if every frame is already frozen, a pause carries nothing). **Allocate it to only 2-3 frames per video, named in the `## Video direction` block**, where the narration lands a payoff. Stamped on every frame it becomes a tic and flattens the rhythm. Name `stillness-before-climax` in that frame's motion note; even then the camera move continues (still ≠ frozen).

## The idle-life budget — what may move during the hold

The 1-2 elements that keep moving _after_ the development settles. This is the layer that, overdone, becomes screensaver — so it is **capped**, not mandated:

1. **Camera move** — always present (the macro layer above); it alone keeps everything coherently alive.
2. **At most 1-2 secondary live elements** — the ones carrying the beat (hero, CTA). Everything else holds.
3. Prefer **macro move + depth parallax** over many independent floats.

Secondary-slot menu (formulas are the worker's): **multiplicative breathing** (hero — small ±2-5% on final scale) · **glow pulse** (CTA / click target) · **sine float** (one decorative cluster at most) · **rotational drift** (3D cards, hero logo) · **orbit** (surrounding icons; counts as the one decorative cluster) · **halftone breathing** (atmospheric frames).

Multiplicative breathing is the signature for a hero **that holds a live slot** — not stamped on every hero. **Minimum amplitude ±6px or ±2-5% scale** — a 3px micro-float doesn't count; the budget caps how many things idle, it does not license invisible motion.

## Seek-safe motion — intents that don't survive the renderer

The frame is a **paused GSAP timeline seeked frame-by-frame**, so some "continuous" intents from a real-time engine cannot render — **don't name them**:

- **No infinite / forever motion** — "particles loop endlessly," "logo rotates forever," "marquee scrolls on repeat." Idle life is a **finite tween over the hold** (breathe up then back), never `repeat`/`yoyo`.
- **No randomness or wall-clock** — `Math.random` particle fields, `Date.now` drift. Every motion is the same on every render; name deterministic motion only.
- **Entrance + development only** (exit = final frame only) — the cross-frame exit is the harness's transition.
- Express oscillation/breathing as a **bounded finite move**, not a loop; the worker writes it, but don't ask for a loop the timeline can't hold.

## Forbidden — both failure modes

**Slideshow (under-motion):**

- Content animates in, then **freezes** for the rest of the shot (the PPT tell).
- Only the entrance is animated; the remaining duration is a frozen hold under a drift.
- The ≥3 cited effects **all fire at t=0** instead of sequencing into entrance / development / emphasis.
- No mid-shot development on a non-still frame.

**Screensaver (over-motion):**

- **Every element** floating independently; idle motion with no information.
- More than 1-2 elements idling at once; scattered sine floats as the "aliveness."
- A 3px micro-float standing in for real motion.

**Always:**

- `bounce.out` / `elastic.out`; a bespoke ease+duration per element; `repeat` / `yoyo`; all elements entering simultaneously (must stagger or sequence).

## Motion note example

> "Macro: slow dolly-in on the frame root across the whole beat. **Entrance** — hero enters `EASE.entry` (heavy); icons snappy-stagger (5 items, ~400ms). **Development** — icons rearrange into a row, then the result panel reveals beneath them. **Stillness-before-climax 0.6s** (allocated frame; only the dolly continues). **Settle** — result emphasis: text gentle entry + double-layer glow; idle hold with hero breathing ±3% as the one live element."

One line for a single-shot frame; **shot-by-shot when the beat is multi-phase** (always, when you named a `blueprint`). Never concrete ease curves / ms / stagger formulas / JS — the worker writes those.
