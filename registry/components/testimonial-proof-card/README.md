# testimonial-proof-card

The proof-and-stats quote card: a testimonial reveals per rendered line
through a soft overflow mask, the byline (avatar disc, mono name and role,
optional company text mark) fades up as the quote lands, and one emphasis
substring gets a hand-drawn accent underline (`getTotalLength` dash, the
marker-highlight law). Then a dead-still hold.

4.5s authored, elastic HOLD, exit `none` by default.

## Files

- `testimonial-proof-card.html`: the mountable sub-composition (install
  target: `compositions/components/testimonial-proof-card.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 host that mounts the primitive with non-default
  variables.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `quote` | string | `We shipped our launch video in a single afternoon` | Wraps inside the card; each rendered line reveals through its own mask. |
| `name` | string | `Maya Chen` | Attribution name in mono; also seeds the avatar initials. |
| `role` | string | `Head of Product` | Muted mono line under the name. Empty hides it. |
| `company` | string | `NORTHWIND` | Wide-tracked mono text mark at the byline end. Empty hides it. |
| `emphasis` | string | `single afternoon` | First case-insensitive substring match in `quote`, expanded to whole words, gets the accent underline after the quote lands. Empty or unmatched disables the draw. |
| `accent` | enum | `green` | Underline and glyph ink: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` and `up` depart over the final 0.45s. |

## The avatar slot

The avatar disc is a named slot inside the `<template>`:

```html
<div class="tq-avatar" data-slot="avatar">
  <span class="tq-initials"></span>
</div>
```

The default child is the initials span (seeded from `name`). To show a
photo, install the component and **replace the slot's children in your
installed copy** (the runtime clones only the primitive's own template on
mount, so slot content lives in the component file, not on the host clip):

```html
<div class="tq-avatar" data-slot="avatar">
  <img src="../../assets/maya.jpg" alt="" />
</div>
```

Direct `img`/`video` children are sized to cover the disc automatically
(`object-fit: cover`, clipped to the circle).

## Mount

```html
<div
  class="clip"
  data-composition-id="testimonial-proof-card"
  data-composition-src="./components/testimonial-proof-card.html"
  data-variable-values='{"quote":"The render pipeline paid for itself in one week","emphasis":"one week","name":"Ana Ferreira","role":"VP Engineering","company":"LUMENWORKS","accent":"violet"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host
clip gives it. Timeline registers under the literal `testimonial-proof-card`
key.

## Notes

- Envelope: card settle 0.5s, per-line rise 0.6s staggered 0.18s, byline
  0.5s overlapping the last line, underline 0.55s after the quote lands,
  then HOLD (the only elastic phase), OUT 0.45s only when `exit` is not
  `none`. Short durations compress every phase together, never timeScale.
- The underline path is authored wobble in a fixed viewBox stretched with
  `preserveAspectRatio="none"`; the anisotropic stroke distortion is the
  hand-swiped nib feel, deliberately kept (no `non-scaling-stroke`, no
  `pathLength`).
- Line splitting measures the rendered wrap once at mount; the emphasis
  phrase is one nowrap token so the underline never breaks across lines.
- Deterministic: no randomness, both dash endpoints explicit, seek-safe in
  either direction. Sync point `underline-landed` fires at 1.6s at the
  default two-line quote.
