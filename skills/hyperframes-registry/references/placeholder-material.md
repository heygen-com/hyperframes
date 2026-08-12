# Placeholder material

Registry items ship with stand-in content: a rectangle where the user's screenshot goes, a
bar where their number goes, a chip where their teammate's face goes. That stand-in is
**placeholder material**, and it is monochrome. No hue, no colour ramps, no purple-to-blue
diagonal fill.

The rule exists because placeholder colour is always arbitrary. A violet card, a blue logo
tile and a rainbow avatar row assert a brand the composition does not have; across 250 items
the same three arbitrary hues become the catalog's identity instead of the author's. Value
says everything colour was saying here, and says it truthfully.

## The one rule

> Placeholder content carries no hue. It is built from four alpha steps of the composition's
> own ink over the composition's own ground, plus a hairline. Accent marks one element per
> composition, and never a placeholder.

## The ramp

Four fill steps and a hairline. All of them are the ink at an alpha, so the ramp inverts for
free on dark themes and needs no second table.

| Step   | Ink alpha | What it is for                                                               |
| ------ | --------- | ---------------------------------------------------------------------------- |
| `ink`  | 100%      | Real content: headline, number, label. Not placeholder.                      |
| `L1`   | 72%       | The subject. Chart bars, a filled logo mark, a play glyph, a front avatar.   |
| `L2`   | 45%       | Support. A comparison series, avatars behind the front one, secondary icons. |
| `L3`   | 18%       | Media fill and skeleton text lines. "Content lives here."                    |
| `L4`   | 8%        | Recessed plate interiors. The tray a card sits in.                           |
| `hair` | 14%       | Every 1px boundary. Replaces the separation a gradient edge was doing.       |

Write them the way the file already writes colour:

```css
/* theme-token primitives (--fg / --surface available) */
background: color-mix(in srgb, var(--fg, #f8fafc) 18%, transparent);

/* fixed-palette ports (local --hf-ink, no theme tokens) */
background: rgba(17, 24, 39, 0.18);
```

**Four steps, not eight.** Grays go muddy when adjacent steps sit close together, so every
step is at least 1.6x the alpha of the one below it. Reaching for a fifth value is the signal
that the layout, not the palette, needs the work. Snap to the nearest step instead.

Contrast, measured against both shipped grounds (`neutral` light `#fcfcfd`, `bold` dark
`#1b1230`): L1 is 7.7:1 / 8.9:1, L2 is 3.1:1 / 4.4:1, L3 and L4 are below 3:1 by design.
Therefore **text never goes below L1**, and L2 is the floor for any graphic a viewer has to
compare (a chart series, a state indicator). L3 and L4 are for surfaces only.

## Depth without colour

In priority order. Reach for the first one that works.

1. **Value step.** Nothing sits on the same step as its ground. One full step of separation
   minimum. This alone resolves most stacking.
2. **Hairline.** `1px` of `hair` on every plate boundary. A border separates two surfaces more
   cleanly than a gradient ever did, and survives video compression that eats a soft edge.
3. **Negative space.** Padding is elevation. A plate with `--space-2` inside it reads as raised
   without any fill difference at all.
4. **Texture, at the finest grain only.** A `repeating-linear-gradient` at `L3`-and-below,
   period 2-4px, achromatic. This is the one thing value cannot say: a flat gray rectangle
   reads as an empty box, the same rectangle finely hatched reads as a surface with content on
   it. Use it to mark media, nothing else.

Shadows are allowed and must be achromatic and diffuse: `0 Npx 3Npx rgba(0,0,0,0.18)`. Never a
coloured glow; a glow is an accent wearing a shadow's clothes.

## Reading each kind in black and white

A gray rectangle has to still say _screen_ and not _image_. Shape, aspect, glyph and texture
carry the meaning that hue was carrying badly.

