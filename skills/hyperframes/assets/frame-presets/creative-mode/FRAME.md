---
version: alpha
name: Creative Mode — Frame (video / frame layer)
description: >
  Video-first companion to Creative Mode's design.md. The unit is the frame (1920×1080),
  not the slide-in-a-deck. Atoms are identical and sacred — warm cream canvas, 4px ink
  borders, hard offset shadows (no blur), Archivo Black uppercase at 0.92 line-height,
  JetBrains Mono taxonomy, Space Grotesk body, the four-accent palette. Composition,
  frame scale, and aspect-ratio behavior are rewritten for the frame. Motion is out of scope.
unit: the frame — 1920×1080 primary; 9:16 and 1:1 documented
principle: atoms are sacred · composition is free · numbers come from the script

colors:
  cream: "#EFE9D9"
  cream-2: "#E4DCC4"
  ink: "#0F0F0F"
  ink-2: "#2A2A2A"
  green: "#1F8A4C"
  green-dark: "#136636"
  pink: "#F06CA8"
  pink-dark: "#D14E8B"
  orange: "#E85A1F"
  yellow: "#F5C518"

typography:
  # — reading ramp (px @ 1920, with cqw) —
  body-lg:    { fontFamily: "Space Grotesk", px: 28, cqw: 1.46, weight: 400, lineHeight: 1.4 }
  body-md:    { fontFamily: "Space Grotesk", px: 24, cqw: 1.25, weight: 400, lineHeight: 1.3 }
  mono-label: { fontFamily: "JetBrains Mono", px: 24, cqw: 1.25, weight: 400, tracking: "0.06em", upper: true }
  mono-kicker:{ fontFamily: "JetBrains Mono", px: 24, cqw: 1.25, weight: 400, tracking: "0.14em", upper: true }
  table-head: { fontFamily: "Archivo Black", px: 28, cqw: 1.46, weight: 400, upper: true }
  # — display / hero ramp (frame-native, cqw-first) —
  step-title: { fontFamily: "Archivo Black", px: 34,  cqw: 1.77, weight: 400, lineHeight: 1.0, upper: true }
  badge-label:{ fontFamily: "Archivo Black", px: 28,  cqw: 1.46, weight: 400, upper: true }
  marker:     { fontFamily: "Archivo Black", cqw: 2.4, weight: 400, lineHeight: 1.0, upper: true }
  stamp-num:  { fontFamily: "Archivo Black", cqw: 2.2, weight: 400, lineHeight: 0.9 }
  stat-num:   { fontFamily: "Archivo Black", cqw: 6.4, weight: 400, lineHeight: 0.88 }
  step-num:   { fontFamily: "Archivo Black", cqw: 7.0, weight: 400, lineHeight: 0.85 }
  display-head: { fontFamily: "Archivo Black", cqw: 4.2, weight: 400, lineHeight: 0.92, tracking: "-0.01em", upper: true }
  display-lg: { fontFamily: "Archivo Black", cqw: 8.0,  weight: 400, lineHeight: 0.9,  tracking: "-0.01em", upper: true }
  display-xl: { fontFamily: "Archivo Black", cqw: 11.0, weight: 400, lineHeight: 0.9,  tracking: "-0.01em", upper: true }
  display-hero:{ fontFamily: "Archivo Black", cqw: 15.5,weight: 400, lineHeight: 0.84, tracking: "-0.02em", upper: true }

spacing:
  frame-pad: "3.3cqw"        # 64px chrome gutter @1920
  content-gutter: "5cqw"     # 96px content gutter @1920
  grid-gap: "1.5cqw"         # 28px
  cell-pad: "1.7cqw"         # 32px

