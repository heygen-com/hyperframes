---
version: alpha
name: Bold Poster — Frame (video / frame layer)
description: >
  Video-first companion to Bold Poster's design.md. The unit is the frame (1920×1080). Atoms are
  identical and sacred — the four-color palette (white / brown-black ink / tomato red / off-white),
  the three-face stack (Shrikhand display tilted at poster scale, Libre Baskerville serif body,
  Space Grotesk mono chrome), the stacked text-shadow on red display, the 3px+1.5px double-border
  grid, red leftbar cards, red em-dash bullets, and the red progress bar. Composition + frame scale
  rewritten. Motion out of scope.
unit: the frame — 1920×1080 primary; 9:16 and 1:1 documented
principle: atoms are sacred · composition is free · numbers come from the script

colors:
  bg: "#FFFFFF"
  dark: "#1C1410"
  red: "#D8000F"
  light: "#F5F2EF"

typography:
  # — reading + chrome ramp —
  body:    { fontFamily: "Libre Baskerville", cqw: 0.85, weight: 400, lineHeight: 1.75, color: "dark" }
  body-cell:{ fontFamily: "Libre Baskerville", cqw: 0.7, weight: 400, lineHeight: 1.55 }
  label:   { fontFamily: "Space Grotesk", px: 10, weight: 600, tracking: "2px", upper: true, color: "red" }
  bullet-body:{ fontFamily: "Space Grotesk", cqw: 0.62, weight: 400, lineHeight: 1.45 }
  # — display / hero ramp (Shrikhand 400, tilted) —
  card-title:{ fontFamily: "Shrikhand", cqw: 1.9, weight: 400, lineHeight: 1.1, color: "dark" }
  cell-number:{ fontFamily: "Shrikhand", cqw: 2.7, weight: 400, lineHeight: 1.0, color: "red" }
  section-header:{ fontFamily: "Shrikhand", cqw: 3.3, weight: 400, lineHeight: 1.0, color: "dark" }
  red-quote:{ fontFamily: "Shrikhand", cqw: 4.7, weight: 400, lineHeight: 1.15, color: "bg", shadow: "stacked" }
  hero-title-bottom:{ fontFamily: "Shrikhand", cqw: 10.4, weight: 400, lineHeight: 0.9, color: "dark", rotate: "2deg" }
  hero-title:{ fontFamily: "Shrikhand", cqw: 11.5, weight: 400, lineHeight: 0.88, color: "dark" }
  hero-title-red:{ fontFamily: "Shrikhand", cqw: 13.5, weight: 400, lineHeight: 0.85, color: "red", rotate: "-4deg" }
  close-big:{ fontFamily: "Shrikhand", cqw: 13.5, weight: 400, lineHeight: 0.88, color: "red", rotate: "-5deg" }
  stat-big:{ fontFamily: "Shrikhand", cqw: 22.0, weight: 400, lineHeight: 0.82, color: "red", rotate: "-6deg" }

spacing:
  pad-slide: "3cqw 3.6cqw"
  gap-grid: "1.5cqw 2cqw"

components:
  progress-bar:
    backgroundColor: "{colors.red}"
    size: "0.5cqw tall, bottom edge, width grows with index"
    description: "The most prominent chrome."
  hero-title-stack:
    typography: "{typography.hero-title} + {typography.hero-title-red} + {typography.hero-title-bottom}"
    transform: "≥4 tilt (−4°/+2°), ≥1 line in {colors.red}"
    description: "A 3-line Shrikhand composition — the signature opener."
  stat-big:
    typography: "{typography.stat-big}"
    color: "{colors.red} (or {colors.bg} on red with stacked shadow)"
    transform: "rotate(-6deg)"
    description: "Hero numeral at poster scale."
  fin-grid:
    border: "0.3cqw solid {colors.dark} outer"
    rule: "0.15cqw solid {colors.dark} inner (touching at intersections)"
    rounded: "0"
    typography: "{typography.cell-number} ({colors.red}) + {typography.label} + {typography.body-cell}"
    description: "The double-border tabular signature."
  red-leftbar-card:
    borderLeft: "4px solid {colors.red}"
    padding: "0 0 0 ~1cqw"
    rounded: "0"
    shadow: "none"
    typography: "{typography.card-title} + {typography.body} + red em-dash bullets"
    description: "Editorial card cantilevered off a red left rule — no outline."
  red-panel:
    backgroundColor: "{colors.red}"
    textColor: "{colors.bg}"
    description: "Full-bleed statement surface; display carries the stacked text-shadow."
  dark-panel:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.bg}"
    description: "Full-bleed dark statement surface; red accents."
  stacked-text-shadow:
    shadow: "2px 2px 0 rgba(28,20,16,.25), 4px 4px 0 rgba(28,20,16,.2), 6px 6px 0 rgba(28,20,16,.15)"
    appliesTo: "red display text on red panels only"
    description: "The ONLY shadow in the system — text-shadow, not box-shadow."
  bullet:
    marker: "red em-dash (—) or round (•) glyph at absolute-left"
    color: "{colors.red}"
    description: "No default disc bullets; capped at three."
