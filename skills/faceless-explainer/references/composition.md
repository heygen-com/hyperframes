# Composition — faceless-explainer visual-design judgment

> The composition-judgment layer for **Step 4 (Visual design)**. You read it while enriching `STORYBOARD.md` frames: which layout, how much frame the hero fills, how many depth layers — **director decisions**. Concrete px (safe margins 96-150), scale (1.05 / 0.92), three-layer `box-shadow`, `perspective` values are the **frame worker's** job; you name the intent in the frame's composition note. Video composition is closer to film / poster design than webpage layout — no scrolling, no reflow; every frame is a fixed canvas, every pixel matters. Default canvas **1920×1080**; portrait `1080×1920` / square `1080×1080` per the storyboard `format`.

## Squint test

Squint (or blur the frame). Can you still pick out the most important element, the second, and clear spatial groups? If everything has equal weight after blur, hierarchy is broken — redesign before writing the note. The strongest frames pass this: one dominant block + one supporting structural element, everything else demoted.

## Canvas zones (conceptual)

```
+--------------------------------------------------+
|         Optional top chrome                       |
|  +----------------------------------------------+ |
|  |         Safe margin                          | |
|  |  +----------------------------------------+  | |
|  |  |       Primary content area             |  | |
|  |  |     (center 65-75% of frame)           |  | |
|  |  +----------------------------------------+  | |
|  |  | Caption band (bottom ~17%, HARD w/ captions) | |
|  |  +----------------------------------------+  | |
|  +----------------------------------------------+ |
+--------------------------------------------------+
```

