# Step 1: Write DESIGN.md (the brand-truth cheat sheet)

DESIGN.md is a **brand-truth cheat sheet** — colors and fonts you'll **weave into your composed builds**. It is NOT a layout spec, not a moodboard, not a 400-line design system audit.

DESIGN.md is the brand inflection sub-agents layer on top of every composed beat: which color is "primary," which font is "headlines," what tone the brand carries — the load-bearing knobs they flip while building. The beats themselves are composed from divs/SVG/CSS at build time; DESIGN.md tells them in which colors and which fonts.

**Target length: 250–350 lines.** Sub-agents in Step 5 compose UIs from scratch (divs/SVG/CSS) using your DESIGN.md as the spec — the more precise the component CSS values you encode here, the more brand-faithful the composed beats will look. Going under 200 lines tends to produce generic-looking dark-cinematic videos because sub-agents have no brand component DNA to compose with.

**Fast-pacing exception:** For billboard-per-beat videos (short social ads where each beat is a single hero element on full-bleed background), a 50-line DESIGN.md with just colors + fonts + 3-5 do's/don'ts is enough. The Step 5 sub-agent prompt pastes brand values inline, so DESIGN.md depth only matters when the beats render full UIs.

**User preferences always override brand rules.** If the user says "make it bright even though the site is dark" or "use serif fonts even though the brand is sans" — follow the user. DESIGN.md describes the captured website. The video might deliberately break that.

You read `tokens.json` and `design-styles.json` in Step 0. If you remember the values, use them; if not, re-read. Don't guess.

**Font availability check — do this before writing anything else.** Read `capture/extracted/fonts-manifest.json`. The capture pipeline reads the OpenType `name` table embedded in every downloaded font file, so even hash-renamed Next.js/Webpack fonts are identified by their real family name (Inter, JetBrains Mono, Geist Mono, etc.). No guessing required.

The manifest gives you two views:

- `families[]` — one entry per distinct family with the weights captured, whether it's a variable font, and the files belonging to it
- `files[]` — one entry per downloaded font with family, subfamily, weight, style, and any variation axes

**How to use it:**

- For each family you'll reference in DESIGN.md, name it by what's in `families[].family` (e.g. "Inter", not "f266e704 hashed font"). The hashed filenames are the `@font-face src` paths — they stay as-is on disk; only the display name comes from the manifest.
- If a family has `variable: true` and `variationAxes` includes `"wght"`, you can use any weight 100-900 via `font-variation-settings: 'wght' <value>` even if only one static weight appears in the captured files. Note this in DESIGN.md so sub-agents know they have the full weight range available.
- If the manifest's `unidentified[]` is non-empty, those files failed name-table extraction (rare — heavily subset fonts that strip metadata). Flag them as `unknown` in DESIGN.md and suggest a fallback rather than guessing.
- Commercial fonts hosted on brand CDNs (GT Walsheim, Söhne, Graphik, Canela) won't be in the manifest because they aren't downloaded. Detect this by checking what the site uses (from `design-styles.json`) against what's in the manifest — anything used but missing is a CDN-hosted font. Flag explicitly: "Söhne not in capture; use Inter 600 as substitute."

Sub-agents try to use the fonts you list. The manifest tells you exactly what's available — there's no excuse for claiming "Charlie Display 700" when no such file exists.

---

## The 6 sections to write

### `## 1. Visual Theme (one paragraph)`

3–5 sentences describing the brand's visual personality. Cover: dark-first or light-first, contrast strategy, dominant visual elements (gradients, illustrations, photography, UI mockups), overall mood, what makes it distinctive vs. generic.

This is the only prose section. Make it specific to _this_ brand — not template-filling. A sentence that could describe any well-designed website is not useful.

**Example:**

> Stripe's visual language is light-first and clean, with deep navy (`#061B31`) and pure white as the foundation. The accent stack — Stripe Purple (`#533AFD`) for CTAs, Vibrant Orange (`#FF6118`) for energetic emphasis — keeps interactive elements unmistakable. Type is sohne-var Light (300) for display, weight 400 for body; the brand achieves hierarchy through size and weight, never color shifts. The mood is confident financial-tech — premium without theatrical drama. Distinctive: gradient overlays at 135° between purple and orange appear as subtle washes over white backgrounds, never as bold focal elements.

---

### `## 2. Quick Reference`

A flat lookup of the values sub-agents grab while composing beats. Two sub-sections — keep them tight.

#### Colors