---

# Bold Poster — Frame (video / frame layer)

## Overview

Bold Poster at frame scale is a **populist editorial poster** — vintage Italian sports-magazine
display, classical serif body, one saturated tomato red, grids ruled in ink. Every frame should
feel _printed_: heavy display type at poster scale, locked to one red accent, on a white/off-white
sheet (or a full red/dark statement panel), with decoration kept to a strict minimum.

The voice is a three-face stack: **Shrikhand** (heavy slab-script, weight 400 only, routinely
tilted −6°..+2°) carries every hero title, section header, stat, and card title; **Libre
Baskerville** (literary serif) carries every body paragraph — it's what makes the system feel
printed; **Space Grotesk** (uppercase, 2–3px tracked) is chrome only — labels, eyebrows, counters,
bullet bodies. The plane is flat; the _only_ shadow is the stacked text-shadow on red display.

**Key characteristics at frame scale:**

- **Four colors only** — white / brown-black ink / tomato red / off-white. Red is the lone accent.
- **Shrikhand display, tilted** (−6° stat, −5° close, −4° hero-red, +2° hero-bottom) — the signature movement.
- **Libre Baskerville serif body** (line 1.75); **Space Grotesk** chrome (uppercase tracked).
- **Double-border grids** (3px outer + 1.5px inner ink); **red leftbar cards**; **red em-dash bullets** (max 3).
- **Stacked text-shadow** on red display — the only shadow; flat plane otherwise; square corners.
- **Red progress bar** at the bottom edge of every frame.

## The Frame

### Frame Craft Bar

Three eyeball tests gate every frame before any structural check:

- **Squint** — **one display moment dominates** at 3–6× everything else (the hero stack, `stat-big`, or `close-big`); nothing competes.
- **Silence** — statement frames reserve **~50–60% negative space**; the **financial grid is the one dense exception**.
- **Restraint** — **four colors only**, red the lone accent; one display moment per frame; the stacked text-shadow on red is the only shadow; bullets capped at three.
- **Reference** — aim at a **vintage Italian sports-magazine cover / mid-century European annual report**; failure looks like a **rounded, soft-shadowed multi-accent slide**.

- **Primary:** 1920×1080 (16:9). Display authored in **`cqw`** (`px ÷ 1920 × 100 = cqw`).
- **Vertical:** 1080×1920 (9:16). **Square:** 1080×1080 (1:1).
- **Safe area:** `pad-slide` ~3cqw — deliberately tight so the poster type crowds the frame.

**The container law (load-bearing).** Every frame ground sets `container-type: size`; ALL
frame-relative units are `cqw`/`cqh` against it — never `vw`. Borders stay px; rotation transforms hold.

## Colors

Tokens identical to the source. `{colors.bg}` white is the default ground; `{colors.dark}` is body,
borders, headers; `{colors.red}` is the only accent — every numeral, section rule, eyebrow,
leftbar, bullet, progress bar, and the full statement-panel ground. `{colors.light}` off-white
stripes alternating panels. **No fifth color** (no green/blue/yellow); categorical difference comes
from position, label, and tilt. Red is never body text, never a tint, never an untexted fill.

## Typography