components:
  frame-chrome:
    typography: "{typography.mono-label}"
    placement: "topbar 2.5cqw from top, meta 2.5cqw from bottom, both inset {spacing.frame-pad}"
    rounded: "0"
    shadow: "none"
    description: "Mono topbar (section label left + 999px ink-stroked pill right) + meta footer (descriptor left + NN • NN counter right, 0.5cqw ink dot divider). Present on most frames."
  stat-cell:
    backgroundColor: "{colors.green} · {colors.pink} · {colors.orange} · {colors.cream}"
    textColor: "{colors.cream} on accent · {colors.ink} on cream"
    border: "0.4cqw solid {colors.ink}"
    rounded: "0"
    padding: "{spacing.cell-pad}"
    typography: "{typography.stat-num} + {typography.mono-label}"
    shadow: "none"
    description: "Flat accent/cream stat tile, square corners, no shadow."
  step-card:
    backgroundColor: "{colors.cream} · {colors.pink} · {colors.yellow} · {colors.green}"
    border: "0.4cqw solid {colors.ink}"
    rounded: "0"
    padding: "{spacing.cell-pad}"
    typography: "{typography.step-num} + {typography.step-title} + {typography.body-md}"
    shadow: "none"
    description: "Ink-bordered card; giant step-num top. Sequence alternates cream with accents and ENDS on green."
  marker-block:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.ink}"
    border: "0.4cqw solid {colors.ink}"
    rounded: "0"
    typography: "{typography.marker}"
    shadow: "1.25cqw 1.25cqw 0 {colors.orange}, 1.25cqw 1.25cqw 0 0.2cqw {colors.ink}"
    description: "The one hard-offset featured callout per frame."
  kicker-block:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    typography: "{typography.mono-kicker}"
    padding: "0.5cqw 1cqw"
    rounded: "0"
    description: "Inverted eyebrow chip."
  badge-rotated:
    backgroundColor: "{colors.yellow}"
    border: "0.4cqw solid {colors.ink}"
    typography: "{typography.badge-label}"
    rounded: "0"
    transform: "rotate(-4deg)"
    description: "Deliberate-imperfection annotation."
  pill-badge:
    backgroundColor: "{colors.cream}"
    border: "0.2cqw solid {colors.ink}"
    rounded: "999px"
    typography: "{typography.mono-label}"
    description: "The ONLY rounded element; reads as a chip, not a card."
  stamp:
    backgroundColor: "{colors.pink}"
    border: "0.4cqw solid {colors.cream}"
    size: "~18cqw square"
    rounded: "0"
    transform: "rotate(-6deg)"
    typography: "{typography.stamp-num}"
    description: "Closing seal with a cream circular inner ring."
  comparison-table:
    backgroundColor: "{colors.cream-2}"
    border: "0.4cqw solid {colors.ink}"
    rule: "0.3cqw solid {colors.ink}"
    rounded: "0"
    typography: "{typography.table-head} + {typography.body-md}"
    shadow: "none"
    description: "Ink head row with cream Archivo labels; pink/green column-fill variants."
  decorative-circle:
    backgroundColor: "{colors.yellow}"
    border: "0.4cqw solid {colors.ink}"
    rounded: "50%"
    description: "Decorative figure; pairs with a green panel for shape contrast."
---

# Creative Mode — Frame (video / frame layer)

## Overview

Creative Mode at frame scale is a **neo-brutalist editorial poster in motion's clothing** — warm
cream paper, near-black ink, and four accents that collide at full saturation. Every frame is one
flat color-blocked composition: no gradients, no blurred shadows, no rounded cards (save the one
pill chip). Depth is **hard offset shadow** (a solid same-direction duplicate) or **color-block
contrast**, never light.

The display voice is **Archivo Black in strict uppercase at 0.92 line-height** — letters overlap
their own cap height; that tightness is the brand. **JetBrains Mono** carries every label, kicker,
counter, and axis as a "technical artifact" register. **Space Grotesk** carries the few body lines.
The frame is loud by construction and calm by restraint: two or three accents per frame, the green
ground reserved for a single closing plate, the hard shadow spent on one featured element only.

**Key characteristics at frame scale:**

- **Cream ground** (`{colors.cream}`) on nearly every frame; `{colors.green}` reserved for the closing plate.
- **0.4cqw (4px @1920) ink borders** on every structural element; 0.3cqw internal rules.
- **Hard offset shadow** (≈1.25cqw, orange+ink) on one featured block per frame — never blurred.
- **Archivo Black uppercase**, 0.92 line-height, always; sentence-case Archivo Black does not exist.
- **Two or three accents per frame**, never all four; collisions are the design.
- **One pill chip** (999px) per frame as the sole rounded element.

