# Design Spec — `frame.md` / `design.md`

The single source of truth for **what a design spec is, how to find it, and how to read it.** Other references defer here for resolution + format; the _consumption_ contract ("brand, not layout") lives in `video-composition.md`.

## What `frame.md` is

`frame.md` is the **frame-scale design system** for a video / hyperframes project — the video-first companion to `design.md` (which is written for web / static pages). Same file format as `design.md`; it reframes the brand with the frame as the unit.

A spec is **YAML frontmatter + a markdown body**, and the two layers are not equal:

- **Frontmatter is the normative layer** — `colors`, `typography`, `spacing`, `components` are the real, machine-readable values. Quote them verbatim (exact hex, font family, weight); never invent or round them.
- **Prose is context** — the `##` sections (Overview, The Frame, Composition Rules, …) carry intent, when-to-use, and constraints the tokens can't hold. Read them for judgment, not for values.

## Resolving which spec to read

Precedence — read the **first that exists**, ignore the rest:

```
frame.md  →  design.md  →  DESIGN.md
```

```bash
SPEC=$(ls frame.md design.md DESIGN.md 2>/dev/null | head -1)
```

- `frame.md` is the preferred spec for video / hyperframes projects and wins when more than one exists.
- `frame.md` is **always lowercase** — there is no `FRAME.md` variant. (`design.md` and `DESIGN.md` are genuinely different files on Linux; a frame-preset ships an uppercase `FRAME.md` _template_, adopted as lowercase `frame.md` — see "Starting from a preset" below.)

Load the spec **once, in Step 1**; every later step (expansion, authoring, adherence) consumes the already-loaded spec rather than re-resolving it.

## Starting from a preset (optional)

Optionally seed `frame.md` from a ready-made **frame-preset** in `[../frame-presets/](../frame-presets/)` — a fixed set, each shipping a `FRAME.md` template a workflow's design step copies in and overlays with brand tokens. Referencing a preset is **not required**; a bespoke or [picker](design-picker.md)-generated spec is equally valid.