List 8–12 colors with brand-specific names + HEX + role. Not generic ("Accent 1") but evocative ("Stripe Purple", "Deep Navy", "Slate Border"). The name carries meaning; "blue 4" doesn't.

**Example:**

```markdown
#### Colors

- **Stripe Purple** (`#533AFD`): Primary CTA, interactive elements, focus rings — the brand's action signal
- **Deep Navy** (`#061B31`): Primary text, headings — gravitas color
- **Pure White** (`#FFFFFF`): Page background, card surfaces
- **Light Gray** (`#F5F7FA`): Surface tier 2 (cards on white pages, alternating sections)
- **Slate Blue** (`#273951`): Secondary text, subheadings, lower-emphasis content
- **Light Slate** (`#64748D`): Metadata, captions, disabled-adjacent text
- **Subtle Border** (`#D4DEE9`): Card borders, dividers
- **Vibrant Orange** (`#FF6118`): Energy accent — gradient endpoints, highlight bursts (never primary)
- **Error Red** (`#FF0022`): Validation errors
- **Success Green** (`#4CD963`): Confirmation states
```

#### Fonts

List font families (with availability notes) + the headline / body / mono trio if applicable:

**Example:**

```markdown
#### Fonts

- **Display + Body:** `sohne-var` (variable 100–900, captured ✓) — weights 300 / 400 used in production
- **Mono:** `"JetBrains Mono"` — code, metadata, technical content
- **Fallback stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

The brand uses **size for hierarchy, weight for emphasis**. Display 1: 48px/300, Display 2: 32px/300, Body: 14px/400. Never use weights above 400 — this brand has no bold variant in production.
```

That's the whole typography section. If sub-agents need exact line-heights or letter-spacing, they read `design-styles.json` directly.

---

### `## 3. Component Stylings` (the build-step's spec sheet)

This is the section sub-agents consult most when composing UIs from divs in Step 5. **Without exact per-component CSS, sub-agents fall back to generic "dark bg + glow + centered text" patterns regardless of brand** — which is why every video starts looking the same. Encode the brand's actual component DNA here.

Target **6-12 distinct components**. Document what the site actually uses; skip categories the brand doesn't have. For each component, name it descriptively ("Stripe Primary Button" not "Button 1") and provide exact CSS-level properties: background, text color, padding, border-radius, border, font size/weight, height, box-shadow, and any hover/active/disabled states.

#### Buttons (always required)

Cover every variant the site uses — typically Primary, Secondary/Ghost, and Icon. **Example:**

```markdown
#### Primary Button (Stripe Purple)

- **Background:** `#533AFD`
- **Text color:** `#FFFFFF`
- **Font:** sohne-var 16px / 400
- **Padding:** `15.5px 24px 16.5px 24px`
- **Border radius:** `4px`
- **Border:** none
- **Height:** `48px` (with padding)
- **Box shadow:** none
- **Hover:** background `#4329E8`, opacity `0.95`
- **Active:** background `#3720D4`, scale `0.98`
- **Disabled:** background `#C9C3F0`, cursor `not-allowed`

#### Secondary Button (outline)

- **Background:** `#FFFFFF`
- **Text color:** `#533AFD`
- **Border:** `1px solid #533AFD`
- **Padding / radius / font:** same as Primary
- **Hover:** background `#F3F0FF`, border `#4329E8`

#### Ghost Button (text-only link)

- **Background:** transparent
- **Text color:** `#533AFD`
- **Font:** sohne-var 14px / 400
- **Padding:** `12px 0`
- **Hover:** background `rgba(83, 58, 253, 0.08)`, optional underline
```

#### Cards & Containers (always required if the site uses any)

Document each distinct card type — Standard, Feature Highlight, Glass, Pricing, Testimonial — whatever this brand actually uses. **Example:**

```markdown
#### Standard Card

- **Background:** `#FFFFFF`
- **Border:** `1px solid #D4DEE9`
- **Border radius:** `5px`
- **Padding:** `32px`
- **Box shadow:** `0 1px 2px rgba(0, 0, 0, 0.04)` (default), `0 4px 12px rgba(0, 0, 0, 0.08)` (hover)
- **Hover:** border `#B8CCDB`

#### Feature Highlight Card (gradient backdrop)

