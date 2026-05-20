# Visual Vocabulary

A vocabulary for talking about how a video looks and moves, organized along six independent axes. **The agent's job is to derive a value for each axis from the brand,** then treat the user's words as _modifiers_ on that brand-derived baseline.

The older version of this file had a "user says X → fill these 6 dimensions" lookup table. That table is gone. The failure mode it produced — "energetic wellness app" and "energetic fintech tool" rendering with the same 6-dimension recipe because both triggered the same user-word match — was the whole problem this skill is trying to solve.

The new flow:

1. **Read DESIGN.md and the captured site.** What cues does this brand give for each of the six axes? Each axis below lists what brand evidence suggests each value.
2. **Derive a baseline.** Write down what this _specific brand_ suggests for each axis, in one phrase per axis. This is the brand-native interpretation.
3. **Apply user modifiers.** If the user said "cinematic" or "fast" or "playful," treat that as a push on the baseline — not a replacement. "Cinematic" pushes toward slow pacing and dramatic transitions on top of what the brand already suggested; it doesn't override the brand.
4. **Resolve conflicts toward the brand.** If the user's word and the brand's evidence disagree strongly, raise it. Don't silently flatten the brand to fit the word.

---

## The Six Axes

Each axis below has values, and for each value, **brand cues that suggest it**. Read brand evidence first; the values are what you derive, not what you start with.

### 1. Pacing — how fast things move and change

| Value            | Animation durations     | Brand cues that suggest this value                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Slow**         | 1.5–3s per move         | Hero text dominates the homepage at large scale, copy uses long sentences and full paragraphs, whitespace is generous in the captured layout, serif or thin-weight sans typography, scroll animations on the site are fade-based and unhurried, brand language is mature ("decades of," "the standard for," "founded in") |
| **Moderate**     | 0.8–1.5s per move       | Standard product-marketing layout — hero plus three columns plus testimonials, sans-serif body type, content is sectioned but not dense, copy is professional but not formal, scroll animations exist but aren't dramatic                                                                                                 |
| **Fast**         | 0.3–0.6s per move       | Dense feature grids, multi-column comparison tables, video/gif assets autoplay in the hero, second-person urgent copy ("crush your goals," "ship faster"), social-media-first iconography, brand voice is energetic or consumer-facing                                                                                    |
| **Arc (varies)** | Slow→build→peak→resolve | The site itself has narrative pacing — a long-scroll story, sequential reveals, a "this is the problem / here's the solution / here's the proof" structure. Most launch and announcement videos benefit from arc pacing regardless of brand.                                                                              |

### 2. Density — how much shares the frame

| Value        | Focus                                          | Brand cues that suggest this value                                                                                                                                                                               |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sparse**   | One element dominates, generous breathing room | Homepage is hero-then-scroll with one element per viewport, design uses architectural negative space, type carries the work without supporting imagery, brand is confident/restrained (luxury, mature B2B, art)  |
| **Balanced** | Primary plus 2–3 supporting                    | Standard marketing layout — hero with one secondary image, feature sections with icon + headline + body, professional but not minimal                                                                            |
| **Rich**     | Multiple elements share attention              | Dashboard or product-tour-heavy site, feature comparison grids, sites with charts/data visualizations as primary content, sites with dense pricing tables, consumer apps showing many screenshots simultaneously |

### 3. Transitions — how scenes change

| Value         | What happens                              | Brand cues that suggest this value                                                                                                                                                                                                               |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dramatic**  | GPU shader effects, ~0.5–0.8s             | Brand has high-stakes positioning (security, finance, dramatic reveals), homepage already uses dramatic transitions or shader effects, brand language uses words like "introducing," "finally," "the future of," brand has theatrical confidence |
| **Smooth**    | CSS-based fades, slides, blurs, ~0.3–0.6s | Most brands. The professional default. Brand reads as competent and current without theatrical aspiration.                                                                                                                                       |
| **Energetic** | Whip pans, fast zooms, ~0.2–0.4s          | Consumer apps, social-first brands, brands targeting younger demographics, gaming, fast-moving consumer goods, brand voice uses imperatives and exclamation                                                                                      |
| **Hard cut**  | Instant switches                          | Editorial brands, news, brands with confident type-driven identity, anything where rhythm/cadence is the design feature                                                                                                                          |

**A note on dramatic transitions:** Even when the brand suggests dramatic, the storyboard should not use shader transitions on every scene change. One to two shader moments in a video is the ceiling. Beyond that the effects flatten each other.

