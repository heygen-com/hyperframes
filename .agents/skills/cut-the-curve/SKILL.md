---
name: cut-the-curve
description: "The technique catalog: five velocity-matched SEAMS (zoom-through, INVERSE zoom-through, cut-the-curve, waterfall cut, rack-focus blur-cut) plus the two in-scene techniques — waterfall ENTRY (staggered arrival cascades for title cards / segment openers) and the nudge curve (slow-fast-slow three-phase group slides). Covers partial-travel (~12% of frame) velocity matching via mirrored power4 eases, the Z scale-sign rule, size-scaled blur (10px text / 18-20px full-frame), word-by-word staggered cuts, cascade pacing by element weight, and the 10/65/25 slide ratio. Read before authoring any transition, text-beat handoff, kinetic text entry, or group reposition. [depth, zoom, inverse-zoom, scale-sign, mirrored-zoom, rack-focus, pacing, velocity, cut-the-curve, waterfall, stagger, cascade, kinetic-text, title-card, segment-opener, nudge, slide, easing, group-motion, z-depth, motion-graphics, cinematic, transition, blur, directional-continuity]"
---

# Cut the Curve — the technique catalog

Five SEAM techniques, one principle: **cut at peak velocity, match direction and speed
on both sides of the cut** — plus the two in-scene techniques (§6 arrivals, §7 slides).
The seam LAW — vector law, the current, the ledger, the Seam Gate — lives in
`motion-doctrine`; read it first. This skill is the parameters and mechanics.
All GSAP code templates (worker + registry): `examples/gsap-implementation.md`.

## Catalog

| #   | Technique                  | Scope                          | Axis                | Use for                                                |
| --- | -------------------------- | ------------------------------ | ------------------- | ------------------------------------------------------ |
| 1   | **Zoom-Through** (forward) | Within-scene text swap         | Z, toward viewer    | progressing deeper into the same thought               |
| 2   | **Inverse Zoom-Through**   | Arrival / payoff beat          | Z, away from viewer | something bigger lands                                 |
| 3   | **Cut the Curve**          | Between scenes                 | X / Y               | the default boundary, the film's current               |
| 4   | **Waterfall Cut**          | Text-to-text seam              | X, per-word         | word-level handoff between big-text beats              |
| 5   | **Rack-Focus Blur-Cut**    | Same-surface state swap        | X / Y / Z           | the one cut you want SEEN — a DSLR focus-pull flourish |
| 6   | **Waterfall Entry**        | In-scene ARRIVAL (no seam)     | Y, from below       | title cards, segment openers, list intros              |
| 7   | **Nudge Curve**            | In-scene group slide (no seam) | X / Y               | repositioning a composed group to make room            |

## Z direction is a sign

"Same axis" is not enough on Z — the sign of d(scale)/dt must match across the cut:

| Z vector       | Exit scale          | Entry scale          | Variant              |
| -------------- | ------------------- | -------------------- | -------------------- |
| Push (forward) | growing `1 → 1.2`   | growing `0.75 → 1`   | zoom-through         |
| Pull (back)    | shrinking `1 → 0.8` | shrinking `1.25 → 1` | inverse zoom-through |

Banned mirrors: a receding exit answered by a grow-from-small entry (pull flips to push —
the common one, since grow-from-small is the default element entrance), and a push exit
answered by an oversized retraction. This binds the incoming scene's OWN entrances during
the seam window (cut + ~0.5s), not just the wrapper tween: hold the incoming frame
composed, or author its entrance to match the sign. Verify per Seam Gate rule 7.

## Blur logic (all Z variants)

| Subject                                       | Peak blur   | Why                                                            |
| --------------------------------------------- | ----------- | -------------------------------------------------------------- |
| Text-scale (headline, word group)             | **10px**    | 20px smears letterforms — the cut reads as a glitch, not speed |
| Full-frame surface (window, card, screenshot) | **18–20px** | lighter blur on a big surface reads as a rendering hiccup      |

Same peak blur on both sides at the swap frame. Blur the WRAPPER, never children.

---

## 1. Zoom-Through (forward)