| Preset                                                             | Look                                                                                                                                                                                                                                                                                                                     | Pick when                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `[biennale-yellow](../frame-presets/biennale-yellow/FRAME.md)`     | Literary-editorial catalogue — warm parchment ground, single deep indigo ink, solar yellow as radial bloom / panel / tile underprint, Instrument Serif 400 display (tight, negative-tracked) + Archivo body + JetBrains Mono data, strict rectangles (0 rounded corners), 1px hairline rules as sole border, no shadows  | confident / atmospheric / restrained; a product that wants museum-catalogue elegance and editorial authority                     |
| `[blockframe](../frame-presets/blockframe/FRAME.md)`               | Maximalist neobrutalist — 4px black borders, 8px hard offset shadows, five candy pastels, Inter 800–900 uppercase, square corners, tilted decorations                                                                                                                                                                    | bold / punchy / playful-loud; a product that wants to feel confident and graphic                                                 |
| `[blue-professional](../frame-presets/blue-professional/FRAME.md)` | Consulting-grade restraint — warm cream canvas, single saturated cobalt (#1e2bfa) accent only, Space Grotesk + Inter typography, soft tinted cards (4% fill / 20% border / 10–14px radius) with NO shadows, pill chrome (100px), 3-step gray text ladder, cobalt progress bar                                            | measured / executive-readable / premium-signal; a product that wants investment-research rigor and refined restraint             |
| `[bold-poster](../frame-presets/bold-poster/FRAME.md)`             | Populist editorial poster — Shrikhand display tilted −6°..+2°, Libre Baskerville serif body, Space Grotesk mono chrome, four colors only (white / brown-black ink / tomato red / off-white), double-border grids (3px+1.5px), red leftbar cards, red em-dash bullets, stacked text-shadow on red display, square corners | powerful / printed / restrained; a product that wants editorial authority and vintage gravitas                                   |
| `[broadside](../frame-presets/broadside/FRAME.md)`                 | Protest-poster system — two-register flat plane (ink-black / fire-orange), massive lowercase Barlow 900 treated as graphic primitive, IBM Plex Mono chrome (uppercase, 0.14em), fire-orange sole accent, 1px hairlines, sharp corners, no shadow                                                                         | bold / typographic / declarative; a product that wants presence and authority                                                    |
| `[capsule](../frame-presets/capsule/FRAME.md)`                     | Playful editorial — every container a pill (2px ink outline), cream canvas, nine candy accents, Bodoni Moda + Space Grotesk, soft offset shadows, floating-pill wallpaper                                                                                                                                                | friendly / soft / editorial; a product that wants warmth and approachability                                                     |
| `[cartesian](../frame-presets/cartesian/FRAME.md)`                 | Museum-catalog editorial — 1px taupe hairline grid, five warm-stone palette (#EDE8E0 / #E2DBD1 / #1A1A1A / #5A5A5A / #8A8178), Playfair Display 400 + Inter, sharp corners, compass-drafted geometric rings, zero shadow / zero fill                                                                                     | sparse / literary / restrained; a product that wants quiet authority and editorial rigor                                         |
| `[claude](../frame-presets/claude/FRAME.md)`                       | Warm-editorial brand book — warm cream paper (never pure white), terracotta coral (#CC785C) as scarce voltage, hairline ink elevation (no heavy shadow), EB Garamond serif display + Inter body + JetBrains Mono index / code on a warm-navy code surface, sentence-case display, ✱ coral spike                          | considered / literary / developer-facing; a code change, launch, or doc that wants editorial calm and a first-class code surface |
| `[cobalt-grid](../frame-presets/cobalt-grid/FRAME.md)`             | Modernist two-color risograph — cream paper, electric cobalt ink, permanent graph-paper grid (10% cobalt), top/bottom cobalt hairlines, Newsreader 400 serif + Hanken Grotesk + DM Mono, 0° corners, pixel-glitch column + QR-block patches                                                                              | restrained / systemic / editorial; a product that wants clarity and measured authority                                           |
| `[coral](../frame-presets/coral/FRAME.md)`                         | Bold editorial magazine — three solid surfaces (coral fire / ink black / warm cream) meeting at hard edges, 45° diagonal hatch on coral, Bebas Neue + Inter tracked caps, zero shadows/radius (circles 50%), oversized wallpaper numerals and giant marks                                                                | bold / structuralist / editorial; a product that wants graphic confidence and hard-edged confidence                              |
| `[creative-mode](../frame-presets/creative-mode/FRAME.md)`         | Neo-brutalist editorial — cream canvas, 4px ink borders, hard offset shadows (no blur), four accents rationed two-to-three, Archivo Black uppercase at 0.92 line-height, JetBrains Mono taxonomy, Space Grotesk body, square corners save one pill chip                                                                  | sparse / graphic / punchy-restrained; a product that wants editorial presence and geometric confidence                           |
| `[daisy-days](../frame-presets/daisy-days/FRAME.md)`               | Cheerful picture-book — 3px charcoal outlines, 6/4px hard offset shadows (no blur), nine sunny-garden pastels (cream + turquoise/soft-pink/butter/mint/lavender/peach/sky + coral accent), Fredoka One + Quicksand, generous radii (20–50px), hand-drawn SVG ornament layer (daisies/stars/suns/clouds/rainbows)         | playful / childlike / sticker-sheet kawaii; a product that wants warmth and whimsy                                               |
| `[editorial-forest](../frame-presets/editorial-forest/FRAME.md)`   | Serif-led literary-editorial — green / pink / cream editorial triad, Source Serif 4 weight 500 (opsz) for display + JetBrains Mono 500 uppercase chrome, flat paper depth (no shadows), 2px hairline rules, 6/8px card radii, monogram circle stamp                                                                      | spacious / restrained / editorial; a product that wants quiet confidence and literary tone                                       |

Each preset folder also ships a `frame-showcase.html` — a preview contact sheet of its frame treatments; open it to _see_ the look, never include it in a project.

## Consuming it

How to apply the spec to a frame — strict on brand (hex, fonts, weight relationships, Do's / Don'ts), free on layout — is the consumption contract in `[video-composition.md](video-composition.md)` ("The Design Spec Is Brand, Not Layout"). Read it before choosing colors or writing HTML; this doc only covers finding and parsing the spec.
