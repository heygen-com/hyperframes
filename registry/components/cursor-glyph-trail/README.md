# cursor-glyph-trail

An actor (default: a cursor dot) travels an authored path and deposits small dithered glyphs at its past positions. Each glyph pops in where the actor passed and decays in place; stamps land at fixed arc-length spacing along the path, so the per-second stamp rate scales with the actor's velocity. The jh3yy stamp-and-decay register: the trail is the residue of the motion, fully dissolved before the hold.

4s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `glyphs` | string | `░▒▓+·×` | Stamp charset; one glyph per stamp is chosen by a fixed-seed LCG. |
| `density` | enum | `med` | Arc-length spacing between stamps: `low` (4.6), `med` (2.9), `high` (1.8) percent units. |
| `path` | enum | `sweep` | `sweep` is an S-curve lower-left to upper-right; `arc` rises over the top; `zigzag` cuts three straight legs. |
| `fade` | number | `0.8` | Per-stamp decay window in seconds, clamped 0.3 to 1.5; per stamp varied 0.75x to 1.25x. |
| `accent` | enum | `green` | Trail and actor color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Actor slot

The actor is a slot. Place an inert template anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so the slot lives at document level):

```html
<template data-slot="cursor-glyph-trail-actor">
  <img src="./assets/cursor.svg" alt="" style="width: 4cqmin" />
</template>
```

With no slot, the primitive renders a token cursor dot (accent core, hairline ring, contract tokens only).

## Mount

```html
<div
  class="clip"
  data-composition-id="cursor-glyph-trail"
  data-composition-src="./cursor-glyph-trail.html"
  data-variable-values='{"path":"zigzag","density":"high","accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `cursor-glyph-trail` key.

## Notes

- Deterministic: the stamp table (positions, times, glyph choices, jitter, sizes, peaks, decay multipliers) is built once at mount from fixed LCG seed `0x67117a11`. Stamps carry no tweens: each stamp's opacity is recomputed on every timeline update as a pure function `f(tl.time() - t_i)` of its table row (two sequential tweens on one property render in direction-dependent order under GSAP seeks), and the actor position is recomputed from `tl.time()` the same way, so eventful seeks (`suppressEvents=false`, the engine's render path) land identical frames in any order and either direction.
- Density law: stamps land at fixed arc-length spacing, so faster travel deposits more stamps per second; the shared ease (power2-style inOut) makes the trail thin at the ends and dense through the middle.
- Every stamp's decay completes inside IN by construction (`IN = travel + pop + fade * 1.25 + margin`), so the HOLD is truly still: the actor rests at the path end and the field is empty.
- The travel ease is one shared function used by both the stamp-table sampler and the per-update actor position, so stamps always sit exactly on the actor's past path.
