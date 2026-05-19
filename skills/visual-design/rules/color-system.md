---
name: video-color-system
description: "Brand color extraction, palette roles, 60-30-10 allocation, cross-scene consistency [color, palette, brand, tokens, contrast]"
category: visual-design
---

# Color System for Video

## Extract the brand palette from tokens.json

`tokens.json` contains the design tokens extracted from the target website. The `colors` section is your primary source.

**Steps**:

1. Read `tokens.json` → identify primary, secondary, and accent colors
2. Note background colors (usually the most-used neutral)
3. Note text colors (usually the darkest value)
4. If the site uses a gradient, capture both endpoints

## Assign palette roles

Every video needs these roles filled:

| Role                   | Source                         | Usage share  | Examples                                   |
| ---------------------- | ------------------------------ | ------------ | ------------------------------------------ |
| **Primary**            | Brand's main color from tokens | 10% (accent) | CTAs, key highlights, emphasis moments     |
| **Neutral background** | Tinted toward brand hue        | 60%          | Scene backgrounds, large surfaces          |
| **Neutral foreground** | Brand-tinted dark              | 30%          | Text, borders, secondary elements          |
| **Semantic**           | Derived or from brand palette  | Sparingly    | Success (green), warning (amber), data viz |

### The 60-30-10 rule in video

This rule is about **visual weight**, not pixel count:

- **60% Neutral backgrounds** — the dominant surface. Must not compete with content
- **30% Secondary elements** — text, cards, containers, borders
- **10% Accent** — brand primary color, used only for emphasis

**The number one mistake**: using the brand color everywhere because it is "the brand." Accent colors work because they are rare. Overuse kills their impact.

## Tinted neutrals

Pure gray has no personality. Always tint neutral colors toward the brand hue:

- If the brand is warm (red/orange/yellow): add a subtle warm cast to grays
- If the brand is cool (blue/purple/green): add a subtle cool cast

The tint should be barely perceptible but creates subconscious cohesion. In code:

```tsx
// Instead of pure gray backgrounds
background: "#1a1a1a"; // dead, no personality

// Tint toward brand blue
background: "#1a1c22"; // cool-tinted, cohesive

// Tint toward brand orange
background: "#221a18"; // warm-tinted, inviting
```

**OKLCH approach**: Add a chroma of ~0.01 to all neutral stops in OKLCH space. This is the minimum perceptible hue that still reads as "gray" but feels alive. Warm brand → positive hue angle (~30-60°), cool brand → ~230-270°.

## Palette structure

A complete video palette has four layers — skip any that are not needed, but do not add extra:

1. **Primary**: 1 color, 3-5 lightness shades. Used at 10% visual weight.
2. **Neutral**: Tinted gray scale (5-7 stops). Used at 60% (backgrounds) + 30% (text/borders).
3. **Semantic**: Success (green), error (red), warning (amber). Derive from brand hue if possible.
4. **Surface**: 2-3 elevation levels (base, raised, overlay). Different lightness, same hue family.

Skip secondary and tertiary accent colors unless the brief explicitly requires them. Extra colors dilute the brand primary and create visual noise.

## Never use pure black or pure white

Pure black (#000000) and pure white (#FFFFFF) do not exist in nature. They create harsh contrast that feels synthetic.

- Instead of #000000 → use #0a0a0f (dark with slight cool tint)
- Instead of #FFFFFF → use #fafaf5 (off-white with warmth) or #f5f5fa (off-white with coolness)

Exception: pure white text shadow glow for emphasis is acceptable.

## Cross-scene color consistency

Every scene in the video must feel like it belongs to the same visual system.

**Rules**:

- Define the background palette at the project level (in `Root.tsx` design constants), not per scene
- Scenes can vary in lightness (dark scene → light scene for contrast) but must share the same hue family
- Accent color usage must be consistent: if primary blue is the CTA color in scene 1, it cannot become a background in scene 5
- Data visualization colors should be derived from the brand palette, not arbitrary

**Scene-level variation is fine within limits**:

- Alternating dark/light backgrounds for rhythm
- Shifting from desaturated (calm scenes) to saturated (emphasis scenes)
- Using gradient between two brand-adjacent colors

**Forbidden**:

- Each scene inventing its own color scheme
- Using colors not present in or derived from the brand palette
- Neon accent on dark background as a default (AI slop signature)

## Contrast for readability

Video is often viewed small (phone, embedded player). Text contrast must be aggressive:

| Content                  | Minimum contrast      | Target                        |
| ------------------------ | --------------------- | ----------------------------- |
| Display text on solid bg | 4.5:1                 | 7:1                           |
| Body/caption text        | 4.5:1                 | 7:1                           |
| Text on image            | Use overlay or shadow | Guaranteed readable           |
| Text on gradient         | Check both ends       | Readable across full gradient |

**Gray text on colored backgrounds always looks washed out.** Use a darker shade of the background color or a transparent overlay instead.

## Background treatment

Solid flat backgrounds are safe but boring. Layer depth into backgrounds:

1. **Base color** — the tinted neutral
2. **Subtle gradient** — radial or linear using brand-adjacent colors (very low contrast)
3. **Ambient texture** — noise overlay at 2-5% opacity, or soft gradient mesh
4. **Particle layer** — brand-colored floating particles (handled by environment layer)

This creates visual richness without competing with foreground content.

## Dangerous color combinations

Combinations that look fine in a design tool but fail at video playback size:

- **Light gray on white**: contrast collapses, especially on lower-quality screens
- **Gray on a colored background**: the gray reads as washed-out or dirty; use a darker shade of the background hue instead
- **Thin light text on images**: even with a shadow, sub-500 weight text under 40px on a busy image is unreliable — add a gradient scrim or increase weight

## Dark scene rules

Dark scenes require adjustments beyond just inverting colors:

- **Never pure black**: use a dark tinted neutral (e.g. `#0a0b10` for cool brand, `#100b0a` for warm brand)
- **Reduce text font weight**: bold text on dark tends to bloom and look heavier than intended — drop one weight step (700 → 600, 600 → 500)
- **Desaturate accents**: a brand color at full saturation on dark background can feel garish — reduce saturation by 10-20% or reduce opacity to 90%
- **Increase line-height**: as noted in typography rules, light text on dark needs +0.05 to 0.1 line-height to maintain perceived spacing
