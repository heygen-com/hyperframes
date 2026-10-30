---
version: alpha
name: BlockFrame — Frame (video / frame layer)
description: >
  Video-first companion to BlockFrame's design.md. The unit is the frame (1920×1080). Atoms are
  identical and sacred — 4px black borders + 8px hard offset shadows, the five-pastel candy palette
  (pink/blue/green/yellow/cream) plus black/white/off-white, Inter 800–900 uppercase display +
  Space Grotesk label chrome, square corners, label-pills, tilted decorations, star bursts, stripe
  blocks, dot grids. Composition + frame scale rewritten. Motion out of scope.
unit: the frame — 1920×1080 primary; 9:16 and 1:1 documented
principle: atoms are sacred · composition is free · numbers come from the script

colors:
  black: "#000000"
  white: "#FFFFFF"
  offwhite: "#FFFDF5"
  pink: "#FE90E8"
  blue: "#C0F7FE"
  green: "#99E885"
  yellow: "#F7CB46"
  cream: "#FFDC8B"

borders: { primary: "4px solid black", thin: "3px solid black" }
shadows: { default: "8px 8px 0 black", small: "4px 4px 0 black", hover: "6px 6px 0 black", close-yellow: "12px 12px 0 yellow", close-white: "6px 6px 0 white" }

typography:
  # — reading + chrome ramp —
  body:    { fontFamily: "Inter", cqw: 0.95, weight: 500, lineHeight: 1.6 }
  card-title:{ fontFamily: "Inter", cqw: 1.15, weight: 700, upper: true, lineHeight: 1.2 }
  label:   { fontFamily: "Space Grotesk", px: 13, weight: 600, tracking: "0.08em", upper: true }
  counter: { fontFamily: "Space Grotesk", px: 14, weight: 700, tracking: "0.1em", upper: true }
  # — display ramp (Inter 800–900, uppercase, negative tracking) —
  heading-md:{ fontFamily: "Inter", cqw: 2.1, weight: 700, lineHeight: 1.1, tracking: "-0.01em", upper: true }
  quote-text:{ fontFamily: "Inter", cqw: 2.7, weight: 900, lineHeight: 1.15, tracking: "-0.02em", upper: true }
  stat-number:{ fontFamily: "Inter", cqw: 3.3, weight: 900, lineHeight: 1.0 }
  heading-lg:{ fontFamily: "Inter", cqw: 3.3, weight: 800, lineHeight: 1.0, tracking: "-0.02em", upper: true }
  close-title:{ fontFamily: "Inter", cqw: 4.2, weight: 900, lineHeight: 0.95, tracking: "-0.03em", upper: true }
  heading-xl:{ fontFamily: "Inter", cqw: 5.0, weight: 900, lineHeight: 0.95, tracking: "-0.03em", upper: true }

spacing:
  slide-pad: "3.1cqw"   # 60px @1920
  gap-md: "1.7cqw"

components:
  card-elevated:
    backgroundColor: "{colors.white}"
    border: "0.4cqw solid {colors.black}"
    rounded: "0"
    shadow: "0.8cqw 0.8cqw 0 {colors.black}"
    description: "Primary card. Border/shadow coupled: 4px↔8px, 3px↔4px."
  card-small:
    backgroundColor: "{colors.white}"
    border: "0.3cqw solid {colors.black}"
    rounded: "0"
    shadow: "0.4cqw 0.4cqw 0 {colors.black}"
    description: "Stat cards, team cards, timeline steps."
  label-pill:
    border: "0.3cqw solid {colors.black}"
    backgroundColor: "any pastel / {colors.white}"
    rounded: "9999px"
    shadow: "0.4cqw 0.4cqw 0 {colors.black}"
    typography: "{typography.label}"
    description: "The universal eyebrow — never plain text."
  button-primary:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.black}"
    border: "0.3cqw solid {colors.black}"
    rounded: "0"
    shadow: "0.4cqw 0.4cqw 0 {colors.black}"
    typography: "Inter 700"
    description: "The CTA."
  star-burst:
    backgroundColor: "any pastel"
    border: "0.3cqw solid {colors.black}"
    clip: "10-point clip-path star"
    description: "Corner attention-grabber."
  stripe-block:
    backgroundImage: "45° {colors.black} + pastel diagonal stripes"
    border: "0.3cqw solid {colors.black}"
    description: "Poster decoration."
  bg-dot-grid:
    backgroundImage: "radial-dot ~1.2px dots, 24px grid, {colors.black}"
    description: "Faint corner/ground overlay."
  tilt-deco:
    transform: "rotate(±2°–12°)"
    description: "Rotated rectangle/badge/star. Stat cards alternate −2/+2°. The grid-puncture signature."
  stat-deco-dot:
    backgroundColor: "any pastel"
    border: "2px solid {colors.black}"
    rounded: "50%"
    size: "12px"
    description: "The ONLY round shape, pinned to stat cards."
  close-frame:
    backgroundColor: "{colors.black}"
    textColor: "{colors.white}"
    border: "0.4cqw solid {colors.white}"
    rounded: "0"
    shadow: "1.2cqw 1.2cqw 0 {colors.yellow}"
    description: "Inverted closer — the only colored shadow."
