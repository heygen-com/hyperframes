---
name: video-typography
description: "Font hierarchy, scale, and selection for Remotion videos — site fonts first, curated fallbacks second [font, typography, text, hierarchy, scale]"
category: visual-design
---

# Typography for Video

Video typography differs from web typography. There is no scrolling, no responsive reflow, and the viewer cannot control the pace. Every text element must be legible at a glance within its visible window (typically 1-5 seconds).

## Font Selection Strategy

### Priority 1: Use the website's own fonts

The extracted `tokens.json` and `assets/fonts/` contain the brand's typefaces. These are the primary choice because:

- They maintain brand consistency between the website and its promo video
- The client or brand owner chose them deliberately
- Using them signals professionalism and attention to detail

**Implementation**:

1. Check `tokens.json` → `fonts` for the font family names
2. Check `extraction/assets/fonts/` for actual font files (.woff2, .ttf, .otf)
3. Load them via `staticFile()` in Remotion and register with `@font-face`
4. If the site uses a Google Font, load it directly from Google Fonts instead of the extracted file

### Priority 2: Curated fallbacks (only when needed)

Use fallback fonts only when:

- The site has no custom fonts (uses system defaults)
- The extracted fonts are low-quality or unsuitable for video (e.g. monospace-only, bitmap fonts)
- The site font is a generic choice that adds no brand value (Arial, Times New Roman)

**Recommended alternatives by feel**:

| Feel                | Display font                               | Body font                       |
| ------------------- | ------------------------------------------ | ------------------------------- |
| Modern / clean      | Instrument Sans, Plus Jakarta Sans, Outfit | DM Sans, Figtree                |
| Premium / editorial | Fraunces, Newsreader                       | Source Serif 4, Lora            |
| Technical / sharp   | Onest, Urbanist                            | Nunito Sans, Source Sans 3      |
| Bold / energetic    | Bricolage Grotesque, Space Grotesk         | Inter (acceptable here as body) |

**Fonts to avoid as display choices** (overused in AI output):
Inter, Roboto, Open Sans, Lato, Montserrat — these are invisible defaults that make the video feel generic. They are acceptable as body/caption text only when paired with a distinctive display font.

### Priority 3: One font family is often enough

A single well-chosen font in multiple weights creates cleaner hierarchy than two competing typefaces. Only add a second font when you need genuine contrast (e.g. serif display headlines + sans-serif body).

**Never pair fonts that are similar but not identical** (e.g. two geometric sans-serifs). They create visual tension without clear hierarchy.

## Type Scale for 1920x1080 Video

Video is viewed at a distance or in a small player. Use larger sizes and higher contrast than web.

### Modular scale with contrast

Use fewer size steps with more contrast between them. A 5-tier system works well:

| Role           | Size range | Weight  | Use case                                |
| -------------- | ---------- | ------- | --------------------------------------- |
| Hero / display | 100-120px  | 300-700 | Scene titles, key messages, brand names |
| Display        | 72-96px    | 500-700 | Key stats, bold statements              |
| Heading        | 48-64px    | 500-700 | Section labels, feature names           |
| Body           | 32-40px    | 400     | Descriptions, narrator subtitles        |
| Caption        | 20-28px    | 400-500 | Metadata, secondary info, timestamps    |
| Data           | 48-96px    | 600-800 | Animated numbers, statistics            |

**Popular ratios**: 1.25 (subtle), 1.333 (fourth), 1.5 (fifth — recommended). Avoid sizes that are too close together (48, 52, 56 — muddy hierarchy). More contrast between levels = clearer hierarchy.

## Hierarchy through multiple dimensions

Size alone is not enough. Combine at least 2-3 of these:

| Dimension | Strong contrast                  | Weak contrast        |
| --------- | -------------------------------- | -------------------- |
| Size      | 3:1 ratio or more                | Less than 2:1        |
| Weight    | Bold (700) vs Light (300)        | Medium vs Regular    |
| Color     | High contrast to background      | Similar tone         |
| Spacing   | Wide letter-spacing for display  | Default for body     |
| Case      | Uppercase display, sentence body | Everything same case |

Example: A hero title that is larger, lighter weight (300), uppercase, AND has wide letter-spacing reads as clearly distinct from a bold, sentence-case, tight-spaced heading.

## Animated Numbers

When animating numeric values (counters, percentages, statistics):

```tsx
fontVariantNumeric: "tabular-nums";
```

This prevents width jumping as digits change. Without it, neighboring elements will jitter.

## OpenType features for video

Enable kerning explicitly — some renderers skip it by default:

```tsx
fontKerning: "normal";
```

Always set both together on animated number elements:

```tsx
fontVariantNumeric: "tabular-nums",
fontKerning: "normal",
```

## Letter-spacing guide

| Context                | Letter-spacing               |
| ---------------------- | ---------------------------- |
| Uppercase display text | 4-20px (wider = more luxury) |
| Sentence-case headings | 0-2px                        |
| Body text              | 0 (default)                  |
| Small caps / labels    | 2-6px                        |

**Never apply wide letter-spacing to body text or long sentences.** It destroys readability.

## Text on backgrounds

- Dark background: use warm off-white (#F5E6C8, #FAFAF5) instead of pure white (#FFFFFF)
- Light background: use near-black with brand tint instead of pure black (#000000)
- On images: always add text shadow (`0 2px 20px rgba(0,0,0,0.6)`) or a gradient overlay for contrast
- Light text on dark requires more line-height (+0.05 to 0.1) than dark on light — the darker background reduces perceived spacing, so compensate explicitly

## CJK & Emoji Support

Headless Chromium has no CJK or emoji fonts unless explicitly installed. The Docker image provides `Noto Sans CJK SC` and `Noto Color Emoji` as system fonts.

### Rules

1. **Every `font-family` must include a CJK fallback** — even if you don't expect Chinese text, the narrator script or user edits may introduce it:

   ```ts
   fontFamily: "'BrandFont', 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
   ```

2. **For Chinese-primary content**, use a CJK font as the display font — don't rely on fallback rendering:
   - `Noto Sans CJK SC` (system font in Docker, clean and modern)
   - Site's own CJK font from `extraction/assets/fonts/` if available

3. **Emoji** renders automatically via the system `Noto Color Emoji` font — no CSS changes needed. Avoid using emoji as critical UI elements (they render differently across platforms).

4. **CJK typography sizing**: Chinese characters are visually denser than Latin. When mixing CJK and Latin text, CJK often reads well 2-4px smaller than the Latin size guide above. For CJK-only display text, 80-100px is a good hero range (vs 100-120px for Latin).

## Font pairing principles

Contrast across multiple axes creates clear hierarchy. Good axes to contrast:

- **Style**: serif display + sans-serif body (the classic)
- **Personality**: geometric + humanist
- **Weight range**: a family with extreme weights (100–900) often covers the role of two families

**Never pair fonts that are similar but not identical** — two geometric sans-serifs, or two humanist serifs. They create visual noise without hierarchy benefit. When in doubt, one family in multiple weights is cleaner than two competing typefaces.