### 4. Mood — visual atmosphere

| Value           | Characteristics                                         | Brand cues that suggest this value                                                                                                                                                      |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dark**        | Deep backgrounds, glow accents, light from darkness     | Captured site uses dark theme as default, primary background is near-black or deep neutral, single saturated accent against the dark, brand operates in technical/dramatic/luxury space |
| **Light**       | Bright backgrounds, brand colors as accents             | Captured site is white-or-near-white background, structure comes from borders and shadows not from color, brand is consumer-facing, friendly, or corporate-clean                        |
| **Vibrant**     | Multiple saturated colors, gradient backgrounds         | Brand uses multiple primary colors (not one accent), captured site uses gradient or aurora effects, brand voice is celebratory or energetic, consumer or creative product               |
| **Atmospheric** | Dark base with gradient depth, color temperature shifts | Captured site uses dark base + colored gradients, brand has cinematic positioning, AI/computational brands often land here                                                              |

**Critical:** This axis comes more from the brand than any other. A dark-themed site gets dark mood; a white corporate site gets light mood. Don't override mood from a user word — if the user wants "cinematic" for a bright consumer brand, light-cinematic is a real thing (think Apple keynotes pre-2018) and you should reach for it rather than flipping the brand dark.

### 5. Motion language — how elements move

| Value          | Easing flavor                            | Brand cues that suggest this value                                                                                                                     |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cinematic**  | Slow drifts, parallax, Ken Burns         | Brand has theatrical or premium positioning, captured site uses parallax or scroll-driven storytelling, brand pace is unhurried                        |
| **Dynamic**    | Bounce, overshoot, elastic               | Consumer-facing brand, playful or energetic voice, captured site has bouncy micro-interactions, brand targets younger or general-consumer audience     |
| **Elegant**    | Smooth precise reveals without overshoot | Editorial or premium brand with restraint, captured site has clean fades and considered transitions, brand voice is confident without being theatrical |
| **Restrained** | Controlled, grid-aligned, no overshoot   | Technical product, dev tool, data-focused, captured site is minimal-decoration / function-first, brand voice is direct and unornamented                |

### 6. Audio — how sound supports the visual

