---
name: example-com-intro
source: https://example.com (live capture, 2026-08-03)
format: 1920x1080
colors:
  canvas: "#E9E9E7" # the page's #EEEEEE stepped down ~3% so the plate lifts off it
  surface: "#EEEEEE" # the captured page's own background — the plate
  ink: "#1B1B1B" # the page's #000 at .8 opacity, resolved
  ink_muted: "#5A5C63" # supporting copy
  accent: "#334488" # the page's own link colour
  hairline: "#D6D6D6" # plate edge
  caption_bg: "#1B1B1B"
  caption_idle: "#9A9A9A"
  caption_active: "#FFFFFF"
fonts:
  display: "Inter" # 900 only
  body: "Inter" # 400 only
  mono: "IBM Plex Mono" # 400 only
type_ramp:
  title: "132px / 1.02 / -0.035em / 900"
  address: "42px / 1 / 0 / 400 mono"
  support: "38px / 1.45 / -0.005em / 400"
  caption: "42px / 1.2 / -0.005em / 700"
radius: "10px"
motion:
  ease: "power4.out for reveals, power3.out for copy, expo.out for rules"
  reveal: "cued to the narration's measured word timings — never front-loaded"
  idle: "none; the film holds still rather than drifting"
---

# frame.md — example.com intro

## Where the palette comes from

Nothing here is chosen by taste. `capture/extracted/tokens.json` reports three colours
on the live page — `#EEEEEE`, `#000000`, `#334488` — and its CSS resolves them:

```css
body {
  background: #eee;
  font-family: system-ui, sans-serif;
}
div {
  opacity: 0.8;
} /* so #000 ink actually reads as ~#333 */
a {
  color: #348;
} /* → #334488 */
```

One value is **derived, not read**: the composition canvas. If the frame were also
`#EEEEEE`, the captured plate would have the same fill as the ground and only its
border would separate them. Stepping the canvas down to `#E9E9E7` gives the plate
somewhere to lift from, which is why its shadow reads at all.

## Type

Only weights the renderer actually embeds:

| Role    | Family        | Weight | Why                                                  |
| ------- | ------------- | ------ | ---------------------------------------------------- |
| Title   | Inter         | 900    | bundled; the lockup's whole job is mass              |
| Body    | Inter         | 400    | bundled                                              |
| Address | IBM Plex Mono | 400    | bundled; mono says "this is a literal string"        |
| Caption | Inter         | 700    | bundled; the heaviest weight that is not the title's |

Weights 500 and 600 are **not** in the embedded bundle. Asking for them means the
render machine synthesises or substitutes, and preview stops matching output. Snap to
400 / 700 / 900.

## The one graphic device

A single accent family, three instances, each with a job:

1. **Top rule** — 6px, full bleed. The frame asserting itself at t=0.1.
2. **Brand bar** — 200×8px under the title. Separates the name from the address.
3. **Page marker** — 5px vertical, inside the plate, beside the page's own content block.
   This is the film's argument: _those are the page's words, not ours._

Anything that is not one of those three is not in this composition. No sheen, no
ambient bloom, no grid or paper texture, no gradient mesh, no drifting camera.

## The plate rule

The capture is a 1x, 1920×1080 screenshot. It is displayed through a 1000×400 window
with `object-fit: none`, so the page renders at exactly 1:1 and its real 16px body
text is as crisp as it is in a browser.

Consequences, and they are hard rules:

- **Never scale the plate.** Any zoom past 1:1 resamples a 1x capture into mush.
- **Never rotate the plate.** A 3D tilt does the same thing more expensively.
- Entrance is `x` translate + opacity only.

## Caption skin

Fixed lower band, `184px` tall (17% of the canvas), reserved structurally — the stage
ends where the band begins, so nothing can ever collide with it. Dark pill, centred,
one phrase group visible at a time, per-word emphasis by luminance only
(`#9A9A9A → #FFFFFF`). No colour flashing, no scale popping, no scatter exits, no
random placement.
