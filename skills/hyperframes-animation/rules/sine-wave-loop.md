---
name: sine-wave-loop
description: Bounded sine-driven idle — subtle jitter or a single genuinely-needed bounded ambient breath on a held element. De-emphasized: circular breathing as "aliveness" is cheap; prefer sequential reveal timed to the VO, then subtle jitter, before reaching here.
metadata:
  tags: idle, jitter, bounded-ambient, sine, trigonometry, low-amplitude, post-entry
---

# Sine Wave Loop (subtle jitter / bounded ambient)

> **Reach for this last.** Per the motion doctrine (`references/motion-language.md`): circular breathing — scaling text/cards up and down to look "alive" — is cheap, the agent's reflexive cheat, and reads weak. "I'd rather have NO motion than BAD motion." First fill the back of a shot with **sequential reveal timed to the VO**; if a frame has genuinely settled and still needs life, the **sanctioned move is subtle jitter** — this rule at the LOW end of its amplitude range. A full breathing loop is the rare last resort on a single held hero, never stamped on every element.

Keeps a settled element from feeling dead using `Math.sin` on the timeline clock. Two forms:

- **Yoyo form** — one `sine.inOut` tween with `yoyo: true` and a **finite** `repeat` count. Preferred when the idle stands alone on a property nothing else touches.
- **onUpdate form** — one long `ease: "none"` tween drives a `phase` proxy `0 → 2π·CYCLES`; `onUpdate` maps `Math.sin(phase)` into the transform. Required when the offset multiplies/adds onto another live value (compound transforms, amplitude envelopes, multi-octave).

Either way, idle begins where the entry settled: at `phase = 0`, `sin(0) = 0` — the offset is zero, so there is no jump from the entry's resting state.

## Recipe

```js
// onUpdate form — phase-driven, composable.
const phase = { p: 0 };
tl.to(
  phase,
  {
    p: Math.PI * 2 * CYCLES,
    duration: IDLE_DUR,
    ease: "none", // sine provides the easing; a non-linear phase tween distorts the wave
    onUpdate: () => {
      const s = Math.sin(phase.p);
      hero.style.transform = `translateY(${s * Y_AMP_PX}px) scale(${1 + s * SCALE_AMP})`;
      // secondary elements: offset by Math.PI / 2 — synced motion looks mechanical
      dot.style.transform = `scale(${1 + Math.sin(phase.p + Math.PI / 2) * DOT_SCALE_AMP})`;
    },
  },
  IDLE_START_TIME,
);

// Yoyo form — standalone property, finite repeats.
tl.to(
  "#badge",
  { y: -Y_AMP_PX, duration: PERIOD / 2, ease: "sine.inOut", yoyo: true, repeat: REPEATS },
  IDLE_START_TIME,
);
```

## Variations

- **Multi-octave** (organic): stack a higher-frequency overlay — `1 + Math.sin(p) * AMP_PRIMARY + Math.sin(p * OCTAVE_RATIO) * AMP_SECONDARY`, with `AMP_SECONDARY < AMP_PRIMARY` and the combined max inside the normal SCALE_AMP range.
- **Settle and fade** (strongly recommended when `IDLE_DUR > 6s`): ramp amplitude to zero over the last ~20% of idle so the scene visibly settles before the inter-scene transition, instead of handing off mid-drift:

```js
const t = phase.p / (Math.PI * 2 * CYCLES); // 0 → 1 across idle
const env = t < 1 - FADE_FRAC ? 1 : (1 - t) / FADE_FRAC; // FADE_FRAC ≈ 0.2
const scale = 1 + Math.sin(phase.p) * SCALE_AMP * env;
```

This is the single biggest fix when finalize snapshots show "everything's still moving at the end"; it pairs naturally with break-boundary transitions (the outgoing visual is static when the crossfade/push begins).

## Values

| token           | range / default                      | notes                                                                      |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| SCALE_AMP       | **0.008–0.015 default**              | push to 0.02–0.04 only when isolated on canvas / scene <6s / kinetic brief |
| Y_AMP_PX        | **2–3px default**                    | 4–6px only under the same gating; rotation ±0.3–0.8° rarely needed at all  |
| period          | 1.5–3s (2.5–4s when idle is long)    | <1.5s frantic; >4s lifeless in a short window                              |
| CYCLES          | `IDLE_DUR/3 ≤ CYCLES ≤ IDLE_DUR/1.5` | derive from the period, not the other way round                            |
| IDLE_START_TIME | ≥ entry settle + ~0.1s               | `sin(0)=0` at this moment → no jump off the entry tail                     |
| IDLE_DUR        | `TOTAL_DURATION − IDLE_START_TIME`   | one long tween fills the hold — never restarted                            |
| DOT_SCALE_AMP   | 0.04–0.12                            | small accents tolerate more than the hero                                  |
| OCTAVE_RATIO    | 2.0–4.0                              | integer-ish reads musical; non-integer reads organic                       |

## Critical Constraints

- **Prefer reveal, then jitter, then breath** — the doctrine order above; default to the LOW end of every amplitude range. At the upper end across 5+ consecutive scenes the whole film reads as "shimmering".
- **Long idle window** (`IDLE_DUR > 6s` OR idle > 30% of composition): halve `SCALE_AMP` / `Y_AMP_PX`, slow the period to 3–4s, and add the settle-and-fade tail.
- **Concurrent idle on N elements** (columns, card grid, stat row): per-element amplitude ≤ default `/ √N`, AND stagger the periods (2.1s / 1.9s / 2.4s). Three columns at ±6px compound to ±18px of competing motion; three at ±2–3px read as one collective breath.
- **Compose, don't replace** — idle ADDS to the element's resting transform; never overwrite the entry's final translation.
- **Phase tween `ease: "none"`** — sine itself is the curve.
- **No CSS `@keyframes` for idle** — CSS animation runs on the browser's render clock, independent of the HF seek clock; a CSS-driven idle flickers/desyncs. Drive idle inside the timeline.

## See also

`ambient-glow-bloom` (the glow-layer counterpart, same bounded-breathe discipline) · `press-release-spring` / `counting-dynamic-scale` / `card-morph-anchor` / `orbit-3d-entry` (settled elements this can follow) · `spring-pop-entrance` (the arrival that precedes any idle).