Two ramps. The **reading/chrome ramp** (Baskerville body 0.85cqw, Space Grotesk labels in px)
carries copy + chrome; the **display ramp** (Shrikhand `section-header` 3.3cqw → `stat-big` 22cqw)
carries every statement and numeral.

- **Legibility floor:** any load-bearing line ≥ **1.4cqw**; mono labels are chrome only.
- **Fit-to-measure:** size the headline to its length. Cap the block at **≤ 78cqw**; ≤2 words → `stat-big`/`hero-title-red`; 3–4 → `hero-title`; 5+ → `section-header`. The hero is a stacked 3-line composition.
- **Shrikhand is weight 400, tilted on statement/hero elements, red on numerals**; **Baskerville body at line ≥1.5**; **Space Grotesk chrome uppercase, 2–3px**. Inline `<strong>` switches face to Space Grotesk 600. No italic display, no untilted red hero.

## Depth & Surface

Flat plane. Depth from:

- **Heavy borders** — 3px+1.5px double-border grids, 2px global-card outline, 4px red leftbar rules.
- **Surface inversion** — full-bleed red or dark statement panels.
- **Tilt** — rotated Shrikhand breaks the baseline for perceived dimension.
- **The single shadow** — stacked text-shadow on red display only (text-shadow, three steps).

**Ceiling:** no box-shadow, no rounded surface (square corners; only the hint pill is 4px), no gradient.

## Shapes

- **0 radius everywhere** except the hint pill (4px). Cards, cells, panels, callouts — sharp rectangles.

## Components

- **hero-title-stack** — the 3-line tilted opener. **stat-big** — the poster numeral.
- **fin-grid** — the double-border tabular signature. **red-leftbar-card** — the cantilevered editorial card.
- **red-panel / dark-panel** — statement surfaces. **stacked-text-shadow** — the one shadow.
- **bullet** — red em-dash (max 3). **progress-bar** — the red bottom strip.

## Frame Treatments

> Recipe: ground · register · composes · focal · chrome · accent · silence · Fixed/Free · density.
> One display moment per frame; statement frames reserve massive negative space.

### 1 · Hero Stack (identity · move: 3-line tilted stack · left)

**Ground** white. **Composes** hero-title-stack, label, body tagline, progress-bar. **Focal** a
3-line Shrikhand stack (e.g. ink / red-tilted / paper) — one red line, one+ tilted. **Chrome** mono
eyebrow + Baskerville tagline; bottom progress bar + counter. **Accent** the red line. **Silence**
right half open. **Fixed** Shrikhand 400, ≥1 tilt + ≥1 red, square. **Free** the words, line sizes.
**Density** low.

### 2 · Hero Stat (statement · move: poster numeral · red panel · centered)

**Ground** full `{colors.red}`. **Composes** stat-big, label, body sub. **Focal** a `stat-big`
numeral rotated −6° in white with the stacked shadow, centered, with a mono label above + Baskerville
sub below. **Accent** the ink stacked-shadow on white. **Silence** ~60%. **Fixed** white-on-red +
stacked shadow, −6° tilt. **Free** the figure (from script), label. **Density** low.

### 3 · Financial Grid (data · move: double-border matrix · the dense frame)

**Ground** white, `pad-slide`. **Composes** label, section-header, fin-grid. **Focal** a 3px-outer/
1.5px-inner ink grid of cells (red Shrikhand numeral + mono label + Baskerville body). **Chrome** mono
eyebrow; progress bar. **Accent** the red numerals. **Silence** tight — the density exception.
**Fixed** double-border, red numerals, serif body. **Free** figures (from script), labels. **Density** dense-exception.

### 4 · Pull Quote (quote · move: tilted/stacked display · red panel · left)

**Ground** full `{colors.red}`. **Composes** red-quote, Baskerville cite. **Focal** a 2-line Shrikhand
quote in white with the stacked shadow; a Baskerville cite beneath. **Accent** the stacked shadow.
**Silence** ~50%. **Fixed** white-on-red + stacked shadow. **Free** quote, cite. **Density** low.

### 5 · Editorial Cards (content · move: red leftbar cards · left)

**Ground** white (or alternating off-white stripes). **Composes** label, section-header, 2–3×
red-leftbar-card. **Focal** cards cantilevered off 4px red rules — Shrikhand title + Baskerville body

