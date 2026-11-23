# The look

Left alone, the same brief comes out with the same look run after run, and banning that look only moves it to the next default. Outside input breaks it, in this order: the project's design spec, a real brand, a reference image or film the person gave you, the subject's own world. Settle it before the first scene, as numbers in the LOOK line (below).

## The project's design spec

Read the first of `frame.md`, `design.md`, `DESIGN.md` at the project root that exists; ignore the rest.

- **Frontmatter is normative**: `colors`, `typography`, `spacing`, `components`. Quote hex values, families and weights exactly; never round or invent them.
- **The prose is intent**: what the look is for, Do's and Don'ts. Follow it for judgment, not values.
- **Brand, not layout**: hex, fonts, weight relationships and Do's and Don'ts are strict; type sizes, spacing, border weight and decoration are yours to scale for video. A 1px border or a 6% shadow from a web page vanishes on screen.

## From a brand

- A website: `npx hyperframes capture <url> --json` writes screenshots, the copy (`extracted/visible-text.txt`), images, logos, `extracted/tokens.json` (colours, fonts) and `extracted/design-styles.json` under its output folder. Look at the screenshots before choosing anything. A capture that exits non-zero, prints `ok: false` or writes `BLOCKED.md` failed: take no brand data from its partial files.
- Figma: `npx hyperframes figma tokens <fileKey>` (`/figma`).
- Images the person attached: take palette and type from what you see.

Use the brand's own fonts when the capture shipped their files or they are bundled (`format.md`); otherwise download the family's `.woff2` into `assets/fonts/` with an `@font-face`, or pick the closest bundled family and say so.

## From a reference

A reference film or image gives its grammar, never its content: shot lengths, how titles enter and leave, the transitions, the palette roles, the type's scale and weight. Snapshot it next to yours (`snapshot --at <t,…> --against ref.mp4`) and write the grammar down, marking what you measured apart from what you guessed.

## Presets

The presets are slide-deck looks: use one when the person names it, or for a deck (`/slideshow`), never as the fallback for a film without a brand. Each folder in `../assets/frame-presets/` holds a `FRAME.md` spec, a `caption-skin.html` and a `frame-showcase.html` contact sheet. To use one, copy its `FRAME.md` to the project root as `frame.md`, then read it as above; its fonts that aren't bundled need `@font-face` files. The two HTML files are reference code: read them for treatments, never mount them.

| Preset              | Look                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `biennale-yellow`   | Museum catalogue: parchment, deep indigo ink, solar-yellow blooms, Instrument Serif, hairlines |
| `blockframe`        | Loud neobrutalist: 4px black borders, hard shadows, candy pastels, Inter 900 caps              |
| `blue-professional` | Consulting restraint: cream canvas, one cobalt accent, Space Grotesk + Inter, tinted cards     |
| `bold-poster`       | Vintage editorial poster: Shrikhand tilted display, Baskerville, tomato red, double borders    |
| `broadside`         | Protest poster: ink-black and fire-orange planes, giant lowercase Barlow 900, mono chrome      |
| `capsule`           | Friendly editorial: every container a pill, cream, nine candy accents, Bodoni Moda             |
| `cartesian`         | Quiet catalogue: warm-stone palette, Playfair + Inter, taupe hairline grid, compass rings      |
| `cobalt-grid`       | Two-colour risograph: cream paper, cobalt ink, graph-paper grid, Newsreader serif              |
| `code-editorial`    | Developer brand book: warm paper, scarce terracotta, EB Garamond, navy code surface            |
| `coral`             | Bold magazine: coral, ink and cream planes at hard edges, Bebas Neue, giant numerals           |
| `creative-mode`     | Sparse neobrutalist: cream, 4px ink borders, Archivo Black caps, rationed accents              |
| `daisy-days`        | Picture book: charcoal outlines, sunny pastels, Fredoka One, hand-drawn ornaments              |
| `editorial-forest`  | Literary: green, pink and cream, Source Serif display, mono chrome, flat paper                 |

## The LOOK line

With no design spec, the look is the LOOK line of `SPEC.md` (`spec.md`), taken from the brand, the reference or the subject itself: its era, its materials, where it would be shown. Every part is a number (hex, px, %, a named face and weight), the ground and the hero come from a medium rather than from effects, and the BANNED line keeps it off the defaults. Inter, Space Grotesk, Instrument Serif, Geist and JetBrains Mono are where generated design lands; use them when the brand does, not by default. Copy the palette and the faces into the root variables below.

## Video facts

- Full-screen linear gradients on dark grounds band under H.264; use a radial gradient, a solid fill or a solid plus a local glow.
- An accent at 5% opacity disappears in compression: 15–25% for atmosphere, full saturation for the focal element.

## Make it re-brandable

Declare palette and fonts as variables on the root `<html>` and use them everywhere, so the person can re-brand from Studio's Variables panel:

```html
<html
  data-composition-variables='[
  {"id":"color-ground","type":"color","label":"Background","default":"<ground from the plan>"},
  {"id":"color-ink","type":"color","label":"Text","default":"<ink from the plan>"},
  {"id":"color-accent","type":"color","label":"Accent","default":"<accent from the plan>"},
  {"id":"font-display","type":"string","label":"Display font","default":"<display face from the plan>"}
]'
></html>
```

Reference them as `var(--color-accent)`; point a registry item's colour and font variables at the same values.