Z-axis velocity-matched cut; **never both texts visible.** Everything GROWS: the outgoing
text accelerates toward camera, a hard swap hides at peak blur, the incoming text keeps
growing into the focal plane. Headlines and short phrases only. Total ≈ 0.4s.

| Phase          | Scale    | Blur     | Opacity           | Ease                                       | Duration |
| -------------- | -------- | -------- | ----------------- | ------------------------------------------ | -------- |
| Exit           | 1 → 1.2  | 0 → 10px | 1 → 0.15          | power3.in (opacity: separate `none` tween) | 0.2s     |
| Cut (`tl.set`) | in: 0.75 | 10px     | out: 0 / in: 0.15 | —                                          | —        |
| Entry          | 0.75 → 1 | 10 → 0px | 0.15 → 1          | expo.out                                   | 0.5s     |

Exit opacity MUST be its own linear tween — `power3.in` holds opacity near 1 too long.
On entry all properties share `expo.out`.

## 2. Inverse Zoom-Through (backward)

The pull-back mirror: the outgoing element RECEDES; the incoming arrives OVERSIZED (as if
just behind camera) and retracts into the focal plane. Everything SHRINKS. Spend on
ARRIVAL/payoff beats — a payoff line, a giant reply, a held end-state — never ordinary
boundaries. Total ≈ 0.7s (30% exit / 70% entry).

| Phase          | Scale    | Blur     | Opacity           | Ease                                       | Duration |
| -------------- | -------- | -------- | ----------------- | ------------------------------------------ | -------- |
| Exit           | 1 → 0.8  | 0 → 10px | 1 → 0.15          | power3.in (opacity: separate `none` tween) | ~0.2s    |
| Cut (`tl.set`) | in: 1.25 | 10px     | out: 0 / in: 0.15 | —                                          | —        |
| Entry          | 1.25 → 1 | 10 → 0px | 0.15 → 1          | expo.out                                   | ~0.5s    |

Blur is 10px text-scale; 18–20px only when both sides are full-bleed surfaces.

**Sign discipline:** the incoming scene arrives as a composed frame inside the retracting
wrapper — no grow-from-small intro in the seam window. Staged entrances happen after the
retraction settles, or start ≥1 and retract.

## 3. Cut the Curve (default scene boundary)

X/Y velocity-matched cut — the default for ALL scene-to-scene boundaries, in the film's
current, not an accent. The outgoing hero accelerates in one direction, the cut lands
mid-motion, the incoming hero continues the SAME direction and decelerates. Total ≈ 0.6s;
directions LEFT / RIGHT / UP / DOWN (default LEFT).

**Partial travel:** ~12% of frame (≈230px at 1920) — never full off-screen moves.

| Direction | Exit          | Entry start → end |
| --------- | ------------- | ----------------- |
| Leftward  | `x: 0 → −230` | `x: +230 → 0`     |
| Rightward | `x: 0 → +230` | `x: −230 → 0`     |
| Upward    | `y: 0 → −230` | `y: +230 → 0`     |
| Downward  | `y: 0 → +230` | `y: −230 → 0`     |

Mechanics:

- **Mirrored eases:** exit `power4.in` + entry `power4.out`, same distance and duration —
  the two halves of one `power4.inOut`, so velocity matches exactly at the cut.
- **The fade trick:** exit opacity completes at ~25–30% of its travel (fade ≈ 0.18–0.3s
  vs motion 0.3–0.34s); entry ignites at ~0.35 opacity mid-path. Time the last fading
  element to die right at the cut — a gap where nothing moves reads as dead air.
- Exit 0.2–0.4s; entry ≥ exit. Optional blur 8–10px.
- **Stage ground:** `#root` must be opaque
  (`background: var(--canvas-deep, var(--canvas, #000))`) — the mid-window cut opens a
  summed-opacity < 1 window that flashes white otherwise (see `seam-craft`).

`push-slide` exists but violates partial-travel and mid-motion phase; prefer cut-the-curve.

## 4. Waterfall Cut (word-by-word cut-the-curve)

Cut-the-curve at WORD granularity — the strongest leftward cut for text-to-text seams.
Outgoing words ramp out on their own curves; incoming words cascade in mid-flight — a
wave the eye rides across the seam.