### Frame Craft Bar

Three eyeball tests gate every frame before any structural check:

- **Squint** — exactly one element dominates, at **3–6× its nearest neighbor** (a chasm, not a ramp): the `display-hero`/`display-xl` claim or the `stat-num` figure, never two rival headlines.
- **Silence** — sparse frames (cover, claim, closer) read **45–60% empty**; the **stat grid and comparison ledger are the one dense exception**. Never fill a sparse frame to look complete.
- **Restraint** — the scarce gestures fire **once per frame**: at most one hard-offset shadow, two-to-three accents (never all four), the green ground reserved for the single closing plate.
- **Reference** — aim at a **Risograph editorial poster / punk-zine spread** (flat ink-bordered blocks, one big claim, vast cream); failure looks like a **rounded, soft-shadowed SaaS feature grid**.

## The Frame

- **Primary:** 1920×1080 (16:9). All display sizes authored in **`cqw`** (`px ÷ 1920 × 100 = cqw`).
- **Vertical:** 1080×1920 (9:16). **Square:** 1080×1080 (1:1).
- **Safe area:** chrome at `3.3cqw` (64px) inset; content at `5cqw` (96px) gutter. No load-bearing element crosses the `3.3cqw` line.

**The container law (load-bearing).** Every frame ground sets `container-type: size`. ALL
frame-relative units are `cqw`/`cqh` (1cqw = 1% of the frame's width), resolved against that
ground — **never `vw`.** `vw` measures the page viewport, so a frame inflates whenever it isn't
rendered full-screen; `cqw` resolves against the frame at any render size. This is why every size
in the display ramp is `cqw`.

## Colors

Tokens identical to the source. At frame scale: `{colors.cream}` is the **ground**, `{colors.ink}`
is borders + type, and the four accents (`green` / `pink` / `orange` / `yellow`) are **flat fills
rationed two-to-three per frame.** `{colors.orange}` is also the hard-shadow color. `{colors.green}`
doubles as the single closing-plate ground — its rarity is the impact. Never introduce a fifth
accent; never use pure white; never gradient.

## Typography

Two ramps. The **reading ramp** (body, mono labels, table heads) holds px+cqw for chrome and copy.
The **display/hero ramp** is frame-native and authored in `cqw` — from `display-head` (4.2cqw) up
to `display-hero` (15.5cqw) for a wordmark cover.

- **Legibility floor:** any load-bearing line ≥ **1.4cqw (≈27px@1920)**. Mono chrome at 1.15cqw is colophon only.
- **Fit-to-measure:** a headline's size tracks its line length. Cap the headline block at **≤ 78cqw** and never touch the safe margin. ≤3 words → `display-hero`/`display-xl`; 4–6 words → `display-lg`; 7+ words → `display-head`. Short lines go big; long lines step down.
- **Uppercase + 0.92 line-height on all Archivo Black**, always. Mono carries 0.06–0.14em tracking. Never letter-space Archivo Black beyond the encoded −0.01em; never set body centered.

## Depth & Surface

Zero blur. Two depth devices only:

- **Hard offset shadow** — a solid duplicate offset ≈1.25cqw in X and Y (`box-shadow: 1.25cqw 1.25cqw 0 {colors.orange}, 1.25cqw 1.25cqw 0 0.2cqw {colors.ink}`). **One featured block per frame** (marker, stamp). Diagram stacks may use a 0.95cqw ink-only offset.
- **Color-block contrast** — cream on cream-2, ink on cream, accent on cream. No shadow needed when contrast carries.

**Ceiling:** no blurred shadow, no gradient, no glow, anywhere.

## Shapes

- **0 radius** on every structural element — stat cells, step cards, table cells, markers, panels.
- **50%** on decorative circles, stamp inner ring, the meta dot.
- **999px** on the topbar pill chip only — the single rounded exception.
- **Rotation** only at the fixed brand angles: badge −4deg, stamp −6deg.

## Components

- **frame-chrome** — the mono topbar + meta footer. Present on most frames; dropped only on a pure full-bleed wordmark beat if it competes.
- **stat-cell / step-card** — ink-bordered flat-fill blocks; step sequences end on green.
- **marker-block** — the one hard-shadow featured callout per frame.
- **kicker-block** — inverted ink eyebrow chip; **badge-rotated** — −4deg yellow annotation; **pill-badge** — the lone rounded chip.
- **stamp** — the −6deg closing seal. **comparison-table** — cream-2 ledger with ink head row.
- **decorative-circle** — yellow disc for shape contrast against a green panel.

## Frame Treatments

> Recipe per plate: ground · container · composes · focal · chrome · accent · silence · Fixed/Free · density.
> Authored at 1920×1080. Lean centered; vary the anchor; one idea per frame.

### 1 · Wordmark Cover (identity · move: full-frame lockup · centered)

**Ground** `{colors.cream}`, `frame-pad`. **Container** grid, chrome top/bottom, focal centered.
**Composes** frame-chrome, the wordmark. **Focal** the two-line wordmark at `display-hero`
(15.5cqw), centered, second line in an accent (`{colors.pink}`/`orange`). **Chrome** mono topbar
(section label + pill) and meta footer (descriptor + 01•NN). **Accent** the second-line color only;
optionally one corner decorative-circle bleeding off an edge. **Silence** ~55% empty cream.
**Fixed** Archivo Black uppercase 0.84 lh, one accent on the wordmark, square corners. **Free** which
accent, line break, whether a circle bleeds a corner. **Density** sparse.

### 2 · Big Claim (oversized statement · move: scale · left)

**Ground** one full-bleed accent (`{colors.pink}`/`green`/`orange`), `content-gutter`. **Container**
flex, claim left-anchored and vertically centered. **Composes** kicker-block, the claim. **Focal**
a 2–3 line claim at `display-xl`/`display-lg`, ink on the accent (ink-on-fire — never white).
**Chrome** small ink kicker-block above the claim; mono meta footer. **Accent** the ground IS the
accent; no second accent competes. **Silence** ~45% of the colored field empty. **Fixed** ink type
on accent, fit-to-measure sizing, no shadow on type. **Free** the claim, which accent ground, which
word breaks. **Density** sparse — one idea.

### 3 · Stat Grid (catalog · move: density — the one dense frame · centered)

**Ground** `{colors.cream}`, `content-gutter`. **Container** grid: a centered `display-head` over a
3-up row of stat-cells. **Composes** frame-chrome, 3× stat-cell. **Focal** the row of three
ink-bordered cells (green / pink / orange), each a `stat-num` + mono label. **Chrome** mono topbar +
meta. **Accent** the three cell fills (the named density exception — three accents allowed here).
**Silence** ~25% — tight by design. **Fixed** 0.4cqw borders, square corners, no per-cell shadow,
mono labels. **Free** the three figures+labels, head copy, which three accents. **Density** dense-exception.

### 4 · Closing Plate (closer · move: ground-swap · centered)

**Ground** `{colors.green}` (the single green frame of the run), `frame-pad`. **Focal** a 2-line
sign-off at `display-lg` in `{colors.cream}`, centered. **Composes** frame-chrome (cream variant),
stamp. **Chrome** cream mono topbar + meta. **Accent** one `{colors.pink}` stamp rotated −6deg in
a corner, cream ring + stamp-num. **Silence** ~55% empty green. **Fixed** green ground reserved to
this beat, cream-on-green type, one stamp. **Free** sign-off copy, stamp text, stamp corner. **Density** sparse.

### 5 · Featured Marker (callout · move: hard-shadow focal · left/asymmetric)

**Ground** `{colors.cream}`. **Composes** frame-chrome, marker-block, optional body-md support line.
**Focal** the pink marker-block with the signature orange+ink hard offset shadow, set asymmetrically.
**Accent** pink block + orange shadow (two accents). **Silence** ~50%. **Fixed** exactly one hard
shadow on the frame, 0.4cqw borders. **Free** marker copy, block position, optional support line.
**Density** sparse.

### 6 · Comparison Ledger (data · move: matrix · left)

**Ground** `{colors.cream}`, `content-gutter`. **Composes** frame-chrome, comparison-table.
**Focal** the cream-2 table with ink head row; one column fill (pink or green) marks the winner.
**Accent** the single column fill. **Silence** tight — the second density exception. **Fixed**
cream-2 fill, 0.3cqw internal rules, ink head row with cream Archivo labels. **Free** rows, which
column fills, copy. **Density** dense-exception.

## Composition Rules

### Do

- Compose around **one idea per frame**, focal element **3–5× its neighbors** (squint test).
- **Lean centered** — cover, claim, stat grid, and closer all center their focal element; reserve left/asymmetric for the marker and ledger.
- Keep sparse frames **45–60% empty**; only the stat grid and ledger run dense.
- Use **two or three accents per frame**; reserve `{colors.green}` ground for the closing plate.
- Spend the hard offset shadow on **one featured block per frame**.
- Size headlines **fit-to-measure**; render Archivo Black uppercase at 0.92 lh.

### Don't

- Don't round corners (except the pill chip); don't gradient, blur, or glow.
- Don't set Archivo Black in sentence case or letter-space it beyond −0.01em.
- Don't use all four accents on one frame, a fifth accent, or pure white.
- Don't center body copy or set labels in anything but JetBrains Mono.
- Don't blow a headline edge-to-edge — step the ramp down for long lines.
- Don't put two hard shadows on one frame.

## Aspect-Ratio Behavior

| Treatment         | 16:9                            | 9:16                         | 1:1                      |
| ----------------- | ------------------------------- | ---------------------------- | ------------------------ |
| Wordmark Cover    | two lines centered              | stacked taller, circle top   | centered, tighter        |
| Big Claim         | claim left, full accent         | claim top, accent full       | claim centered           |
| Stat Grid         | head over 3-up row              | head top, 3 stacked          | head top, 2×2 (4th cell) |
| Closing Plate     | sign-off centered, stamp corner | stacked, stamp below         | centered, stamp corner   |
| Featured Marker   | marker asymmetric               | marker centered, shadow down | marker centered          |
| Comparison Ledger | full-width table                | table scrolls to fewer cols  | 2-col table              |

Safe area holds the `3.3cqw` chrome inset on the short edge for every ratio; re-step display per
ratio so no load-bearing line drops below the 1.4cqw floor.

## Approved Entities

No real customers, logos, or vendors are defined in the source — render any such mark as a
placeholder. Products/sections are content-agnostic; the system supplies geometry, not brands.

## Numerals & Claims (hard rule)

Never invent figures, percentages, counts, or dates at frame scale. Render data slots as
`— figure —`, `{metric}`, `N×`. Real numerals appear only when the script supplies them — the stat
grid and ledger especially carry placeholders, not fabricated values.

## Pre-Render Self-Audit

- **Squint** — one element dominates at 3–5× its neighbor, else rescale.
- **Silence** — sparse frames 45–60% empty; only stat grid / ledger run dense.
- **Accents** — two or three per frame, never all four; green ground only on the closer.
- **Depth** — 0 blur; at most one hard offset shadow; color-block contrast otherwise.
- **Geometry** — square corners except the pill; rotation only at −4/−6deg.
- **Type** — Archivo Black uppercase 0.92 lh, fit-to-measure, ≥1.4cqw on load-bearing lines.
- **Anchor** — centered default; left/asymmetric only on marker + ledger; no 3 consecutive frames share an anchor.
- **Fabrication** — every numeral traces to the script, else placeholder.

## Known Gaps

- **Motion intentionally out of scope.** frame.md specifies composition only; timing and transitions are a later stage. The closing green is described as a _plate_, not a transition.
- **Archivo Black requires Google Fonts**; fallback is `sans-serif`. CJK pairing (Noto Serif SC 900 / NSC 400) carries over from the source's CJK section.
- **9:16 / 1:1 are guidance**, not pixel-locked; verify the legibility floor per ratio.
- Decorative geometry (circle, stamp, stacked blocks) is CSS-only; no external imagery is required.