---

# BlockFrame — Frame (video / frame layer)

## Overview

BlockFrame at frame scale is a **maximalist neobrutalist** system on five laws: every region has a
4px black border, every elevated element an 8px hard offset shadow, every corner square, every
accent a saturated pastel, and every layout allowed to be a little crooked. The joy is the
deliberate collision — bordered cards meeting bordered cards, shadows stacking, tilted decorations
puncturing the grid.

The voice is **Inter** at weight 800–900 in tight uppercase with negative tracking (display) +
weight 500 sentence body, and **Space Grotesk** weight 600 uppercase 0.08em as the label/chrome
voice. Five candy pastels (pink/blue/green/yellow/cream) cycle as full-bleed grounds across frames
— the color cycling is the primary rhythm. Depth is **hard offset shadow** (8px/4px, solid black,
zero blur, bottom-right); the close-frame's 12px yellow shadow is the one colored exception.

**Key characteristics at frame scale:**

- **4px black borders + 8px hard shadows** on primary cards; 3px + 4px on chrome (weights coupled).
- **Five-pastel palette** cycled as full-bleed grounds; black/white/off-white structural.
- **Inter 800–900 uppercase** negative-tracked display; **Space Grotesk** label chrome.
- **Square corners** everywhere (only the stat-deco dot is round); **tilted decorations** puncture the grid.
- **Label-pills** open every region; star bursts, stripe blocks, dot grids are reusable attention units.
- **Comfortably dense** — packed reads as authoritative; empty corners read as broken.

## The Frame

### Frame Craft Bar

Three eyeball tests gate every frame before any structural check:

- **Squint** — one Inter display moment dominates at 3–6× its neighbor; cards read as a system, not rivals.
- **Silence** — cover/quote/close keep air (decorations, not content); the **feature-card and stat grids are the dense exception**.
- **Restraint** — the 4px→08px / 3px→4px coupling holds; black borders only (white on close); pastel ground **cycles** one per frame; no sixth pastel.
- **Reference** — aim at a **zine / 1990s sticker-book / toy-packaging spread** (bordered blocks, tilted decorations); failure looks like a **flat, borderless, blurred-shadow web card grid**.

- **Primary:** 1920×1080 (16:9). Display authored in **`cqw`** (`px ÷ 1920 × 100 = cqw`).
- **Vertical:** 1080×1920 (9:16). **Square:** 1080×1080 (1:1).
- **Safe area:** `slide-pad` ~3.1cqw; decorations may bleed off edges.

**The container law (load-bearing).** Every frame ground sets `container-type: size`; ALL
frame-relative units are `cqw`/`cqh` against it — never `vw`. Borders/shadows scale in `cqw` so the
4px↔8px coupling holds proportionally; corners stay square.

## Colors

Tokens identical to the source. `{colors.offwhite}` is the default ground, but frames **cycle**
through `{colors.cream}`/`blue`/`pink`/`green`/`yellow` grounds — the cycle is the rhythm.
`{colors.black}` is every border + structural text; `{colors.white}` is card fills. The five pastels
are interchangeable with **no semantic meaning** — pair by juxtaposition (pink+blue+green trio,
cream+yellow warm pair). `{colors.yellow}` is the CTA + the one colored (close) shadow;
`{colors.black}` ground is the close surface. **No sixth pastel.**

## Typography