- red em-dash bullets (max 3). **Accent** the red left rules + bullets. **Silence** moderate. **Fixed**
  4px red leftbar, em-dash bullets, no outline. **Free** card content. **Density** standard.

### 6 · Closing Statement (closer · move: tilted close-big · centered/left)

**Ground** white or `{colors.dark}`. **Composes** close-big, label, body sub, progress-bar. **Focal**
a Shrikhand `close-big` (rotated −5°, red) sign-off; mono eyebrow + Baskerville contact line. **Accent**
the red tilted title. **Silence** ~60%. **Fixed** −5° tilt, red close-big. **Free** sign-off, contact.
**Density** low.

## Composition Rules

### Do

- Stack hero titles in 3 Shrikhand lines — at least one tilted, at least one red.
- Make every numeral **red Shrikhand**; tilt statement display **−5° to −6°**.
- Set eyebrows in **Space Grotesk 600 uppercase, 2–3px**, red; body in **Baskerville, line 1.75**.
- Build data grids with the **3px outer + 1.5px inner double border**; use red leftbar cards elsewhere.
- Use **red em-dash bullets, capped at three**; apply the stacked text-shadow on red display.
- One display moment per frame; reserve negative space on statement frames.

### Don't

- No second accent color; no rounded corners (square only, save the hint pill).
- No drop shadow — the stacked text-shadow on red is the only one.
- No font substitutes; no Shrikhand body, no Baskerville labels, no Space Grotesk headlines.
- No default disc bullets; no untilted red statement display.
- Don't crowd a statement frame; don't blow a long line edge-to-edge (step down).

## Aspect-Ratio Behavior

| Treatment       | 16:9                      | 9:16                     | 1:1                  |
| --------------- | ------------------------- | ------------------------ | -------------------- |
| Hero Stack      | stack left, tagline below | stack centered, taller   | stack, tagline below |
| Hero Stat       | numeral centered          | numeral centered, taller | centered             |
| Financial Grid  | 3 cells across            | 2 across / stacked       | 2×2                  |
| Pull Quote      | quote left                | quote stacked            | centered             |
| Editorial Cards | 2–3 across                | stacked                  | stacked              |
| Closing         | close-big centered        | close-big stacked        | centered             |

`pad-slide` stays tight on the short edge; re-step display so the line stays ≤78cqw above the floor.
Tilts hold; the progress bar spans the bottom on every ratio.

## Approved Entities

No real customers, logos, or vendors are defined in the source — render any such mark as a
placeholder. The system supplies type, one red, and ink rules, not brands.

## Numerals & Claims (hard rule)

Never invent figures, financials, percentages, or dates at frame scale. Render slots as `— figure —`,
`{metric}`, `+NN%`. Fin-grid cells and stat-big especially carry placeholders until the script
supplies them. Catalogue numbers / progress are decorative.

## Pre-Render Self-Audit

- **Squint** — one display moment dominates; nothing competes.
- **Silence** — statement frames reserve ~50–60% negative space; only the fin-grid runs dense.
- **Color** — four colors only; red is the lone accent; no red body text.
- **Type** — Shrikhand 400 tilted on statements, red numerals, fit-to-measure; Baskerville body line 1.75; mono chrome uppercase 2–3px; ≥1.4cqw floor.
- **Depth** — flat; the stacked text-shadow on red display is the only shadow; square corners.
- **Bullets** — red em-dash, capped at three.
- **Fabrication** — every numeral traces to the script, else placeholder.

## Known Gaps

- **Motion intentionally out of scope.** frame.md specifies composition only; the source's 550ms slide transitions are deck mechanics.
- **Shrikhand + Libre Baskerville + Space Grotesk via Google Fonts.** CJK: Noto Serif SC 900/400 + Noto Sans SC; Shrikhand's slab-script has no Hanzi equal — keep tilts + red + double-borders to carry the identity.
- **9:16 / 1:1 are guidance**; verify the one big line ≤78cqw per ratio and that tilts don't clip.
- Grids, leftbar cards, and the stacked shadow are CSS-only; no external imagery is required.