| Kind            | Signature                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Screen / device | Device aspect + `--radius` + `hair` + scanline texture at L3 + inset vignette. The chrome is the signal; the fill is L3 and stays quiet. |
| Video footage   | Screen signature plus a centred play triangle in a ring at L1. The glyph is what makes it video rather than a static screen.             |
| Image           | 4:3 or 3:2 plate at L3 with a horizon-and-disc glyph at L2, offset toward a corner, never centred. Offset is what reads as "photo".      |
| Card            | Plate at L4, `hair` border, two skeleton rules at L3 (100% and 62% width). Two rules of unequal length is the whole idiom.               |
| Avatar / person | **Circle** at L2 with initials knocked out in the ground colour. Stacks differ by step (L1 front, L2, L3), never by hue.                 |
| Logo / brand    | **Rounded square** at L1 with the mark knocked out in the ground colour. Every mark on the same step: a logo wall means "many, equal".   |
| Chart series    | Flat fills. Primary series L1, comparison series L2, gridlines `hair`. Never a gradient inside a bar.                                    |
| Text block      | Rounded rules at L3, widths 100 / 86 / 62%. The ragged right edge is what reads as prose.                                                |

Circle means person, rounded square means app or brand. Keeping those two shapes distinct is
what lets both live at the same value step without ambiguity.

Why no gradient inside a chart bar: a vertical light-to-dark fill makes every bar lighter at
its top, so the tallest bar reads _palest_ exactly where the eye lands to compare heights. The
decoration contradicts the data. Flat fills are both plainer and more honest.

## Accent

The accent enum stays. `green` rides `--brand`, `blue` rides `--accent`, `violet` rides
`--accent-2`, exactly as before, and every declared `accent` or `tone` variable keeps working
unchanged. What changes is where accent is allowed to land:

> Accent marks at most **one** element per composition, and only where the accent _is_ the
> meaning: the selected tier, the current step, the figure a count-up lands on, the ink of a
> stroke being drawn. Placeholder content is never accent-coloured.

Fixed-palette ports have no theme tokens, so they get the accent through their own
variable with a neutral fallback:

```css
/* was: --hf-accent: #2563eb; */
--hf-accent: var(--accent, #18181b);
```

Unthemed, the item renders in pure black and white. Drop it into a themed composition and
the author's accent lands on that one element and nowhere else. Where the accent is chosen by
an enum, the lookup table maps to tokens, never to hex: `green` to `var(--brand, <neutral>)`,
`blue` to `var(--accent, <neutral>)`, `violet` to `var(--accent-2, <neutral>)`. The enum's
declared options and default are unchanged, so no mount breaks.

"One element" means one role, not one node: an app mark repeated on three devices of the same
mock is still one element.

Killing accent outright was the alternative and it is worse. Accent is already load-bearing in
exactly the cases where it is correct, and it is the only hook an author has for their own
brand; removing it would push those cases into value tricks for a job one hue does better with
one element. The failure was never that accent existed, it was that accent had become the
default fill for every placeholder. Capping it at one element fixes the failure with no
variable migration.

## Gradients that stay

The ban is on **hue-carrying fills**, not on the CSS function. These are material, not
placeholder, and flattening them breaks the thing the item exists to do:

- **Physical surfaces** — device bezels, brushed metal, glass, a screen's inner vignette.
- **Sheens and sweeps** — `linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)`
  driven across an element. That is motion, not decoration.
- **Scrims and vignettes** — `rgba(0,0,0,α)` ramps that buy text contrast over media.
- **Effects whose subject is the gradient** — aurora, liquid glass, chromatic aberration,
  grain fields, shader transitions. The gradient is the product.

All four are achromatic or physically motivated. If a gradient is neither, it is placeholder
slop and it goes.

## Checklist

- [ ] No `#7c3aed`, `#2563eb`, `#6366f1`, `#8b5cf6`, `#a855f7`, `#4f46e5` anywhere in the item.
- [ ] Every placeholder fill is `ink` at 72 / 45 / 18 / 8 / 14 percent, and nothing else.
- [ ] At most one accent-coloured element, and it means something.
- [ ] Text sits at L1 or above; L3 and L4 carry no text.
- [ ] Every remaining gradient is a surface, a sweep, a scrim, or the effect itself.
- [ ] `hyperframes check` passes, and a rendered frame was looked at.
