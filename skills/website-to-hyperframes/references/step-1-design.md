# Step 1: Write DESIGN.md

DESIGN.md is a **comprehensive brand cheat sheet** for the captured website. It encodes the full visual identity — colors, typography, component styles, spacing, depth — so you can reference exact values while building storyboard and compositions. The more precise this document, the more authentic your video will look.

DESIGN.md is NOT the creative plan. The STORYBOARD drives creative direction. DESIGN.md is a reference you consult — it tells you what the brand looks like, not what the video should do.

**User preferences always override brand rules.** The Do's/Don'ts in DESIGN.md describe what the WEBSITE does — but the VIDEO might deliberately break those rules. If a user says "I want bright colors even though the site is dark-themed" or "use serif fonts even though the brand is sans-serif" — follow the user. DESIGN.md is a reference for authenticity, not a constraint. Going off-brand is fine when the user explicitly wants it.

You read `tokens.json` and `design-styles.json` in Step 0. If you still have that data clearly in context, use it and skip re-reading. If you don't remember the exact values — just re-read them. Don't guess.

**Font availability check — do this before writing typography rules.** Check `capture/assets/fonts/` and cross-reference with what the site actually uses:

- Hashed filenames (`f266e704a846645b-s.p.woff`) = Google Fonts subsets — these auto-resolve, you don't need @font-face
- Recognizable filenames (`Charlie_Display-Light.woff2`) = brand fonts — but CHECK THE WEIGHT. If the site uses 700/Bold and only Light/Thin was captured, that weight doesn't exist. Write in DESIGN.md: "Charlie Display — only Light (300) captured. Bold (700) unavailable, use DM Sans 700 as fallback." Don't write DESIGN.md claiming "Charlie Display 700" when the file doesn't exist — sub-agents will try to use it and silently fall back to system-ui anyway.
- Commercial fonts (GT Walsheim, Söhne, Graphik, Canela, etc.) are NEVER captured — they're hosted on brand CDNs, not bundled in the site. Flag these explicitly: "GT Walsheim not available in capture — use Inter 600 as substitute."

- **`capture/extracted/tokens.json`** — colors (top 20 HEX), font families, headings, sections, CSS variables
- **`capture/extracted/design-styles.json`** — computed styles extracted from live DOM: typography hierarchy with exact font-size/weight/line-height per role, button styles, card styles, nav styles, spacing scale, border-radius scale, box-shadow values

`design-styles.json` is your primary data source for Sections 3-6. It gives you exact computed values — don't estimate from screenshots what you can read from this file. Cross-reference with screenshots for visual context and anything the extractor missed.

## The 8 Sections

Write every section below. **Document everything meaningful; skip what the brand doesn't actually use.** A site with 6 real button variants and 7 real colors should have a DESIGN.md with exactly those — not 12 padded variants and 10 colors invented to hit a target. Each section should feel like you reverse-engineered the site's design system from scratch — because that's exactly what you're doing.

---

### `## 1. Visual Theme & Atmosphere`

Write one substantial paragraph (5-7 sentences) describing the overall visual personality. Cover:

- Dark-first vs. light-first aesthetic
- Contrast strategy (high-contrast, muted, vibrant)
- Dominant visual elements (gradients, illustrations, photography, UI mockups)
- Motion and animation philosophy (if visible from `animations.json`, lottie, webgl and etc.)
- Overall mood:
- What makes this design distinctive vs. generic

Then add a **Key Characteristics** bullet list (5-8 items) that captures the defining visual patterns. These should be specific enough that another designer could identify the site from the list alone.

**Example:**

