# soft-blob-touch

Product demo material primitive: a granular soft blob (layered radial
gradients plus a seeded grain field) idles with slow internal drift; a
scripted touch dot decel-arrives at a caller-positioned point; the blob
deforms toward it (attraction bulge with mass), then recovers with a
velocity-preserving spring once the dot retreats. The AI-orb beat. Material
softness is the whole point: nothing in the frame has a hard edge. 4s
authored, elastic HOLD (never time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="soft-blob-touch"
  data-composition-src="./components/soft-blob-touch.html"
  data-variable-values='{"touch_x":30,"touch_y":62,"grain":"coarse","accent":"violet"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Best on a dark or deep-toned host: the body is additive light (accent-tinted
gradients and specks over a transparent canvas), so the frame beneath shows
through the aura.

## Variables

| id       | type   | default | notes                                                                 |
| -------- | ------ | ------- | --------------------------------------------------------------------- |
| touch_x  | number | 66      | Touch point, percent of host width (8 to 92).                          |
| touch_y  | number | 38      | Touch point, percent of host height (8 to 92).                         |
| touch_at | number | 1.6     | Seconds from mount start when the dot makes contact. Clamped so the deform and recover tail (~1.57s) and any exit stay inside the clip. |
| grain    | enum   | fine    | fine (many small specks) or coarse (fewer, larger).                    |
| accent   | enum   | green   | green maps to --brand, blue to --accent, violet to --accent-2. Tints the aura, body, and specks. |
| exit     | enum   | none    | none holds the settled blob (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.00s: the blob is present and idling; every speck drifts on its own
  slow sine, each an integer number of cycles over the IN window, so the
  drift is exactly zero when the hold begins.
- touch_at - 0.85s: the dot enters from off stage along the attraction
  axis, decelerating the whole way (power3.out: it arrives, it never
  passes through).
- touch_at: contact. The blob leans and bulges toward the dot: specks are
  attracted with an exponential falloff (the material near the dot reaches
  for it, the far side barely stirs) while a gradient lobe swells at the
  surface.
- touch_at + 0.41s: the dot lifts mid-lean (analytic cut). The recovery
  spring starts with the exact velocity the lean-in had at the cut, so the
  blob keeps deforming for a beat, overshoots home, and wobbles out: the
  bulge on a fast spring, the whole-mass lean on a slower one.
- touch_at + 1.57s: settled. HOLD is dead still, elastic with the clip.

Sync point `touch` fires at contact; align SFX or a downstream reveal to it.

## Determinism

The grain table is computed once at build from a fixed LCG seed; every
painted frame is a pure function of (table, two tweened params, timeline
time). The canvas repaints from scratch in onUpdate, so eventful seeks land
identical frames in any order and either direction. The recovery is a
closed-form damped spring evaluated inside a tween ease, which keeps the
interruptible-spring law (L1) inside one paused, seek-safe timeline.
