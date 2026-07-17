# Inverse Zoom-Through (backward) — arrival / payoff beat

The pull-back mirror: the outgoing element RECEDES; the incoming arrives OVERSIZED (as if
just behind camera) and retracts into the focal plane. Everything SHRINKS. Spend on
ARRIVAL/payoff beats — a payoff line, a giant reply, a held end-state — never ordinary
boundaries (Z backward is a reserved vector: something bigger lands). Total ≈ 0.7s
(30% exit / 70% entry).

| Phase          | Scale    | Blur     | Opacity           | Ease                                       | Duration |
| -------------- | -------- | -------- | ----------------- | ------------------------------------------ | -------- |
| Exit           | 1 → 0.8  | 0 → 10px | 1 → 0.15          | power3.in (opacity: separate `none` tween) | ~0.2s    |
| Cut (`tl.set`) | in: 1.25 | 10px     | out: 0 / in: 0.15 | —                                          | —        |
| Entry          | 1.25 → 1 | 10 → 0px | 0.15 → 1          | expo.out                                   | ~0.5s    |

Blur is 10px text-scale; 18–20px only when both sides are full-bleed surfaces.

**Sign discipline:** pull (back) = shrinking on BOTH sides: exit `1 → 0.8`, entry
`1.25 → 1`. The incoming scene arrives as a composed frame inside the retracting
wrapper — no grow-from-small intro in the seam window. Staged entrances happen after the
retraction settles, or start ≥1 and retract. Banned mirror: a receding exit answered by
a grow-from-small entry (pull flips to push — the common one, since grow-from-small is
the default element entrance). Verify per Seam Gate rule 7.

## Registry gsap_template

```js
tl.set(__NEW__, { opacity: 0 }, __T__);
tl.to(
  __OLD__,
  { scale: 0.8, filter: "blur(10px)", duration: __DUR__ * 0.3, ease: "power3.in" },
  __T__,
);
tl.to(__OLD__, { opacity: 0.15, duration: __DUR__ * 0.3, ease: "none" }, __T__);
tl.set(__OLD__, { opacity: 0 }, __T__ + __DUR__ * 0.3);
tl.fromTo(
  __NEW__,
  { opacity: 0.15, scale: 1.25, filter: "blur(10px)" },
  {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    duration: __DUR__ * 0.7,
    ease: "expo.out",
    immediateRender: false,
  },
  __T__ + __DUR__ * 0.3,
);
```

Worker version: same phases as zoom-through with the scale values flipped
(exit `1 → 0.8`, cut-in at `1.25`, entry `1.25 → 1`).

## Tuning ranges

| Parameter      | Default                        | Range     |
| -------------- | ------------------------------ | --------- |
| Exit scale     | 0.8                            | ±0.1      |
| Entry scale    | 1.25                           | ±0.1      |
| Blur at cut    | 10px text / 18–20px full-frame | —         |
| Opacity at cut | 0.15                           | 0.1–0.2   |
| Exit duration  | 0.2s                           | 0.15–0.3s |
| Entry duration | 0.5s                           | 0.4–0.6s  |

## Anti-patterns

| Don't                                                                      | Instead                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Inverse-zoom exit → grow-from-small entry (or push → oversized retraction) | Match the scale-velocity SIGN; verify at cut±0.1s                         |
| Incoming comp's own scale-up intro under a Z-seam wrapper tween            | Arrive composed; stage entrances after the seam settles or match the sign |
| Spending this on ordinary boundaries                                       | Reserve for arrival/payoff; the default boundary is cut-the-curve         |