- **Background:** linear-gradient(180deg, rgba(83, 58, 253, 0.05) 0%, rgba(255, 97, 24, 0.03) 100%)
- **Border:** `1px solid #E5EDF5`
- **Padding:** `36px`
- **Box shadow:** none
```

#### Distinctive components (anything else the brand actually shows)

Logo marquees, testimonial carousels, pricing tables, gradient overlays, glassmorphism panels, bento grids, code blocks, terminal UIs, dashboard mockups — name and document anything visually distinctive. Sub-agents will reach for these specs when the storyboard calls for "compose the X UI."

```markdown
#### Glass Container (frosted overlay)

- **Background:** `rgba(255, 255, 255, 0.9)`
- **Border:** `1px solid rgba(255, 255, 255, 0.2)`
- **Backdrop filter:** `blur(8px)`
- **Use:** floating chat widgets, modal overlays, hero callouts only — the only place transparent fills appear in the system
```

**The rule:** if a sub-agent in Step 5 has to invent CSS values for a component this brand actually uses, you under-documented this section. The values should be lookup-able, not guessable.

---

### `## 4. Spacing & Layout`

The brand's rhythm. Three sub-sections, kept tight.

#### Spacing scale

Identify the **base unit** (typically `4px` or `8px`) and the full scale with usage context. **Example:**

```markdown
**Base unit:** `4px`

| Token | Value   | Used for                                                  |
| ----- | ------- | --------------------------------------------------------- |
| xs    | `4px`   | Inline icon gaps, tight badge padding                     |
| sm    | `8px`   | Button-group gaps, small component padding                |
| md    | `16px`  | Card padding, form-field gaps, standard component spacing |
| lg    | `32px`  | Section vertical spacing, large card padding              |
| xl    | `60px`  | Major section separation                                  |
| 2xl   | `100px` | Page-level rhythm, hero section padding                   |

Never use odd values (`13px`, `17px`) — the system only uses multiples of 4.
```

#### Border-radius scale

Every radius the site uses, with what uses it.

```markdown
- `0px`: Form labels, technical UI markers
- `4px`: Primary buttons, inputs, small badges
- `8px`: Standard cards, dropdowns
- `12px`: Feature cards, larger callouts
- `40px`: Icon buttons (square pill)
- `9999px`: Pill-shaped CTAs, status chips
```

#### Whitespace philosophy (one paragraph)

How does this brand use whitespace — generous and architectural? Tight and information-dense? Section gaps in the 60–100px range, or 20–40px? Document the brand's actual rhythm.

```markdown
Generous whitespace as confidence. Section gaps are always `60–100px`. Content never touches viewport edges — minimum `40px` horizontal padding on mobile, `80–160px` on desktop. The brand uses negative space as active design, not emptiness.
```

---

### `## 5. Depth & Elevation`

Document the brand's shadow philosophy and the actual shadow values used.

#### Shadow table

```markdown
| Level        | Value                            | Used for                                        |
| ------------ | -------------------------------- | ----------------------------------------------- |
| Flat (0)     | none                             | Default — most surfaces, inputs, body text      |
| Raised (1)   | `0 2px 8px rgba(0, 0, 0, 0.1)`   | Cards on white, hovered surfaces, floating CTAs |
| Elevated (2) | `0 4px 12px rgba(0, 0, 0, 0.15)` | Dropdown menus, popovers                        |
| Floating (3) | `0 8px 24px rgba(0, 0, 0, 0.2)`  | Modals, important overlays                      |
```

#### Shadow philosophy (one paragraph)

How does this brand use shadows? Sparingly with soft falloff, or dramatically with hard edges? Are they present by default or only on hover? On dark backgrounds, do shadows invert to glow effects?

```markdown
Shadows are minimal — used only to signal interactivity (hover) or layering (modals). All shadows are soft-edged (blur ≥ 8px). On dark backgrounds, shadows convert to subtle glow (`0 0 24px rgba(255, 99, 99, 0.15)` using the brand's accent color). Hard shadows do not exist in this system.
```

---

### `## 6. Iteration Guide` (the load-bearing section)

5–10 numbered rules that encode the most important brand decisions. Each rule is a **single actionable sentence stating what to do, with the specific values from this site.** These are the "if in doubt, do this" rules sub-agents consult while composing beats.

**The single most common failure mode is writing generic rules that could apply to any well-designed website.** A rule that doesn't name a specific value, a specific color, or a specific component this brand actually uses is doing nothing.

**Test for any rule you write:** can you swap this brand for a different brand and have the rule still make sense? If yes, it's too generic. If no, ship it.

#### ❌ Generic vs ✅ site-specific