Two ramps. The **reading/chrome ramp** (Inter body 0.95cqw weight 500, Space Grotesk labels in px)
carries copy + chrome; the **display ramp** (Inter `heading-md` 2.1cqw → `heading-xl` 5cqw, weight
800–900 uppercase) carries every headline + stat.

- **Legibility floor:** any load-bearing line ≥ **1.4cqw**; px labels are chrome only.
- **Fit-to-measure:** size the headline to its length. Cap the block at **≤ 78cqw**; ≤3 words → `heading-xl`; 4–6 → `heading-lg`; 7+ → `heading-md`.
- **Inter display is uppercase, weight 800–900, negative-tracked** (−0.01..−0.03em); body weight 500 sentence case; **Space Grotesk labels uppercase 0.08em**. No sentence-case display, no untracked display.

## Depth & Surface

Hard offset shadow, solid black, zero blur, bottom-right:

- **0.8cqw (8px)** primary cards; **0.4cqw (4px)** chrome; **0.6cqw (6px)** hover.
- **Border-based depth** — the 4px/3px borders do much of the lift; shadow makes it "elevated."
- **Tilt** — ±2°–12° rotation breaks the grid for perceived dimension.
- **Inverted close** — 12px YELLOW shadow (and 6px white on close-btn) — the only colored shadows.

**Ceiling:** no blurred shadow, no rounded corner (save the stat-deco dot), no gradient depth.

## Shapes

- **0 radius everywhere** except the 12px stat-deco dot (50%). Square corners are the structural identity.

## Components

- **card-elevated / card-small** — the bordered+shadowed content cards (weight-coupled).
- **label-pill** — the universal eyebrow (border+shadow+pastel). **button-primary** — yellow CTA.
- **star-burst / stripe-block / bg-dot-grid / tilt-deco** — the reusable decoration units (one per frame min).
- **stat-deco-dot** — the lone round shape. **close-frame** — the inverted black+white+yellow-shadow closer.

## Frame Treatments

> Recipe: ground · container · composes · focal · chrome · accent · silence · Fixed/Free · density.
> Cycle the ground color; add ≥1 decoration per frame; open with a label-pill.

### 1 · Cover (identity · move: decorations puncture · left)

**Ground** `{colors.cream}` (or offwhite) + faint dot-grid. **Composes** label-pill, heading-xl, tilt-deco rect, star-burst, counter. **Focal** a 2–3 line Inter `heading-xl` uppercase, left, under a label-pill; tilted pastel rects + a star burst puncture the right. **Chrome** counter pill. **Accent** the decorations' pastels. **Silence** right third holds decorations. **Fixed** 4px/8px coupling, uppercase display, square. **Free** title, decoration placement/colors. **Density** comfortable.

### 2 · Feature Cards (catalog · move: 3-up bordered grid · blue ground)

**Ground** `{colors.blue}`, `slide-pad`. **Composes** label-pill, heading-lg, 3× card-elevated (icon-square + card-title + body). **Focal** three white bordered+shadowed cards. **Chrome** label-pill eyebrow. **Accent** the pastel icon-squares (pink/green/yellow). **Silence** tight — dense by design. **Fixed** 4px border + 8px shadow, square, uppercase card-titles. **Free** card content, icon hues. **Density** dense-exception.

### 3 · Stat Grid (data · move: tilted stat cards · green ground)

**Ground** `{colors.green}`, `slide-pad`. **Composes** label-pill, heading-lg, 3× card-small (tilted −2/+2°, stat-deco dot, stat-number + label). **Focal** three tilted bordered stat cards. **Accent** the deco-dots' pastels + black stat numerals. **Silence** moderate. **Fixed** alternating tilt, 3px+4px, round deco-dot only. **Free** figures (from script), dot hues. **Density** dense-exception.

### 4 · Closing Plate (closer · move: inverted black · centered)

**Ground** `{colors.black}`. **Composes** close-frame (4px white border, 12px yellow shadow), label-pill (inverted), close-title, star-burst. **Focal** a white `close-title` inside the white-bordered frame with the yellow offset shadow; a pink star punctures a corner. **Accent** the yellow shadow + pink star. **Silence** ~50%. **Fixed** white-on-black, 12px yellow shadow (only here), square. **Free** sign-off, star placement. **Density** low.