- **Top chrome** — rarely needed in a faceless explainer; skip unless a frame intentionally mocks an interface.
- **Safe margin** — key content stays off the edges; hero / editorial frames need more air.
- **Primary content area** — the center 65-75% is where the eye rests; body text never presses the edge.
- **Caption band (bottom ~17%, HARD-reserved when captions are on)** — when the film has captions enabled (the frame's `Captions:` flag), the bottom ~17% of **canvas height** is reserved (landscape 1080h → bottom 180px, y 900-1080; portrait 1920h → bottom 320px, y 1600-1920): primary content and key visuals **cap at the band top**, and a centered hero anchors at **y ≈ 0.42 × height** (landscape ≈454, portrait ≈806), not the canvas midpoint. Background / ambient / surface layers are exempt and may stay full-bleed. Captions disabled → keep the zone clear anyway for bottom-edge consistency across frames.

You write "hero word centered with generous safe margins"; you do not write `padding: 150px 120px 92px`.

## Portrait & square (non-16:9 canvases)

The zones, density, hierarchy, and depth principles all still apply; the **aspect ratio** changes, and a wide-frame layout does not transplant into a tall one. Design for the storyboard's `format` from the start — never plan landscape and "crop."

- **Stack vertically, not side-by-side.** Portrait has little horizontal room: split-screen / triptych / 60-40 asymmetry become **top/bottom stacks**, vertical step lists, stacked bands. Square tolerates side-by-side only for two compact items.
- **Vertical center moves with the canvas** — anchor a centered hero around **y ≈ 0.42 × height** (portrait ≈806, square ≈454), not a fixed 540.
- **Type runs larger, fewer words per line** — narrow frames wrap long headlines badly; prefer short kinetic lines, bigger type, more vertical rhythm.
- **Travels well to portrait:** Centered, Layered Depth, Full-Width Strip (stacked band), vertical Rule-of-Thirds. **Avoid** wide Split Screen and Triptych — use stacked equivalents.
- **Density still rules** — primary visual ≥ 40% of canvas, ≥ 3 depth layers, measured against the tall frame; an empty top or bottom third reads as placeholder.

## 7 composition templates

Use ≥3 different templates per video (5 frames → 3+, 9 frames → 4+). **Don't default every frame to centered**; never use the same layout class twice in a row.

1. **Centered (hero / climax)** — one dominant element, generous breathing room. Concept name, key takeaway, the hero word, the closing principle.
2. **Rule of thirds** — anchor on a thirds intersection; remaining space carries support or negative space. A mechanism step + its label.
3. **Split screen (comparison / dual focus)** — left/right halves carry separate elements. Before/after, common-belief vs reality, two options.
4. **Layered depth (immersive)** — foreground / midground / background differ in scale + opacity. Opening hooks, atmosphere, the "imagine…" scenario.
5. **Asymmetric (editorial)** — primary content pushed to one side (60/40, 70/30); intentional imbalance → tension + sophistication. A dense diagram with a caption rail.
6. **Triptych (three-panel)** — three equal zones for three items / beats at once. The rule-of-three landing.
7. **Full-width strip** — one horizontal band (a number line, a timeline, an enumeration), usually ~20% of canvas height.

## Frame density — avoid empty frames

Common failure: small elements floating in the center with empty space around them. Every frame must feel **intentionally filled**.

- **Primary visual occupies ≥ 40% of canvas** — hero text 50-75% height × 60-80% width; a centered card 30-50% × 50-70%; a diagram big enough to read its labels.
- **≥ 3 visual layers** — background (gradient / particles / grid) + midground (main content) + foreground (emphasis / decoration).
- **Openings and closings** are prone to emptiness — a bare background + a lonely line of text reads as placeholder. Add environmental layers: dual-radial swell, floating particles, brand-color ambient texture, low-opacity scanlines or a hairline grid.
- **Text-only frames still need visual elements** — a coined-term card, an icon, a halftone field, brand-derived geometry, an underline that draws on.

**Fullness test:** could this frame stand as a poster or social graphic? If it looks like a sparse slide → add layers.

## Negative space

Whitespace directs attention, it isn't waste. Tight grouping (icon + label) → small spacing; unrelated groups → large separation; asymmetric outer margins feel more designed than equal padding; a hero word keeps large side whitespace so one word carries the weight. **Failure modes:** everything equidistant (no grouping); unintended overlap; text tight against an edge; captions colliding with bottom visuals; the framework's default padding everywhere.

## In-frame visual hierarchy

Visual weight, strong → weak: **large element** › **motion** (moving beats static) › **high contrast** › **type scale** › **position** (center + upper third are golden). Combine **at least two** — an element that is large, moving, and upper-third is unquestionably primary.

A title that is only _larger_ (sharing weight/color/spacing with body) reads weak. Stack dimensions:

| Dimension | Strong contrast                             |
| --------- | ------------------------------------------- |
| Size      | 3:1 ratio or larger                         |
| Weight    | 800-900 vs 400                              |
| Color     | high contrast against background            |
| Motion    | one element moving vs all else static       |
| Position  | top / left = primary                        |
| Space     | large surrounding whitespace vs equidistant |

## Cards and grouping

Spacing + alignment can group without a card container. **Use cards** when content is genuinely distinct (a list item, a definition, a stat callout) or when shadow-stacking communicates "lifted." **Don't** card for mere separation (use whitespace) or for a continuous diagram. **Never nest cards** — claustrophobic, muddy hierarchy.

## Inventing the visual — diagrams, type, data-viz

This is a **faceless** explainer: the frame's hero is something you design, not a screenshot. The three first-class treatments:

- **Typographic / kinetic type** — the hero word, the coined term, a number, a short enumeration. Treat type as the subject: full-bleed scale, weight contrast, one emphasized term. Strongest for hooks, concept names, takeaways.
- **Abstract graphics** — shapes, fields, paths, geometry that _embody_ the idea (the snowball, the spotlight, the staircase-not-cliff). Build the metaphor the script names; don't decorate with generic bokeh.
- **Diagram / data-viz** — nodes + edges, a chart, a number line, a formula, a process flow. The build (each part appearing on beat) is the teaching — design it to assemble, not appear whole.

Make the invented hero **fill 40-60% of the frame** — a diagram big enough to read, a hero word near full-bleed. Don't shrink the one designed element into decoration around empty space.

## Depth on a 2D canvas

Layer **2-3 depth techniques** per frame to avoid a flat poster (concrete perspective / rotate / scale values are the worker's):

| Technique        | Effect                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Size difference  | larger = nearer, smaller = farther                                                         |
| Blur             | blurred = background, sharp = foreground                                                   |
| Opacity gradient | low = receding, full = primary                                                             |
| Overlap          | foreground partially covers background                                                     |
| Shadow stacking  | three-layer shadow = lift + brand feel                                                     |
| Motion speed     | faster parallax = closer                                                                   |
| Counter-scale    | camera pushes toward focus → background appears larger, focal CSS scale <1 but fills frame |

You write "3 depth layers: background swell + midground diagram + foreground label glow; background counter-scales for the push"; the worker writes the scale values.

## What should not appear

Nav bars, footers, cookie banners, scrollbars, cursor arrows, browser chrome, unclickable buttons, generic decorative shapes standing in for a designed metaphor, floating bokeh / purple-to-blue AI gradients (the "default AI cliché," banned). Faceless explainers have no real interface to show — an interface mock is correct **only** when the topic itself is about that interface and the frame intentionally reconstructs it.

## Composition note example

> "Composition: asymmetric 60/40 — the node-graph diagram occupies left 60%, the layer label + caption right 40%. Generous safe margin; text capped inside the primary content area. 3 depth layers: background hairline grid + midground graph + foreground active-node glow. Density: primary visual ~55%, ambient adds a 5% scanline."

One line per frame; never concrete px / scale / shadow recipes (the worker writes those).
