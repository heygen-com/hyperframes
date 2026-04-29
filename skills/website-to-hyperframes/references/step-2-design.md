# Step 2: Write DESIGN.md

DESIGN.md combines machine-readable design tokens (YAML front matter) with human-readable design rationale (markdown prose). Tokens give downstream agents exact values. Prose tells them _why_ those values exist and how to apply them.

DESIGN.md is NOT the creative plan. The STORYBOARD (Step 4) drives creative direction. DESIGN.md is a reference you consult, not a document you follow slavishly.

## Format

Two layers:

1. **YAML front matter** — Machine-readable tokens delimited by `---` fences at the top of the file. These are the normative values.
2. **Markdown body** — Human-readable rationale organized into `##` sections. Prose explains why and how.

### Token Schema

```yaml
---
name: <string>
colors:
  <token-name>: <Color> # "#" + hex sRGB, e.g. "#1A1C1E"
typography:
  <token-name>:
    fontFamily: <string>
    fontSize: <Dimension> # number + unit (px, em, rem)
    fontWeight: <number>
    letterSpacing: <Dimension>
    lineHeight: <number>
    fontStyle: <string>
    textTransform: <string>
rounded:
  <scale>: <Dimension> # none, sm, md, lg, xl, full
spacing:
  <scale>: <Dimension>
components:
  <component-name>:
    backgroundColor: <Color | "{path.to.token}">
    textColor: <Color | "{path.to.token}">
    typography: "{typography.token}"
    rounded: "{rounded.scale}"
    padding: <Dimension>
motion: # HyperFrames extension
  energy: <calm | moderate | high>
  easing:
    entry: <string> # GSAP ease, e.g. "expo.out"
    exit: <string>
    ambient: <string>
  duration:
    entrance: <number> # seconds
    hold: <number>
    transition: <number>
  atmosphere: # decorative layers (2-5 per scene)
    - <string> # grain-overlay, radial-glow, light-leak, etc.
  transition: <shader-name> # domain-warp, glitch, cross-warp-morph, etc.
---
```

Token references use `{path.to.token}` syntax: `{colors.primary}`, `{typography.headline}`, `{rounded.md}`.