### 5 · Quote (quote · move: bordered quote frame · pink ground)

**Ground** `{colors.pink}` (or offwhite). **Composes** label-pill, quote-text in a card-elevated, attribution. **Focal** an Inter `quote-text` (900 uppercase) inside a white bordered+shadowed frame. **Accent** the ground + one decoration. **Silence** moderate. **Fixed** uppercase quote, 4px/8px. **Free** quote, ground. **Density** comfortable.

### 6 · Timeline (process · move: stepped bordered cards · offwhite)

**Ground** `{colors.offwhite}`. **Composes** label-pill, heading-lg, 3–4 card-small steps + step-connectors. **Focal** a row of bordered step cards linked by black connector bars, each a pastel + step-num. **Accent** the step pastels. **Silence** moderate. **Fixed** 3px+4px steps, square, connectors. **Free** steps, hues. **Density** standard.

## Composition Rules

### Do

- Pair **4px borders with 8px shadows**, **3px with 4px** — the coupling is non-negotiable.
- **Cycle pastel grounds** across frames; keep the deck visually rhythmic.
- Set Inter display **uppercase, 800–900, negative-tracked**; open every region with a **label-pill**.
- Render shadows **solid black, zero blur, bottom-right**; add **≥1 decoration** (tilt/star/stripe/dots) per frame.
- Use **yellow** for CTAs; use the **inverted black + 12px yellow shadow** close-frame for the closer.
- Tilt decorations ±2°–12°; lean left on most frames.

### Don't

- No rounded corners (save the stat-deco dot); no blurred shadows.
- No colored borders (black only, save the close-frame white); no sixth pastel.
- No sentence-case Inter display; no untracked display; no label as plain text.
- Don't keep everything perfectly aligned (tilt is the signature); don't leave corners empty.
- Don't blow a headline edge-to-edge — fit to measure.

## Aspect-Ratio Behavior

| Treatment     | 16:9                          | 9:16                         | 1:1                      |
| ------------- | ----------------------------- | ---------------------------- | ------------------------ |
| Cover         | title left, decorations right | title top, decorations below | title, fewer decorations |
| Feature Cards | 3 across                      | 3 stacked                    | 2+1                      |
| Stat Grid     | 3 tilted across               | 3 tilted stacked             | 2×2                      |
| Closing       | centered close-frame          | centered, taller             | centered                 |
| Quote         | quote frame                   | quote stacked                | centered                 |
| Timeline      | horizontal steps              | vertical (connectors hidden) | 2×2                      |

`slide-pad` holds on the short edge; re-step display above the 1.4cqw floor. Decoration count drops
on tighter ratios so the frame stays bordered, not cluttered.

## Approved Entities

No real customers, logos, or vendors are defined in the source — render any such mark as a
placeholder. Pastel fills, decorations, and tilts are content-agnostic.

## Numerals & Claims (hard rule)

Never invent figures, stats, or counts at frame scale. Render slots as `— figure —`, `{metric}`,
`N×`. Stat cards and charts carry placeholders until the script supplies values. Slide counters and
list numbers are decorative.

## Pre-Render Self-Audit

- **Squint** — one Inter display moment dominates; cards read as a system.
- **Silence** — only feature/stat grids run dense; cover/quote/close keep air with decorations.
- **Borders/shadows** — 4px↔8px / 3px↔4px coupling holds; solid black, zero blur.
- **Color** — pastel ground cycles; black borders only (white on close); no sixth pastel.
- **Type** — Inter uppercase 800–900 negative-tracked, fit-to-measure; Space Grotesk labels 0.08em; ≥1.4cqw floor.
- **Shape** — square corners (only stat-deco dot round); ≥1 tilt/decoration per frame.
- **Fabrication** — every numeral traces to the script, else placeholder.

## Known Gaps

- **Motion intentionally out of scope.** frame.md specifies composition only; the source toggles slides via display, no transition.
- **Inter + Space Grotesk via Google Fonts.** CJK: Noto Sans SC 900 (sentence case — the uppercase signal drops); lean harder on borders/shadows/decoration to carry the brutalist identity.
- **9:16 / 1:1 are guidance**; verify the floor and that decoration count scales down.
- Star bursts (clip-path), stripe blocks, dot grids, and tilts are CSS-only; no external imagery is required.