```markdown
## 1. Visual Theme & Atmosphere

Framer's design system embodies a bold, forward-thinking aesthetic rooted in minimalist sophistication and dynamic energy. The visual language combines deep blacks and pure whites with electrifying accent colors that command attention, creating a stark contrast that feels contemporary and design-focused. The system prioritizes clarity and directness, leveraging generous whitespace and confident typography to communicate purpose. Motion, precision, and modular consistency underpin every decision, reflecting a platform built for designers who demand control and flexibility. The overall mood is aspirational yet approachable—professional without pretension, innovative without excess.

**Key Characteristics**

- High-contrast black and white foundation with electric blue accents
- Minimal ornamentation with emphasis on typography and spacing
- Bold, oversized display typefaces paired with lean sans-serif body text
- Rounded button forms (`40px` and `100px` radius) balancing geometric precision
- Neutral grays reserved for secondary content and disabled states
- Clean, friction-free interaction patterns prioritizing speed and clarity
```

---

### `## 2. Color Palette & Roles`

Organize colors into **semantic groups**, not a flat list. Extract from `tokens.json` and cross-reference with screenshots.

**Required groups:**

- **Primary** — the 1 or 2 dominant brand colors (background, foreground)
- **Accent Colors** — the colors used for emphasis, CTAs, highlights (typically 1 or 2 or 3)
- **Interactive** — hover states, link colors, focus indicators
- **Neutral Scale** — the full grayscale used for text, borders, disabled states (6-10 values)
- **Surface & Borders** — background surfaces, card backgrounds, divider colors, glass/transparent overlays
- **Semantic / Status** — error, warning, success colors (if present)

Target **10-15 colors minimum**. Every real design system has at least this many distinct values.

For each color, provide:

1. A **brand-specific name** — not generic ("Accent 1") but evocative ("Stripe Purple", "Vibrant Orange", "Huly Orange", "Deep Navy", "Slate Blue", "Navy Slate", "Pure Black", "Subtle Border Light", "Lavender Tint", and etc.)
2. The exact HEX value
3. Where and how it's used (be specific: "Primary brand color used for CTAs, interactive elements, active states, and brand identity. Most frequently used across the system for maximum recognition and action emphasis." or "Primary text color for headings and critical content. Conveys trust, professionalism, and financial gravitas. Used in hero sections and primary messaging." or ")

**Example:**

```markdown
### Accent Colors

- **Vibrant Orange** (`#FF6118`): Secondary accent for highlights, gradient endpoints, and supporting visual interest. Creates energy and draws attention to secondary actions and design flourishes.
- **Slate Blue** (`#273951`): Muted secondary color for subheadings, secondary text, and layered content. Bridges the gap between deep navy and neutral tones.

### Neutral Scale

- **Pure Black** (`#000000`): Primary text, borders, and structural elements. High-contrast element for maximum readability in standard body text and critical UI components.
- **Pure White** (`#FFFFFF`): Primary background, card surfaces, and content areas. Ensures legibility and creates visual hierarchy through clean separation.
- **Light Slate** (`#64748D`): Secondary text, metadata, and lower-emphasis content. Used for supporting information and contextual details.

and etc.
```

---

### `## 3. Typography Rules`

Three sub-sections:

#### Font Family

List every font family with its fallback stack. Identify which is used for display/headings vs. body vs. code.

**Example:**

```markdown
### Font Family

- **Primary Font**: `sohne-var`, system fallback stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif`
- **Secondary Font**: Monospace for code/technical content: `"SF Mono", Monaco, "Cascadia Code", Roboto Mono, Courier New, monospace`
```

#### Hierarchy Table

A markdown table with exact values. Fill in every row you can extract from the capture:

| Role      | Font | Size | Weight | Line Height | Letter Spacing | Notes                                                                |
| --------- | ---- | ---- | ------ | ----------- | -------------- | -------------------------------------------------------------------- |
| Display 1 | ...  | ...  | ...    | ...         | ...            | Hero headlines, major section titles. High impact, open letterforms. |
| Display 2 | ...  | ...  | ...    | ...         | ...            | Section headings, feature callouts. Prominent but subordinate to H1. |
| Heading   | ...  | ...  | ...    | ...         | ...            | ...                                                                  |
| Body      | ...  | ...  | ...    | ...         | ...            | ...                                                                  |
| Caption   | ...  | ...  | ...    | ...         | ...            | ...                                                                  |

If exact sizes aren't in `tokens.json`, estimate from screenshots or use anything else to get the sizes, might even fetch the website if you want. Approximate is better than missing.

#### Principles

3-5 bullet points about how the typography system works — what carries hierarchy (size vs. weight vs. color), how display faces differ from body, minimum sizes, letter-spacing patterns.

**Example**

```markdown
### Principles