The `motion:` block is a HyperFrames extension to the [google-labs-code/design.md](https://github.com/google-labs-code/design.md) spec. The base spec covers static UI tokens; `motion:` adds video-specific tokens (energy, easing, duration, atmosphere, transition). A Google `design.md` linter will preserve unknown top-level keys without error.

### Section Order

| #   | Section         | Purpose                                                              |
| :-- | :-------------- | :------------------------------------------------------------------- |
| 1   | Overview        | Visual identity — mood, layout patterns, feel                        |
| 2   | Colors          | Palette with roles and rationale                                     |
| 3   | Typography      | Font families, scale, distinctive usage                              |
| 4   | Layout          | Spacing, grid, density                                               |
| 5   | Elevation       | Depth — borders, shadows, glass, layers                              |
| 6   | Shapes          | Border radius, corner treatments (omit if `rounded:` tokens suffice) |
| 7   | Components      | Named UI patterns with visual treatments                             |
| 8   | Do's and Don'ts | Rules from what the site does/doesn't do                             |

Unknown sections are preserved — the format is extensible.

## Rules

- Use **exact HEX values** from `capture/extracted/tokens.json`. Do not approximate.
- Every color in YAML `colors:` MUST appear in `## Colors` prose with its role.
- Every typography entry MUST appear in `## Typography` prose with its usage.
- Name components by what you see in the screenshot, not generic terms.
- Keep under 120 lines. Cheat sheet, not full design system.
- No "Style Prompt" section — the storyboard handles creative direction.
- No "Assets" section — `capture/extracted/asset-descriptions.md` covers this.
- Motion tokens go in YAML front matter, not a prose section.

## Example

Real DESIGN.md from a production capture (Soulscape 2026):

```markdown
---
name: Soulscape 2026
colors:
  primary: "#020204"
  on-primary: "#FFFFFF"
  accent-warm: "#FB923C"
  accent-cool: "#60A5FA"
  surface-glass: "#FFFFFF0A"
typography:
  headline:
    fontFamily: Cormorant Garamond
    fontSize: 3.5rem
    fontWeight: 400
    fontStyle: italic
  label:
    fontFamily: Geist Mono
    fontSize: 0.75rem
    fontWeight: 500
    letterSpacing: 0.15em
    textTransform: uppercase
  body:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
rounded:
  sm: 4px
  md: 12px
  lg: 2.5rem
spacing:
  sm: 8px
  md: 16px
  lg: 32px
components:
  glass-card:
    backgroundColor: "{colors.surface-glass}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    padding: 24px
motion:
  energy: high
  easing:
    entry: "expo.out"
    exit: "power2.in"
    ambient: "sine.inOut"
  duration:
    entrance: 0.6
    hold: 2.0
    transition: 1.0
  atmosphere:
    - grain-overlay
    - radial-glow
    - light-leak
  transition: domain-warp
---

## Overview

Cinematic, "high-signal" digital experience. Dark, technical, premium — high-contrast "Flare on Void" (white on black). Dense horizontal layering with border-defined sections evoking widescreen cinema. Atmospheric grain overlays and slow-moving marquees create constant breathing texture.

## Colors

- **Primary** (`{colors.primary}`) — Deep void black for entire background
- **On-Primary** (`{colors.on-primary}`) — High-purity white for text and borders
- **Accent Warm** (`{colors.accent-warm}`) — Orange for CTAs, industry/executive tiers
- **Accent Cool** (`{colors.accent-cool}`) — Blue for creative voices, summit components
- **Surface Glass** (`{colors.surface-glass}`) — Subtle overlay for card backgrounds

## Typography

- **Headline** (`{typography.headline}`) — Cormorant Garamond Italic. Major headings, brand identity. Classical cinematic contrast.
- **Label** (`{typography.label}`) — Geist Mono. Subheaders, terminal readouts. High tracking, all-caps.
- **Body** (`{typography.body}`) — Inter. Body copy, interface elements. Small sizes.

## Elevation

Glassmorphism: `backdrop-filter: blur(10px)` with `1px solid rgba(255,255,255,0.08)` borders. Depth via fixed global grain-overlay and localized light-leak gradients, not box-shadows. Hover triggers subtle `translateY(-5px)` and increased border opacity.

## Components

- **Cinematic Accordion** — Expanding horizontal card system; panels reveal full-bleed imagery and large serif type
- **HUD Explorer** — Floating mobile nav as "Lens" with pulsing glow and terminal readouts
- **Slow Marquees** — Continuous horizontal tickers for partner logos
- **Glass Cards** — `{components.glass-card}` with high-contrast iconography
- **Grain & Flicker** — Global CSS noise filters and holographic flicker on UI labels

## Do's and Don'ts

### Do's

- Use thin subtle borders (`rgba(255,255,255,0.1)`) to separate sections
- Maintain high letter-spacing on all Geist Mono labels
- Use serif italics for emotional or visionary statements
- Keep imagery desaturated with dark gradients for readability

### Don'ts

- Do not use bright solid background colors — remain in "The Void"
- Do not use standard drop shadows — use radial glow or bloom effects
- Do not use sharp high-speed animations — all motion fluid and breathing
```

Contrasting example from a light, corporate brand:

```markdown
---
name: Stripe
colors:
  primary: "#635bff"
  text-solid: "#0a2540"
  text-soft: "#424770"
  surface: "#ffffff"
  surface-subdued: "#f6f9fc"
  accent-orange: "#ff6118"
  border: "#e6ebf1"
typography:
  headline:
    fontFamily: sohne-var
    fontSize: 3rem
    fontWeight: 600
  body:
    fontFamily: sohne-var
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  code:
    fontFamily: SourceCodePro-Medium
    fontSize: 0.875rem
    fontWeight: 500
rounded:
  sm: 4px
  md: 8px
  lg: 24px
  full: 9999px
spacing:
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
components:
  button-cta:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: 12px 24px
  bento-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-solid}"
    rounded: "{rounded.md}"
    padding: 24px
motion:
  energy: moderate
  easing:
    entry: "cubic-bezier(.25,1,.5,1)"
    exit: "power2.in"
    ambient: "sine.inOut"
  duration:
    entrance: 0.5
    hold: 2.5
    transition: 0.8
  atmosphere:
    - gradient-sweep
    - cursor-glow
  transition: cinematic-zoom
---

## Overview

High-precision, technically sophisticated with a fluid, forward-moving motion language. Dense but expertly balanced — "canary" grid system favoring high-density data visualizations and modular bento layouts. Authoritative and innovative, with smooth CSS animations and complex SVG dashboard graphics.

## Colors

- **Primary** (`{colors.primary}`) — Signature "Blurple" for brand identity and CTAs
- **Text Solid** (`{colors.text-solid}`) — Deep navy for primary headings
- **Text Soft** (`{colors.text-soft}`) — Subdued slate for descriptions and secondary text
- **Surface** (`{colors.surface}`) — White primary surface
- **Surface Subdued** (`{colors.surface-subdued}`) — Light gray for section contrast
- **Accent Orange** (`{colors.accent-orange}`) — Product highlights (Connect)
- **Border** (`{colors.border}`) — Soft borders for cards and dividers

## Typography

- **Headline** (`{typography.headline}`) — Sohne. Custom neo-grotesque balancing precision with approachability.
- **Body** (`{typography.body}`) — Sohne at standard weight. Generous line-height.
- **Code** (`{typography.code}`) — SourceCodePro-Medium for snippets and tabular data.

## Elevation

Multi-layered shadows (`0 30px 60px -12px rgba(50,50,93,0.25)`). Diffused and deep for floating effect. Heavy `1px solid` borders define bento grid boundaries in flat sections. Nav overlays use `backdrop-filter: blur(5px)` with translucent white.

## Components

- **Navigation Popover** — Animated dropdown spanning page margin with multi-column bento layout
- **Bento Cards** — Grid-aligned containers with gradient hover effects following cursor
- **Customer Marquee** — Seamless horizontal scrolling loop of flat-colored SVG logos
- **CTA Buttons** — `{components.button-cta}` with subtle scale transforms on hover

## Do's and Don'ts

### Do's

- Use smooth cubic-bezier(.25, 1, .5, 1) transitions for all hover and entrance animations
- Maintain strict vertical alignment between iconography and text labels

### Don'ts

- No sharp-cornered cards — always apply border-radius
- No over-saturated backgrounds — white or `{colors.surface-subdued}`, let brand assets provide color
```