| Generic (delete)                                  | Site-specific (keep)                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use the primary brand color for CTAs.             | All primary CTAs use Stripe Purple (`#533AFD`). Secondary actions use white background with `#533AFD` border + text. **There is no third button color anywhere in the system.** |
| Maintain visual hierarchy through color contrast. | Body text is `#000000` on white, `#FFFFFF` on dark. Metadata uses `#64748D` on white only — never on dark. The brand has no mid-gray text on dark backgrounds.                  |
| Use clear typographic hierarchy.                  | All type is sohne-var. H1 `48px`/300, H2 `32px`/300, body `14px`/400. **Never use weights above 400** — this brand has no bold variant.                                         |
| Use consistent spacing.                           | Spacing is from a fixed scale: `4, 8, 12, 16, 20, 24, 32, 40, 60` px. Section gaps are always `60–100px`. Card padding is always `32px`. No exceptions.                         |
| Buttons should have rounded corners.              | Buttons are `40px` tall minimum, `4px` radius, `15.5px 24px` padding. Pill-shape `9999px` radius is reserved for the floating chat trigger only.                                |

#### One worked example (Framer — 5 rules)

```markdown
### Iteration Guide

1. **All interactive elements use Framer Blue (`#0000EE`)** — links, primary buttons, active states, focus indicators. Secondary uses `#0099FF` for hover. **No other interactive color exists in the system.**

2. **Typography: GT Walsheim Medium for headings, Inter for body.** Hierarchy enforced through size only, never color. H2 `62px`, H5 `85px`, body `14px`, labels `12px`/500. Text defaults to `#000000` on white, `#FFFFFF` on dark.

3. **Spacing is base-4** — every margin / padding / gap is a multiple of `4px`. Section gaps `60–100px`. **Never use odd values like `13px` or `17px`** — the system has no place for them.

4. **Cards: white (`#FFFFFF`), `1px` border `#EFEFEF`, `8px` radius, `16–20px` padding, no shadow by default.** Dark-mode cards swap to `#1A1A1A` background with `#242424` border. Shadow only appears on hover.

5. **Glass containers** use `rgba(255,255,255,0.9)` background, `1px` border `rgba(255,255,255,0.2)`, optional `backdrop-filter: blur(8px)`. **These are the only place transparent fills appear** — everywhere else uses solid color.
```

If your draft has a rule like "all interactive elements require visible focus states for accessibility" — delete it. Not wrong, just not load-bearing for _this_ brand.

---

## Rules

- Use **exact values** from `capture/extracted/tokens.json`. Cross-reference with screenshots when needed.
- Name colors and components descriptively — "Stripe Purple" not "Accent 1."
- When you can't extract exact values, estimate from visual inspection and note it.
- Target **250–350 lines total.** Component CSS specs and the brand's spacing/depth values are load-bearing — sub-agents need them to compose UIs faithfully. Going much over 350 lines means you're over-investing in prose; going much under 200 means you've under-documented the component DNA and sub-agents will fall back to generic patterns.
- No "Assets" section — `capture/extracted/asset-descriptions.md` is the asset index.
- No "Motion" section — the storyboard specifies motion per-beat.
- No "Components" section beyond what fits in Quick Reference — sub-agents compose UIs at build time from divs/SVG/CSS using the brand colors and fonts from this doc, not from CSS specs encoded here.
- No "Depth & Elevation" tables — shadow language is implied by the brand's mood (heavy shadows for premium, no shadows for flat/clean); sub-agents pick appropriate values without a table.

---

## Quick User Check (before moving to Step 2)

30-second sanity check before Step 2:

> "Here's what I extracted as [Brand Name]'s visual identity:
>
> - **Colors:** [primary], [accent], [2-3 others with roles]
> - **Fonts:** [headline font], [body font]
> - **Tone:** [1 sentence on the brand feel]
>
> Does this match how you want the video to feel? Any corrections or overrides before I start the storyboard?"

If the user has corrections ("use the blue, not the gray" / "ignore the dark mode" / "we just rebranded, use [these values] instead") — update DESIGN.md now. One minute here saves thirty minutes of rebuilding.

---

## What makes a useful DESIGN.md

A sub-agent reading just your Quick Reference + Iteration Guide should be able to:

1. Pick the right color for any primary action, secondary action, body text, error state
2. Pick the right font/weight/size for any headline, body, metadata
3. Know which 2-3 rules they cannot break without losing the brand

That's the test. If they can answer those three questions from a 60–120 line doc, you've nailed it. If they need to read 400 lines of mood-board prose to find a color, you've buried the signal.
