---
name: video-composition
description: "1920x1080 canvas layout, whitespace rhythm, visual hierarchy, depth layering [layout, composition, whitespace, hierarchy, canvas]"
category: visual-design
---

# Composition for 1920x1080 Video

Video composition is closer to film and poster design than web layout. There is no scroll, no responsive reflow. Every frame is a fixed canvas where every pixel matters.

## The squint test

Blur your eyes (or blur a screenshot). Can you still identify:

- The most important element?
- The second most important?
- Clear spatial groupings?

If everything looks the same weight when blurred, you have a hierarchy problem. Redesign before coding.

## Canvas zones

Divide the 1920x1080 canvas into functional zones:

```
+--------------------------------------------------+
|                    Safe margin (5%)               |
|  +----------------------------------------------+|
|  |                                              ||
|  |            Primary content area              ||
|  |           (center 70% of frame)              ||
|  |                                              ||
|  +----------------------------------------------+|
|  |        Caption / subtitle zone (bottom 15%)  ||
|  +----------------------------------------------+|
+--------------------------------------------------+
```

- **Safe margin**: Keep critical content away from edges (minimum 96px / 5% on each side). Content near edges gets cropped on some players.
- **Primary content area**: The center 70% of the frame is where the eye naturally rests. Place the hero visual here.
- **Caption zone**: Bottom 15% is reserved for narrator subtitles. Do not place critical visuals here during narrated segments.

## Composition templates

### Centered (hero moments)

Single dominant element centered with generous breathing room. Use for: brand reveals, key statistics, CTAs.

### Rule of thirds

Place the visual anchor at a third-line intersection. The remaining space holds supporting elements or stays empty for breathing room. Use for: feature showcases, product demos with description.

### Split (comparison / dual focus)

Left and right halves each contain a distinct element. Use for: before/after, feature comparison, problem/solution.

### Layered depth (immersive)

Foreground, midground, background at different scales and opacity. Use for: opening hooks, atmosphere-heavy scenes.

### Asymmetric (editorial)

Main content pushed to one side (60/40 or 70/30 split). Deliberate imbalance creates visual tension and sophistication. Use for: feature spotlight, text-heavy information.

**Do not default to centered for every scene.** Mix templates to create visual rhythm across the video.

## Frame density — avoid empty-looking scenes

A common failure is scenes that feel hollow: a small element floating in the center of a 1920x1080 canvas with nothing else. Every scene should feel **intentionally filled**, not sparse.

**Density rules:**

- The primary visual element should occupy at least **40% of the canvas area** (e.g., a product image filling ~800x600px or larger)
- Every scene should have at least **3 visual layers**: background (gradient, particles, ambient texture), midground (main content — images, cards, text blocks), foreground (accent elements, overlays, subtle decorations)
- **Opening and closing scenes** are especially prone to emptiness — a lone logo on black or a single line of text feels like a placeholder, not a finished scene. Add environmental layers: radial gradient background, floating particles, brand color accents, subtle imagery
- If a scene has only text and no imagery, add visual elements: brand logo, extracted product images, icon decorations, or geometric shapes derived from the brand palette
- Use **extracted assets aggressively** — they are the most valuable visual material. A product screenshot at 60% frame size with supporting text and ambient layers looks rich; the same text alone looks empty

**The fullness test:** Would this frame work as a poster or social media image? If it looks like a PowerPoint slide with too much empty space, add more visual layers.

## Whitespace as a design tool

Whitespace is not wasted space. It directs attention and creates hierarchy.

### Rhythm through varied spacing

- **Tight groupings** for related elements (icon + label, image + caption)
- **Generous separation** between unrelated groups
- **Asymmetric margins** feel more designed than equal padding everywhere

### Breathing room

- A hero image needs empty space around it to feel important
- A data counter needs distance from other elements to read as a standalone statement
- Crowded frames with no breathing room feel chaotic and unpolished

### Common spacing failures

- Every element equidistant from every other element (no grouping, no hierarchy)
- Elements touching or overlapping unintentionally
- Text crammed against the edge of a container
- Subtitle text colliding with bottom-positioned visuals

## Visual hierarchy in a frame

Order of visual weight (strongest to weakest):

1. **Large imagery** (mockups, photos, hero visuals)
2. **Motion** (animated elements draw the eye before static ones)
3. **High contrast** (bright on dark, saturated on neutral)
4. **Typography scale** (display text > heading > body)
5. **Position** (center and upper third are prime real estate)

**Combine at least two** to establish clear hierarchy. A large, moving element in the upper third is unmistakably the primary focus.

### Hierarchy through multiple dimensions

Do not rely on size alone. Effective hierarchy stacks 2-3 signals:

| Dimension | Strong contrast             | Weak contrast               |
| --------- | --------------------------- | --------------------------- |
| Size      | 3:1 ratio or more           | Less than 2:1               |
| Weight    | Bold (700) vs Light (300)   | Medium vs Regular           |
| Color     | High contrast to background | Similar tone                |
| Position  | Top / left = primary        | Center mass = neutral       |
| Space     | Surrounded by whitespace    | Equidistant from everything |

A heading that is merely larger but the same weight, color, and spacing as body text has weak hierarchy. Stack dimensions.

## Cards and grouping

Spacing and alignment create natural grouping — a card container is not always needed.

**Use cards when**:

- Content is truly distinct from surrounding content
- The group is independently actionable in a UI demo scene

**Do not use cards when**:

- You just want visual separation — use whitespace instead
- Content is part of a continuous list or flow

**Never nest cards inside cards.** Nested containment creates visual claustrophobia and ambiguous hierarchy. If you feel the need to nest, the outer card is likely unnecessary.

## Asset prominence

Extracted assets (logos, product images, screenshots) are the most valuable visual material. They are real and specific to the brand.

- **Feature them prominently**, not as small decorations
- A product screenshot should fill at least 40-60% of the frame when it is the scene's focus
- Logos should be recognizable at playback size — do not shrink them to icons
- Use the highest-quality asset version available

**Never replace real assets with AI-invented decorative graphics** (generic shapes, abstract blobs) when real assets exist. The extraction step gathered them for a reason.

## Depth in a 2D canvas

Even without 3D transforms, create perceived depth through:

| Technique           | Effect                                             |
| ------------------- | -------------------------------------------------- |
| Scale difference    | Larger = closer, smaller = farther                 |
| Blur (filter: blur) | Blurred = background, sharp = foreground           |
| Opacity gradient    | Lower opacity = recedes, full opacity = primary    |
| Overlap             | Front elements partially cover back elements       |
| Shadow              | Elements with shadow feel lifted above the surface |
| Motion speed        | Faster parallax = closer, slower = farther         |

Layer at least 2-3 depth levels per scene to avoid the flat-poster look.

### Depth via opacity and transform

Different opacity values assign elements to different depth planes instantly:

```tsx
// Background plane
opacity: 0.15, transform: "scale(1.1)"       // receding

// Midground plane
opacity: 0.6, transform: "scale(1.0)"        // supporting

// Foreground plane
opacity: 1.0, transform: "scale(0.95)"       // primary focus
```

Use `scale` (values slightly above or below 1.0) to reinforce the depth assignment. Elements at 1.05 scale feel like they are leaning toward the viewer; elements at 0.92 feel set back. Combined with opacity, this creates convincing foreground/background separation without 3D transforms.

## What not to show in a promo video

- Navigation bars, footers, cookie banners (interactive web elements with no video purpose)
- Scrollbars, cursor arrows, browser chrome
- Buttons that cannot be clicked

**Exception**: UI demo scenes intentionally recreating the product interface. Here, a navbar and CTA button provide realistic context.