This axis has the least brand evidence to draw from (captured sites don't have soundtracks), so it leans more on user direction and video type. But there are still brand cues:

| Value        | Voice / music / SFX character                                | Brand cues that suggest this value                                                           |
| ------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Ambient**  | Calm voice, sustained pads, sparse SFX                       | Brand voice in copy is measured and unhurried, brand operates in considered/premium space    |
| **Punchy**   | Confident upbeat voice, rhythmic music, impact SFX           | Consumer brand, energetic voice in copy, urgency language, social-first                      |
| **Minimal**  | Silence and texture, voice carries everything, almost no SFX | Editorial brand, restraint-heavy identity, brand whose homepage uses no decorative motion    |
| **Dramatic** | Slow voice with pauses, tension pads, deliberate silence     | High-stakes brand positioning, theatrical voice in copy ("we believe," "the future demands") |

---

## How user words modify the baseline

After deriving a baseline from the brand, **read what the user actually said** and apply it as a modifier. Some user words map cleanly to single-axis pushes; some are vibe words that touch several axes; some only modify one part of the video.

The user word is a _direction of push_, not a replacement for the brand-derived value.

### Common user words and what they push

These are pushes, not recipes. They modify whatever baseline you derived from the brand — they don't replace it.

- **"Cinematic"** — pushes pacing slower (or toward arc), transitions toward dramatic for hero moments only, motion toward cinematic. Does _not_ automatically push mood toward dark — a cinematic light video is real (premium hotels, fashion, architecture).
- **"High-energy"** — pushes pacing faster, transitions toward energetic, motion toward dynamic, audio toward punchy. Does _not_ automatically push mood toward vibrant — a dark high-energy video is real (action movies, gaming launches).
- **"Minimal" / "clean"** — pushes density toward sparse, transitions toward smooth, motion toward elegant or restrained. Does _not_ automatically push mood toward light — minimal-dark is a major aesthetic (Bang & Olufsen, Aesop, most luxury).
- **"Professional"** — usually means "don't do anything weird." Mostly a no-op push that confirms the baseline; sometimes pulls dynamic or punchy axes slightly toward elegant or ambient.
- **"Playful" / "fun"** — pushes motion toward dynamic, transitions toward energetic, audio toward punchy. Does _not_ automatically push pacing to fast — playful-slow is a real thing (children's books, charm-forward brands).
- **"Premium" / "luxury"** — pushes pacing slower, density sparser, motion toward cinematic or elegant. Does _not_ automatically push mood toward dark — premium-light is the dominant aesthetic of most actual luxury brands today.
- **"Technical" / "developer"** — pushes motion toward restrained, density toward balanced or rich, audio toward minimal. Mood follows the brand — most dev tools are dark but not all.

Notice that every entry above includes what the word _doesn't_ do. That's deliberate — the previous file mapped each word onto all six axes simultaneously, which is what produced the homogeneity.

### When the user word and the brand conflict

If the user says "cinematic" and the brand is a brightly-colored playful consumer app, you have a conflict. Three options:

1. **Trust the brand and the word together.** Cinematic-playful is a real aesthetic (think Wes Anderson) — slow pacing, sparse density, but vibrant mood and elegant-with-personality motion. Borrow the dimensions that _can_ coexist; don't flatten one for the other.
2. **Ask.** "You said cinematic — I want to check, because your brand is bright and playful. Are you imagining slow dramatic reveals (which would mean leaning away from your brand's energy) or something more like Wes Anderson's pacing applied to your existing palette?"
3. **Default to brand if you can't ask.** When a video has to ship and the user isn't available, the brand-derived baseline is the safer choice — the user can always say "make it more cinematic" on review, but a video that contradicts the brand is harder to come back from.

---

## Lazy Defaults to Question

When you find yourself reaching for any of these as automatic responses, pause and ask whether it's coming from the brand or from a pattern-match:

- "Cinematic" → automatic dark mood + slow pace + dramatic transitions, regardless of what the brand actually looks like
- "Technical" → automatic dark mode + terminal font + restrained motion, regardless of what the dev tool's actual brand is
- "Premium" → automatic slow + sparse + dark, regardless of whether the brand is actually a light-premium or vibrant-premium aesthetic
- "Launch" → automatic dramatic transitions on every scene because "this is a big announcement"
- "Social ad" → automatic fast pacing + punchy audio + hard cuts, even when the brand's social presence is actually slow and editorial

If you catch yourself doing one of these, the fix is to go back to the brand evidence and re-derive. The user word should modify what the brand suggests — not replace it.

---

## Per-beat overrides

The baseline you derive applies to the whole video by default. The storyboard can override a single axis on a single beat — "this beat is faster" or "the transition into beat 4 is dramatic." These overrides should appear in the storyboard's notes, with a one-sentence reason rooted in this beat's purpose, not in a style preset.

Example override note:

> "Beat 4 — transition override to dramatic shader. Reason: this is the product-reveal beat and the brand's homepage has a similar dramatic moment on first scroll. The shader is doing what the brand already does at this moment in its own story."

The reason is the load-bearing part. "Use dramatic shader on beat 4" with no reason is style-by-fiat; the version with a reason is style-by-derivation.

---

## A worked example

Captured brand: a wellness app with light cream backgrounds, lowercase humanist serif type, soft pastel accents, first-person copy ("we believe in small daily rituals"), no urgency language, slow scroll-driven photography of hands.

User direction: "I want it high-energy for TikTok."

**Brand-derived baseline:**

- Pacing: slow (cream + serif + slow scroll photography + unhurried copy)
- Density: sparse (architectural negative space on site)
- Transitions: smooth (no dramatic transitions on the captured site)
- Mood: light (cream backgrounds are the brand's signature)
- Motion: elegant or cinematic (slow drifts on the captured site)
- Audio: ambient (unhurried copy voice)

**User modifier:** "high-energy for TikTok" pushes pacing faster, transitions toward energetic, motion toward dynamic, audio toward punchy.

**Conflict resolution:** the user's push is in direct conflict with the brand. Three options as above:

1. Borrow what can coexist — keep light mood and sparse density (brand-true), but accelerate pacing slightly and add motion personality. Result: a faster wellness video that still feels like a wellness video, not a fitness video.
2. Ask: "Your brand is paced slowly — for TikTok, do you want me to push it faster than your brand normally moves, or keep the calm pacing but design for vertical and short attention?"
3. If you can't ask: write the brand-true version and flag the tension in the Creative Direction Summary so the user can respond on review.

The wrong move is to read "high-energy" and produce a fast, punchy, vibrant video — which is what the old recipe table would have produced, and which would not be a video of this wellness brand. It would be a generic high-energy TikTok with a wellness logo pasted on.