**Scope:** worker-authored inside one multi-beat comp (stacked full-frame `.beat` layers),
NOT a registry/injector type — it tweens word spans, not clip wrappers. The boundary into
and out of the text-beat block still gets a normal registry transition. Does not count
against the 2–3 transition budget.

| Parameter           | Value                 | Why                                         |
| ------------------- | --------------------- | ------------------------------------------- |
| Travel              | ±230px (~12% frame)   | partial travel + velocity > full-frame push |
| Exit                | 0.34s `power4.in`     | the acceleration IS the cut                 |
| Exit fade           | 0.18s, starts with x  | word gone by ~25–30% of travel — no smear   |
| Exit stagger        | +0.022s reading order | the line peels, not a block slide           |
| Entry               | 0.3s `power4.out`     | back half of the composite — velocity match |
| Entry start opacity | 0.35                  | mid-path ignition; binary 0→1 pops          |
| Entry gaps          | 0.05s × 0.84 decay    | accelerating cascade, resolves composed     |

Rules:

- One direction per chain, riding the current. Inverse zoom is the chain's ARRIVAL beat only.
- Pre-set all words to `x: +230, opacity: 0` at build time — `immediateRender: false`
  alone leaves un-started words visible at rest.
- A short first beat may exit whole-line: its fade ends ~0.02s before the cut so it is
  still streaking when the next words ignite — no dead gap.
- Transform/opacity only (seek-safe); opaque stage ground applies.

## 5. Rack-Focus Blur-Cut (the visible cut)

The one variant where the cut is SEEN: a defocus blur SPIKE hides a single-frame hard
swap — a handheld-DSLR focus-pull. Use as an occasional flourish for a state swap of the
SAME surface within one visual theme; never the default boundary.

Differences from the others: outgoing stays FULLY OPAQUE until the cut (the blur hides
the swap — no early fade); eases `power2.in` / `power2.out` (soft optics, not momentum).

Rules:

- Fire only at a narrative beat, ≤ once per ~8s; never mid-caption or during a hold.
- Cut at PEAK blur (≥6px; peak 8–12px, ≤16–18px max) — swapping on the way up shows the cut.
- A subtle scale (~1.06 lens-breathing) sells it as optics.
- Same direction on both sides — the vector law still holds. Entry ≥ exit duration.
- Blur the wrapper; never blur + opacity in one tween on one element (headless
  compositing bug); never blur a `<video>` directly (wrap it).

---

## 6. Waterfall Entry (in-scene arrival — not a seam)

Staggered ARRIVAL cascade: words/elements whip in from below (one consistent direction),
each starting before the previous settles — an accelerating wave that resolves into a
composed layout. Title cards, segment openers, list/feature intros. The seam sibling is
§4; do not mix their rules:

|               | §6 Entry (arrival)                            | §4 Waterfall Cut (seam)                                   |
| ------------- | --------------------------------------------- | --------------------------------------------------------- |
| Opacity       | BINARY 0→1 via `tl.set` at entry — never fade | ignites at 0.35 mid-path — the fade IS the velocity trick |
| Axis default  | Y, from below                                 | X, riding the current                                     |
| Outgoing side | none                                          | words ramp out on mirrored power4.in                      |

Choreography:

- **Overlap, don't queue** — next element starts within ±2 frames of the previous
  settling; gaps SHRINK across the cascade; the last element snaps.
- **Velocity varies by weight** — heavy/anchor elements travel further and longer;
  light words/punctuation snap in tight:

| Parameter | Anchor/heavy | Normal word | Light/punctuation |
| --------- | ------------ | ----------- | ----------------- |
| Y offset  | 60–80px      | 40–50px     | 30–48px           |
| Duration  | 0.16–0.20s   | 0.13–0.16s  | 0.10–0.13s        |
| Overlap   | 0–2f gap     | 1f overlap  | 1–2f overlap      |

- Ease `power4.out` (expo.out for extra snap); never `.inOut` on an entry.
- One direction per cascade.
- Split the FINAL word into fragments to extend the climax; fragments travel further.
- Post-settle, the group usually slides to make room for the next beat — that's §7.

## 7. Nudge Curve (in-scene group slide — not a seam)

Slow-fast-slow repositioning of a composed group (word rows, card stacks, lists) to
reveal content or make room. No single built-in ease produces it — `power4.inOut`
smacks to a stop. Chain three tweens on one property:

| Phase     | Ease            | Distance | Time | Feel                                     |
| --------- | --------------- | -------- | ---- | ---------------------------------------- |
| 1 ramp-in | `power3.in`     | ~10%     | ~20% | barely moves — motion registers, no jolt |
| 2 burst   | `none` (linear) | ~65%     | ~18% | ~2× average px/frame — purposeful        |
| 3 tail    | `power4.out`    | ~25%     | ~62% | decaying creep to rest — kills the smack |

Rules:

- The tail is ≥3× the ramp-in in TIME. If it still smacks: extend the tail's time (not
  distance) or use `power5.out`.
- Phase 2 stays linear — easing it loses the burst contrast.
- Reveal new content DURING phase 2 — the burst masks its appearance.
- Same ratios vertical; scale distances proportionally, keep the time ratios.

---

## Choosing a Variant

|               | Zoom-Through                 | Inverse Zoom                 | Cut the Curve          | Waterfall Cut          |
| ------------- | ---------------------------- | ---------------------------- | ---------------------- | ---------------------- |
| Scope         | Within-scene text swap       | Arrival/payoff beat          | Between scenes         | Text-to-text seam      |
| Z sign / axis | growing (push)               | shrinking (pull)             | X / Y                  | X, per-word            |
| Travel/scale  | 1→1.2, then 0.75→1           | 1→0.8, then 1.25→1           | ±230px                 | ±230px                 |
| Peak blur     | 10px text / 18–20 full-frame | 10px text / 18–20 full-frame | 8–10px optional        | none                   |
| Eases         | power3.in / expo.out         | power3.in / expo.out         | power4.in / power4.out | power4.in / power4.out |
| Feel          | progressing through          | arriving at                  | carried sideways       | a wave across the seam |

## Anti-Patterns

| Don't                                                                      | Instead                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Two texts visible during a zoom-through                                    | Hard cut at blur peak, one text at a time                                         |
| 20px blur on text-scale subjects                                           | 10px text; 18–20px only full-frame                                                |
| Inverse-zoom exit → grow-from-small entry (or push → oversized retraction) | Match the scale-velocity SIGN; verify at cut±0.1s                                 |
| Incoming comp's own scale-up intro under a Z-seam wrapper tween            | Arrive composed; stage entrances after the seam settles or match the sign         |
| Mismatched blur/opacity at the swap                                        | Identical values at the cut frame                                                 |
| Gentle entry easing (`power2.out`)                                         | Mirror the exit: `power4.out` / `expo.out`                                        |
| Full off-screen exits/entries                                              | Partial travel (~12%) + early fade                                                |
| `.inOut` eases on either side of a cut                                     | Mirrored `power4.in` / `power4.out`                                               |
| Lone element fading long before its cut                                    | Fade ends ~0.02s before the cut, or word-cascade                                  |
| Equal gaps across a waterfall cascade                                      | Shrink gaps ×0.84 per word                                                        |
| Zoom-through on body text                                                  | Headlines and short phrases only                                                  |
| Scene cuts without cut-the-curve                                           | It is the default boundary                                                        |
| Consecutive boundaries in opposing directions                              | One current; reserved vectors spent on meaning                                    |
| Unpainted `#root` behind a mid-window cut                                  | Opaque stage ground                                                               |
| Queued entries (each waits for the previous to settle)                     | Overlap ±1–2 frames — the cascade is a wave, not a queue                          |
| Same offset/duration for every cascade element                             | Vary by weight: anchors travel further, punctuation snaps                         |
| Gradual opacity fade on a §6 arrival                                       | Binary 0→1 via `tl.set` — fading fights the snap (seam cuts fade; arrivals don't) |
| Single ease for a group slide (`power4.inOut`, `slow()`)                   | The §7 three-phase chain                                                          |
| Nudge tail shorter than 3× the ramp-in                                     | Extend the tail's TIME, not its distance                                          |

## Code

All GSAP templates — worker-authored versions, registry `gsap_template`s, the combined
cut-the-curve + zoom, waterfall DOM/CSS/JS, rack-focus — live in
`examples/gsap-implementation.md`.
