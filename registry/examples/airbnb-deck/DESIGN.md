# Airbnb Seed Deck — Design Notes

## Intent

A premium remake of Airbnb's 2009 seed pitch deck using current Airbnb brand language.
The composition should feel warm, human, and tasteful — the opposite of a tech startup
dark-mode deck. White canvas, generous space, soft coral accents. Three.js backgrounds
are elegant mood-setters, never distracting.

## Color Palette

| Token            | Value     | Use                                  |
| ---------------- | --------- | ------------------------------------ |
| Rausch (primary) | `#FF385C` | CTAs, logo, accent bars, highlights  |
| Coral warm       | `#FF5A5F` | Gradient partner to Rausch           |
| Babu dark        | `#E61E4D` | Hover / emphasis gradient endpoint   |
| Off-white        | `#FFFFFF` | Slide background on light slides     |
| Hof dark         | `#222222` | Primary text; dramatic dark slide bg |
| Foggy gray       | `#717171` | Body copy, captions, secondary text  |
| Arches light     | `#F7F7F7` | Card backgrounds, subtle panel fills |
| Arches pink      | `#FFF1F1` | Soft pink tint for card areas        |

Do not introduce blue, purple, or green accents. The palette is warm coral + neutral.

## Typography

**Font**: "Nunito Sans" from Google Fonts — geometric, rounded, friendly.
Fallback stack: `"Nunito Sans", "Montserrat", system-ui, sans-serif`.

| Role     | Size (1920×1080) | Weight            |
| -------- | ---------------- | ----------------- |
| Headline | 80–96px          | 800               |
| Subhead  | 48px             | 400               |
| Body     | 40–44px          | 400–600           |
| Eyebrow  | 28–32px          | 700, letterspaced |
| Numbers  | 96–120px         | 900               |

Minimum readable size: 40px. Never go below that for audience-facing text.

## The Bélo Logo

The Bélo is Airbnb's universal belonging mark — a rounded loop that is simultaneously
a heart, a location pin, and a letter A. Reproduce it as inline SVG in Rausch `#FF385C`.

Use on: cover slide (large, centered), corner mark on every slide (48×48px, top-left).
Do NOT stretch or recolor the Bélo. Pair with lowercase "airbnb" wordmark in `#222222`.

## Layout Language

- **Generous whitespace**: 120px top/bottom padding, 160px left/right on 1920px canvas.
- **Rounded corners**: 16–24px on all cards and stat blocks.
- **Soft shadows**: `box-shadow: 0 4px 24px rgba(0,0,0,0.08)` for cards.
- White or very light slide backgrounds for most slides (readable and clean).
- Dark background (`#222222`) for: Cover (optional dramatic variant), Team, Ask.
- Keep layouts left-aligned or centered — never right-heavy.

## Three.js Background Moods (per-slide)

Backgrounds run on a persistent WebGL canvas behind all slide content.
All animations use a fixed seed (no `Math.random()`); seeded using a deterministic LCG.
Particle counts, positions, and velocities are computed from seeded values.

| Slide         | Mood                                                                |
| ------------- | ------------------------------------------------------------------- |
| cover         | Soft floating coral particles, slow upward drift, warm pink fog     |
| problem       | Desaturated gray particles, slower/heavier motion, cooler hue       |
| solution      | Coral bloom: particles converge inward, warm pulse                  |
| market        | Low-poly globe outline with soft arc routes in coral, gentle rotate |
| product       | Clean minimal — very subtle grid of pale dots, nearly static        |
| business      | Same as product — minimal                                           |
| adoption      | Sparse warm nodes with thin connecting lines (network graph feel)   |
| competition   | Cool gray minimal — positioning matrix backdrop                     |
| team          | Soft bokeh: large blurred coral orbs, slow parallax                 |
| ask           | Coral gradient swell — warm radial from center, slow pulse          |
| market-sizing | Same globe as market, camera zoomed in, arcs highlighted            |

## Do's

- Large, single-stat slides for numbers ($2.1B, $500K) — let the number breathe.
- Bottom-up math shown explicitly: trips × take-rate = revenue.
- Complete-sentence headlines that make a claim, not a label.
- SVG Bélo mark consistent across slides.

## Don'ts

- No dark purple, electric blue, neon green.
- No hero imagery or stock photos (pure typography + Three.js + SVG).
- No glassmorphism, frosted panels, or gamer-aesthetic effects.
- No unseeded random values — all Three.js positions must be deterministic.
- No font below 40px for any audience-visible text.