- **Lightness as Hierarchy**: Display and heading typography uses weight 300 (light) to create visual distinction while maintaining sophistication; body content uses weight 400 for readability.
- **Generous Line Height**: All sizes employ line-height 1.15–1.3× of font size to ensure comfortable reading, especially on screens and in financial interfaces where clarity is paramount.
- **Semantic Sizing**: Each size increment represents a distinct narrative role; avoid intermediate sizes to maintain system coherence.
- **System Fallbacks**: The sans-serif stack prioritizes system fonts for performance; sohne-var loads as the primary for brand consistency.
- **Variable Font Optimization**: sohne-var supports optical sizing and weight variations; leverage intermediate weights (350–450) for emphasis without introducing new sizes.
```

---

### `## 4. Component Stylings`

This is the section that makes the difference between a useful reference and a vague mood board. For each notable component type, provide **exact CSS-level properties**. Not just "rounded cards" — exact border-radius, padding, shadow, hover state and etc. .

Target **12-16 components** total across all categories. Every real design system (Stripe, Airbnb, ElevenLabs, Linear) documents at least this many.

**Required component types** (include what's present on the site):

#### Buttons

For each button variant (primary, secondary/ghost, icon):

- Background, text color, padding, border-radius, border
- Font size, weight, height
- Box shadow (if any)
- Hover, active, and disabled states

**Example**

```markdown
### Buttons

#### Primary Button

- **Background**: `#533AFD`
- **Text Color**: `#FFFFFF`
- **Font Size**: `16px`
- **Font Weight**: `400`
- **Padding**: `15.5px 24px 16.5px 24px`
- **Border Radius**: `4px`
- **Border**: `none`
- **Height**: `fit-content` (typically `48px` with padding)
- **Line Height**: `16px`
- **Hover State**: Background `#4329E8`, slight opacity shift to `0.95`
- **Active State**: Background `#3720D4`, scale `0.98`
- **Disabled State**: Background `#C9C3F0`, color `#FFFFFF`, cursor `not-allowed`

#### Secondary Button

- **Background**: `#FFFFFF`
- **Text Color**: `#533AFD`
- **Font Size**: `16px`
- **Font Weight**: `400`
- **Padding**: `15.5px 24px 16.5px 24px`
- **Border Radius**: `4px`
- **Border**: `1px solid #533AFD`
- **Height**: `fit-content`
- **Line Height**: `16px`
- **Hover State**: Background `#F3F0FF`, border color `#4329E8`
- **Active State**: Background `#E8E9FF`, border color `#3720D4`

#### Ghost Button (Text Only)

- **Background**: `transparent`
- **Text Color**: `#533AFD`
- **Font Size**: `14px`
- **Font Weight**: `400`
- **Padding**: `12px 0px 12px 0px`
- **Border Radius**: `4px`
- **Border**: `none`
- **Height**: `40px`
- **Line Height**: `14px`
- **Hover State**: Background `rgba(83, 58, 253, 0.08)`, text color `#4329E8`
- **Active State**: Background `rgba(83, 58, 253, 0.12)`, text color `#3720D4`
- **Underline**: Optional on hover; text-decoration `underline` for semantic links
```

#### Cards & Containers

- Background, border, border-radius, padding, box-shadow
- Hover state changes

**Example**

````markdown
#### Standard Card

- **Background**: `#FFFFFF`
- **Text Color**: `#000000`
- **Font Size**: `16px`
- **Font Weight**: `400`
- **Padding**: `32px` (internal content padding)
- **Border Radius**: `5px`
- **Border**: `1px solid #D4DEE9`
- **Box Shadow**: `0px 1px 2px rgba(0, 0, 0, 0.04)`
- **Line Height**: `normal`
- **Hover State**: Border color `#B8CCDB`, shadow `0px 4px 12px rgba(0, 0, 0, 0.08)`

#### Feature Highlight Card

- **Background**: Linear gradient `180deg, rgba(83, 58, 253, 0.05) 0%, rgba(255, 97, 24, 0.03) 100%)`
- **Text Color**: `#000000`
- **Padding**: `36px`
- **Border Radius**: `5px`
- **Border**: `1px solid #E5EDF5`
- **Box Shadow**: `none`

#### Gradient Overlay Container (Hero)

- **Background**: Diagonal linear gradient `135deg, #533AFD 0%, #FF6118 100%)`
- **Opacity**: Layer as `rgba(..., 0.15)` over white background for subtle effect
- **Text Color**: `#FFFFFF` or `#061B31` depending on overlay contrast

#### Other Components

Name and describe any distinctive components visible in screenshots:

- Logo marquees, testimonial carousels, pricing tables
- Gradient overlays, glassmorphism panels, bento grids
- Code blocks, terminal UIs, dashboard mockups

**Example**

```markdown
## Badges

#### Status Badge (Success)

- **Background**: `#D1FAE5`
- **Text Color**: `#065F46`
- **Font Size**: `12px`
- **Font Weight**: `500`
- **Padding**: `4px 8px`
- **Border Radius**: `3px`
- **Border**: `1px solid #A7F3D0`

#### Status Badge (Alert)

- **Background**: `#FEE2E2`
- **Text Color**: `#991B1B`
- **Font Size**: `12px`
- **Font Weight**: `500`
- **Padding**: `4px 8px`
- **Border Radius**: `3px`
- **Border**: `1px solid #FECACA`

#### Status Badge (Info)

- **Background**: `#E8E9FF`
- **Text Color**: `#533AFD`
- **Font Size**: `12px`
- **Font Weight**: `500`
- **Padding**: `4px 8px`
- **Border Radius**: `3px`
- **Border**: `1px solid #C9C3F0`
```
````

For each, use the same property-level detail as buttons and cards. Name them descriptively — "Glass Card with grain overlay" not "Card."

---

### `## 5. Layout Principles`

Three sub-sections:

#### Spacing System

Identify the **base unit** (typically `4px` or `8px`) and list the full spacing scale with usage context:

**Example**

```markdown
**Base Unit**: `4px`

**Scale Progression**:

- `4px`: Micro-spacing (between inline elements, tight component padding)
- `8px`: Compact spacing (button group gaps, small component padding)
- `12px`: Small spacing (form field padding, small card padding)
- `16px`: Medium spacing (standard component padding, section gaps)
- `20px`: Standard padding (card padding, navigation padding)
- `32px`: Large spacing (section vertical spacing, container padding)
- `40px`: Extra-large padding (hero section padding, feature block padding)
- `60px`: Rhythm spacing (major section separation)
- `64px`: Section padding (full-width container internal padding)
- `80px`: Large section padding (hero sections, dramatic breaks)
- `100px`: Page-level gap (between major layout blocks)
- `160px`: Maximum margin (edge spacing on very wide layouts)

**Usage Context**:

- Inline elements and tight groupings: `4px`–`8px`
- Form fields and buttons: `12px`–`16px`
- Card and container interiors: `16px`–`20px`
- Section separation: `32px`–`80px` depending on visual weight
- Page edges and maximum padding: `40px`–`160px` depending on breakpoint
```

#### Grid & Container

- Max width, column strategy (desktop/tablet/mobile if visible)
- Section patterns (full-width vs. contained, alternating layouts)

**Example**

```markdown
**Max Width**: `1440px` (inferred from navigation component)

**Column Strategy**:

- Desktop: 12-column grid with `20px` gutters
- Tablet: 8-column grid with `16px` gutters
- Mobile: 4-column grid with `12px` gutters

**Section Patterns**:

- Full-width sections use `0px` horizontal margin, internal padding of `40px`–`80px`
- Contained sections use max-width `1440px`, center-aligned with auto margins
- Feature blocks align to grid; maintain consistent left/right padding
```

#### Border Radius Scale

List every border-radius value you observe with what uses it:

**Example**

```markdown
- `0px`: Hard edges for precise, technical elements (form labels, small icons)
- `4px`: Minimal rounding for compact, controlled elements (small badges, subtle containers)
- `6px`: Standard rounding for inputs, small cards, and utility components
- `8px`: Common rounding for cards, dropdowns, and medium components
- `12px`: Soft rounding for larger containers, feature cards, and callouts
- `15px`: Medium-rounded button style for secondary CTAs
- `40px`: Highly rounded for icon buttons and compact rounded buttons
- `100px`: Fully rounded (pill shape) for primary buttons and rounded badges
```

#### Whitespace Philosophy

**Example**

```markdown
Framer's design system embraces generous whitespace as a sign of confidence and clarity. Every element breathes. Vertical rhythm is deliberate—major sections are separated by `60px`–`100px`, creating scannable hierarchy. Horizontal breathing is equally important; content never touches viewport edges. The principle: more whitespace = higher perceived value and improved scanability. Negative space is active design, not emptiness.
```

---

### `## 6. Depth & Elevation`

A table of shadow levels with exact CSS values and where each is used:

**Example**
| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (0) | No shadow; `box-shadow: none` | Inputs, text, most UI elements; default treatment |
| Raised (1) | `box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.1)` | Cards on white background, modals, floating elements |
| Elevated (2) | `box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.15)` | Dropdown menus, popovers, hovered cards |
| Floating (3) | `box-shadow: 0px 8px 24px rgba(0, 0, 0, 0.2)` | Modals, overlays, important floating panels |
| Maximum (4) | `box-shadow: 0px 16px 40px rgba(0, 0, 0, 0.25)` | Full-screen modals, critical overlays, top-level layers |

Then a short **Shadow Philosophy** paragraph: does the site use shadows sparingly or dramatically? Are they soft or hard? How do they behave on dark vs. light backgrounds?

**Example**

```markdown
**Shadow Philosophy**: Framer minimizes depth, preferring flatness and clean lines. Shadows are used sparingly, primarily to signal interactive surfaces (hover states, modals, overlays) or to create layering distinction. On dark backgrounds, shadows are removed or inverted to `rgba(255, 255, 255, 0.1)`. Shadows are always soft-edged (high blur radius) to avoid harshness; hard or sharp shadows are avoided entirely. The goal is subtle depth cues, not dramatic visual separation.
```

---

### `## 7. Do's and Don'ts`

5-8 rules each, derived from what the site **actually does**. These should be specific and actionable, not generic design advice.

**Do's** — patterns to follow:

- Reference exact values (colors, spacing, radius)
- Reference specific component behaviors

**Don'ts** — patterns to avoid:

- Things the site explicitly avoids (e.g., "no gradients", "no decorative borders", "no serif fonts")
- Common mistakes that would break the visual language

**Example:**

```markdown
### Do

- **Use the primary blue (`#0000EE`) for all primary CTAs and interactive elements** to maintain brand recognition and semantic clarity
- **Maintain consistent heading hierarchy**: Display faces for heroes, GT Walsheim Medium for sections, Inter for subsections
- **Apply generous whitespace around hero and feature content**: minimum `40px` padding on mobile, `80px` on desktop
- **Use bold black text (`#000000`) on white backgrounds and bright white (`#FFFFFF`) on dark backgrounds** for maximum contrast and legibility
- \*\*Employ rounded buttons (`40px` radius for icon buttons, `15px` for secondary CTAs`) to soften hard edges and signal approachability
- **Leverage Glass / overlay containers with `rgba(255, 255, 255, 0.9)` and backdrop blur for layered, sophisticated depth**
- **Reserve semantic colors for their intended purposes**: red (`#FF0022`) for errors, yellow (`#FFBB00`) for warnings, green (`#4CD963`) for success
- **Build responsive layouts with mobile-first spacing; use `12px`–`16px` on mobile, scale up to `40px`–`80px` on desktop**
- **Ensure all interactive elements have clear hover and focus states** (color shift, underline, or background change)
- **Use Inter Variable font for responsive typography** that scales gracefully across viewport sizes

### Don't

- **Don't mix primary colors within a single component**; choose one focal color (blue) and support it with neutrals
- **Don't use small shadows or high-contrast shadows**; keep shadows soft (`blur: 8px` minimum) and use only where depth is necessary
- **Don't apply inconsistent border radius across similar component types**; icon buttons are always `40px`, inputs are always `6px`
- **Don't exceed line lengths of `75–80` characters** for body text; restrict content width to maintain readability
- **Don't add decorative borders to most components**; prefer subtle backgrounds or shadows over visible strokes
- **Don't crowd interactive elements**; maintain at least `12px` of padding between buttons, inputs, and other touchable areas
- **Don't use gray text (`#999999`) for primary content**; reserve for disabled states, captions, and secondary metadata
- **Don't apply color to body text except for links (`#0000EE`)**; let typography size and weight carry hierarchy
- **Don't create custom gradients**; use solid colors from the palette; gradients weaken brand coherence
- **Don't ignore focus states on keyboard navigation**; all interactive elements must have visible focus indicators (border or outline)
```

**Example 2**

```markdown
## Do

- **Use Stripe Purple (`#533AFD`) for all primary CTAs** — this is the system's action signal and is immediately recognizable to Stripe users
- **Maintain 1.15–1.3× line-height for all body text** — ensures readability at any size and accessibility compliance
- **Apply gradient overlays to hero/showcase sections** — use diagonal 135° from purple to orange with 10–15% opacity over white for depth
- **Group related content into cards with consistent `5px` border-radius and `#D4DEE9` borders** — establishes visual coherence
- **Employ generous whitespace (`24px`–`60px`) between major sections** — supports the premium, confident aesthetic
- **Use Deep Navy (`#061B31`) for primary headings and crucial text** — high contrast ensures legibility and gravitas
- **Stack form fields vertically with `8px` gaps and consistent `40px` heights** — ensures usability and visual rhythm
- **Reserve the Vibrant Orange (`#FF6118`) for accents and gradient endpoints only** — overuse diminishes impact
- **Implement focus states with `2px` purple border + subtle shadow** — meets accessibility standards and provides clear interaction feedback
- **Test all color combinations for 4.5:1 contrast ratio minimum** — ensures WCAG AA compliance for financial content

### Don't

- **Don't use purple for passive elements** — it's reserved for interactive and primary-importance content only
- **Don't apply shadows to hero sections or gradient overlays** — use color layering instead; shadows create visual noise
- **Don't mix serif and sans-serif typefaces in the same interface** — sohne-var is the only font family; maintain consistency
- **Don't create custom spacing values outside the scale** — always use multiples of `4px` to maintain rhythm
- **Don't set line-height below `1.15×` font size** — risks accessibility and readability issues in financial contexts
- **Don't forget to disable buttons** — always include disabled state with `#C9C3F0` background and `cursor: not-allowed`
- **Don't overuse borders** — use subtle `#D4DEE9` or `#E5EDF5` only; reserve bold borders for interactive focus states
- **Don't nest more than two levels of dropdown menus** — keeps navigation simple and mobile-friendly
- **Don't apply color to text smaller than `14px` without sufficient contrast** — metadata at `12px` must maintain `#000000` or `#061B31`
- **Don't forget gradient direction** — always use `135deg` (top-left to bottom-right) for consistency with Stripe's brand motion
```

---

### `## 8. Agent Prompt Guide`

This is the section agents consult most during Step 5 (Build). It has two parts:

#### Quick Color Reference

A flat lookup of the most-used values — no categories, just the answers:

**Example**

```markdown
### Quick Color Reference

- **Primary CTA**: Primary Interactive (`#0000EE`)
- **Secondary Interactive**: Primary Light (`#0099FF`)
- **Accent Highlight**: Vibrant Purple (`#6600FF`)
- **Background**: Pure White (`#FFFFFF`)
- **Text / Content**: Solid Black (`#000000`)
- **Secondary Text**: Light Gray (`#666666`)
- **Disabled Text**: Ash Gray (`#999999`)
- **Error State**: Error / Danger (`#FF0022`)
- **Warning State**: Warning (`#FFBB00`)
- **Success State**: Success (`#4CD963`)
- **Dark Background**: Deep Gray (`#1A1A1A`)
- **Subtle Border**: Stone Gray (`#222222`)
```

#### Iteration Guide

Numbered rules that summarize the most important design decisions for _this brand specifically_. Each rule should be a single actionable sentence stating what to do, with the specific values from this site. These are the "if in doubt, do this" rules — the TL;DR of the entire DESIGN.md.

**How many rules:** Whatever this brand needs. A simple brand with a tight identity might be 5–6 rules; a complex design system might be 10–14. There's no count target. If you find yourself padding to hit a number, stop.

**The single most common failure mode is writing generic rules that could apply to any well-designed website.** A rule that doesn't name a specific value, a specific color, or a specific component this brand actually uses is doing nothing. Below are paired counter-examples showing the difference.

##### Generic vs site-specific

The left column is what an agent writes when it's pattern-matching to "what an iteration guide is supposed to look like." The right column is what an iteration guide is actually for.

**Color:**

| ❌ Generic — wrong                                                                               | ✅ Site-specific — right                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use the primary brand color for all primary CTAs and the secondary color for supporting actions. | All primary CTAs use Stripe Purple (`#533AFD`). Secondary actions use white background with `#533AFD` border + text. There is no third button color anywhere in the system. |
| Maintain visual hierarchy through color contrast.                                                | Body text is `#000000` on white, `#FFFFFF` on dark. Metadata uses `#64748D` on white only — never on dark. The brand has no mid-gray text on dark backgrounds.              |

**Typography:**

| ❌ Generic — wrong                                                              | ✅ Site-specific — right                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use a clear typographic hierarchy with appropriate sizes for headings and body. | All type is sohne-var. H1 `48px`/300, H2 `32px`/300, H3 `26px`/300, body `14px`/400. Never use weights above 400 — this brand has no bold variant in production. |
| Headings should be larger than body text.                                       | Headlines are minimum `2.3×` body size. The brand never uses a heading smaller than `26px` even in dense table rows.                                             |

**Spacing:**

| ❌ Generic — wrong                            | ✅ Site-specific — right                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use consistent spacing throughout the design. | Spacing is from a fixed scale: `4, 8, 12, 16, 20, 24, 32, 40, 60` px. Section gaps are always `60–100px`. Card internal padding is always `32px`. There are no exceptions. |

**Components:**

| ❌ Generic — wrong                                        | ✅ Site-specific — right                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons should have rounded corners and adequate padding. | Buttons are `40px` tall minimum with `15.5px 24px` padding. Primary radius is `4px`; pill-shape `9999px` radius is reserved for the floating chat trigger only. |
| Cards have a subtle shadow for depth.                     | Cards have `1px solid #D4DEE9` border, `5px` radius, no shadow by default. On hover, shadow `0 4px 12px rgba(0,0,0,0.08)` and border shifts to `#B8CCDB`.       |

The test for any rule you write: **can you swap this brand for a different brand and have the rule still make sense?** If yes, it's too generic. The rule should name values, components, or constraints that don't apply to any other site.

##### One worked example (Framer)

For reference, here's what a tight iteration guide looks like for a real brand. Five rules — enough to encode the most load-bearing decisions, not so many that the document becomes a checklist.

```markdown
### Iteration Guide

1. **All interactive elements use Framer Blue (`#0000EE`)** as the primary signal — links, primary buttons, active states, focus indicators. Secondary interactions use `#0099FF` for hover-state shifts. There is no other interactive color in the system.

2. **Typography is GT Walsheim Medium for headings, Inter for body**, with hierarchy enforced through size only — never color. H2 is `62px`, H5 is `85px`, body is `14px`, labels are `12px`/500. All text defaults to `#000000` on white, `#FFFFFF` on dark.

3. **Spacing is base-4**: every margin, padding, and gap is a multiple of `4px`. Section gaps are `60–100px`. Never use odd values like `13px` or `17px` — the system has no place for them.

4. **Cards are white (`#FFFFFF`), `1px` border `#EFEFEF`, `8px` radius, `16–20px` padding, no shadow by default.** Dark-mode cards swap to `#1A1A1A` background with `#242424` border. Shadow only appears on hover.

5. **Glass containers use `rgba(255,255,255,0.9)` background, `1px` border `rgba(255,255,255,0.2)`, optional `backdrop-filter: blur(8px)`.** These are the only place transparent fills appear — everywhere else uses solid color.
```

Notice what's missing: there's no rule about "always use proper focus states for accessibility" or "responsive breakpoints should be mobile-first." Those things are true but they're true for every well-built site. The iteration guide is for the rules that distinguish _this_ site.

If your draft includes a rule like "all interactive elements require visible focus states" — delete it. It's not wrong, it's just not load-bearing for this brand.

---

## Rules

- Use **exact values** from `capture/extracted/tokens.json`. Cross-reference with screenshots. Do not approximate when exact values are available.
- Name colors and components descriptively — "Huly Orange" not "Accent 1", "Glass Card with grain overlay" not "Card variant B."
- When you can't extract exact values (e.g., hover states, animation durations), estimate from visual inspection and note it's estimated or try anything possible and available to you in order to find and extract.
- Write prose sections (Theme, Shadow Philosophy, Principles) as genuine analysis, not template-filling. Each site's DESIGN.md should read differently because each site IS different.
- Target 200-400 lines. This is a comprehensive reference, not a quick cheat sheet. For context: designmd.me's outputs for real sites (Stripe, Airbnb, Huly, Framer) run 350-440 lines.
- No "Assets" section beyond 8 — `capture/extracted/asset-descriptions.md` is the full asset index.
- No "Motion" section — the storyboard specifies motion per-beat.

## Quick User Check (before moving to Step 2)

After writing DESIGN.md, do a 30-second sanity check with the user before proceeding. Brand extraction can go wrong — the "primary color" might be a UI chrome accent, the dominant font might be from a third-party widget, the dark theme might not reflect how the brand wants to present itself.

Show the user:

> "Here's what I extracted as [Brand Name]'s visual identity:
>
> - **Colors:** [primary], [accent], [2-3 others with roles]
> - **Fonts:** [headline font], [body font]
> - **Tone:** [1 sentence on the brand feel you extracted]
>
> Does this match how you want the video to feel? Any corrections or overrides before I start the storyboard?"

If the user has corrections ("use the blue, not the gray" / "ignore the dark mode, I want light" / "we just rebranded, use [these values] instead") — update DESIGN.md now, not later. One minute here saves thirty minutes of rebuilding.

## What makes a great DESIGN.md

A great DESIGN.md lets you recreate any element from the website without looking at the screenshots. If someone reads only this document, they should be able to:

1. Pick the right colors for any surface, text, or accent
2. Set typography that looks like the original site
3. Build a card, button, or nav bar that passes for the real thing
4. Apply the right spacing, shadows, and border-radius
5. Understand what to avoid so the design stays cohesive

The test: could a designer build a new page for this brand using only your DESIGN.md? If yes, it's detailed enough.
