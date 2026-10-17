---
name: follow-through
description: A velocity-continuous ring-out composed INTO any ease that arrives with speed — measure the base curve's arrival velocity numerically, extend the tween by a short decaying-sine tail whose amplitude is proportional to that velocity, so a fast arrival over-rings and a slow one barely stirs. One tween, one pure composed ease; seek-safe by construction. Not for `out` eases (they already arrive at rest).
metadata:
  tags: follow-through, overshoot, ring-out, settle, secondary-motion, impact, arrival, composed-ease, physics, velocity
---

# Follow-Through

Classical follow-through: a body that stops does not stop all at once. It arrives, overshoots by an amount that depends on how fast it was going, and rings down. This rule composes that into the ease itself — `withFollowThrough(baseEase, baseDur)` returns a **new** ease and duration: the base curve verbatim, then a decaying sine tail whose amplitude is the base curve's own arrival velocity. Nothing is hand-keyed; the same arrival at half speed rings half as much, automatically.

Boundaries: the ring belongs to arrivals that **carry speed into the stop** — a linear slide, an accelerating `in`-ease impact, a nudge chain's burst — where the base ease has no settle of its own. Every `out` ease ([spring-pop-entrance.md](spring-pop-entrance.md), `power3.out`, `expo.out`) arrives at zero velocity by definition, so the measured tail is flat and the rule does nothing there — that _is_ the doctrine: an `out` ease already contains its settle. For a physical settle on an entrance, use `springEase` (`../adapters/gsap-easing-and-stagger.md` → Spring Eases); don't stack the two. Cursor-driven presses keep their own two-tween chain ([press-release-spring.md](press-release-spring.md)).

## How It Works

1. **Measure the arrival velocity** numerically from the base ease: `v = (f(1) − f(1 − ε)) / ε / baseDur` (progress per second, `ε = 1e-4`). This works for any ease function — a GSAP name via `gsap.parseEase`, a spring, a custom curve.
2. **Extend the window**: `total = baseDur + 3 / decay` — the tail lasts until the envelope has fallen to `e⁻³` (~5%).
3. **Ring**: for `τ` seconds after arrival, `1 + v · amp · sin(2π · freqHz · τ) · e^(−decay · τ)`. The tail starts with slope `v · amp · 2π · freqHz`; with `amp = 1 / (2π · freqHz)` that slope equals `v` — velocity-continuous (C¹) at the arrival frame, which is what makes it read as the same body continuing, not a second motion bolted on. Larger `amp` over-rings on purpose; smaller under-rings.

The composed function is a pure function of progress, so it is seek-safe like any other ease.

## Recipe

```js
// Compose a ring-out into any ease that arrives with velocity.
function withFollowThrough(baseEase, baseDur, { amp, freqHz = 3, decay = 5 } = {}) {
  const A = amp ?? 1 / (2 * Math.PI * freqHz); // C¹ default: the tail starts at the arrival velocity
  const eps = 1e-4;
  const v = (baseEase(1) - baseEase(1 - eps)) / eps / baseDur; // arrival velocity, progress/s
  const tail = 3 / decay;
  const total = baseDur + tail;
  const ease = (p) => {
    const t = p * total;
    if (t <= baseDur) return baseEase(t / baseDur);
    const tau = t - baseDur;
    return 1 + v * A * Math.sin(2 * Math.PI * freqHz * tau) * Math.exp(-decay * tau);
  };
  return { ease, duration: total, arrivalVelocity: v };
}

// An accelerating impact: the word slams in and rings. GSAP's `power1.in` is quadratic — it arrives at 2 × travel / IMPACT_DUR.
const slam = withFollowThrough(gsap.parseEase("power1.in"), IMPACT_DUR);
tl.fromTo(
  "#word",
  { x: ENTER_FROM_X },
  { x: 0, duration: slam.duration, ease: slam.ease }, // BOTH from the helper — the tail is part of the ease
  IMPACT_AT,
);
// Opacity rides its own tween on the base window only (the composed ease passes 1).
tl.fromTo(
  "#word",
  { opacity: 0 },
  { opacity: 1, duration: IMPACT_DUR, ease: "power2.out" },
  IMPACT_AT,
);
```

Ring size is predictable: peak overshoot ≈ `0.68 · v · A` of the travel at the defaults (the first lobe of `sin · e^(−decay τ)`). GSAP's `in` family arrives at `n + 1` times the average speed (`power1.in` is quadratic, `power2.in` cubic, and so on): `power1.in` over 0.5 s gives `v = 4/s` and, with the C¹ default, a ~14% ring; the same arrival over 1.0 s rings ~7%; `power2.in` over 0.5 s (`v = 6/s`) rings ~22% — past the cap below. The reference build (2026-09-08, 24 s reel) runs the `power1.in` pair — full speed, then half speed — beside a bare `power1.in` that stops dead.

## Variations

- **Linear slide with a landing** — `ease: "none"` base (`v = 1 / baseDur`: a ~7% ring at 0.5 s, ~3.5% at 1.0 s): a mechanical move that stops with a small physical shudder. Pair with `decay: 8` (~6% at 0.5 s) so it reads as mass, not bounce.
- **Rotation follow-through** — the same composed ease on `rotation` for a sign or a card that swings in: `freqHz: 2`, `decay: 3` (a hanging object rings slower and longer).
- **Tight impact** — `decay: 8` (tail 0.375 s) for a hard object; **loose** — `decay: 2` (tail 1.5 s) for something soft or heavy on a string.
- **Chain** — the same composed ease on every member of a stack with [inertia-chain.md](inertia-chain.md) offsets: the ring ripples down the chain and the tip settles last.
- **Deliberate over-ring** — `amp: 1.5 / (2π · freqHz)` when the beat wants a visible exaggeration (a slapstick register); never the default.

## Values

| token     | range                                             | notes                                                                                                                                                     |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseEase  | `none`, `power1.in`, `power2.in`, a truncated arc | must arrive with velocity (`v = 1/baseDur` linear, `2/baseDur` quadratic, `3/baseDur` cubic) — an `out` / `inOut` base measures `v ≈ 0` and rings nothing |
| baseDur   | 0.3–1.0s                                          | `v` scales as `1 / baseDur`: halving the duration doubles the ring                                                                                        |
| amp       | `1 / (2π·freqHz)` (default, C¹) … 1.5× that       | overshoot ≈ `0.68 · v · amp` of travel; keep the peak ≲ 15% of travel                                                                                     |
| freqHz    | 2–4                                               | 3 reads as a firm object; 2 as a hanging one                                                                                                              |
| decay     | 2 (loose) – 8 (tight), default 5                  | tail = `3 / decay` s — schedule the next beat off `total`, not `baseDur`                                                                                  |
| IMPACT_AT | on a cause                                        | the ring is the reaction of a stop; an un-caused stop with a ring reads as a glitch                                                                       |

## Critical Constraints

- **Base ease arrives with velocity** — `none`, an `in` ease, or a custom curve with non-zero end slope. Check `arrivalVelocity` once at setup; if it is ~0 the rule is the wrong tool (use `springEase` or leave the `out` ease alone).
- **Transforms only** — the composed ease passes 1; on `opacity` it would push past 1 (split opacity onto its own tween on the base window, as in the recipe). Never on color.
- **One tween** — the ring lives inside the ease. Never a second tween, an `onComplete`, or a hand-keyed overshoot after the base tween.
- **Take both `ease` and `duration` from the helper** — the tail extends the window; scheduling the following beat off `baseDur` starts it mid-ring.
- Peak ring ≲ 15% of travel; past that the stop reads as bounce, which is a rare, explicitly-playful register (`../adapters/gsap-easing-and-stagger.md` → Easing Vocabulary).

## See also

`inertia-chain` (the same composed ease rippling down a stack) · `spring-pop-entrance` / `springEase` (physical settle for an entrance — the `out`-ease world this rule does not touch) · `nudge-curve` (a burst-dominant slide whose tail could carry a ring) · `kinetic-beat-slam` (an impact beat that can end in a ring).
