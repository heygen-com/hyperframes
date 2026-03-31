# House Style

Defaults when no `visual-style.md` or animation direction is provided. These raise the floor — not a brand identity, just professional quality.

## Before Writing HTML

1. **Interpret the prompt.** Generate real content for the topic — don't use the prompt text as body copy. A recipe lists real ingredients. A stats dashboard shows the actual numbers given. A product showcase names real features and specs. A sci-fi HUD has actual crosshairs and readouts, not a heading that says "sci-fi HUD."
2. **Pick a palette.** First decide: does this content call for a light or dark canvas? Then load the file most appropriate for the theme and pick one palette at random from the file. Declare your bg, fg, and accent colors before writing any code.
3. **Pick a typeface.** Don't reach for Sora, Space Grotesk, Outfit, Playfair Display, Cormorant Garamond, or Bodoni Moda — they're overused. Explore the full range of Google Fonts. Serif for editorial, mono for technical, display for impact, handwritten for personal.
4. **Pick a layout approach.** Don't default to the same structure every time.
5. **Pick your entrance patterns.** Plan how elements enter — never use the same entrance pattern twice in a composition.

## Motion

### Easing

Vary your eases. Don't use the same ease on more than 2 tweens in a composition. Pick from the full GSAP vocabulary:

`power1-4.in/out/inOut`, `back.out(1.4-2.5)`, `elastic.out(1, 0.3-0.5)`, `circ.out`, `expo.out`, `sine.inOut`, `steps(n)`

A few principles:

- Opacity fades should be gentle (`power1` or `none`) — don't draw attention to the fade itself
- Overshoot on scale or position feels alive — `back.out` or `elastic.out`
- Snappy moves want `expo.out` or `power4.out` — fast departure, hard stop
- Smooth arcs want `sine.inOut` or `circ.inOut` — no hard edges

### Timing

- **0.3–0.6s** for most moves. Shorter than you think.
- **Exits 2x faster** than entrances.
- **Nothing starts at t=0** — offset first animation 0.1–0.3s.
- **Overlap entries** — next element starts before previous finishes. Use GSAP position parameter: `tl.to(el, {...}, "-=0.15")`
- **Stagger with easing**, not uniform: `stagger: { each: 0.08, ease: "power2.in" }`

### Entrance Patterns

Never fade-in alone. Combine opacity with at least one transform. Never repeat the same entrance in a composition. Invent your own combinations — mix properties creatively:

- **Position** — x, y, or both (diagonal). Vary the axis and distance per element.
- **Scale** — from smaller or larger. Pair with overshoot easing.
- **Rotation** — small angles (3-12deg) feel intentional. Large angles (45-180deg) feel dramatic.
- **Clip path** — `inset()`, `circle()`, `polygon()`. Direction matters: left, right, top, center outward.
- **Blur + opacity** — `filter: blur(8px)` combined with opacity creates a focus-pull effect.
- **Letter spacing / word spacing** — for text, animate tracking from wide to tight or vice versa.
- **Skew** — `skewX` or `skewY` gives a motion-blur feeling without actual blur.
- **3D transforms** — `rotationX`, `rotationY` with `transformPerspective` for depth.

Don't copy the same combination across compositions. Each composition should feel like it has its own motion personality.

### Choreography

- **Combined transforms** — animate 2–3 properties together (position + scale, rotation + opacity), not one at a time.
- **Coordinated entry** — when a new element enters, existing elements react. Anchor moves, follower tracks.
- **Ambient motion** — keep the composition alive during holds. Don't default to zoom-in every time. Pick one per composition:
  - Slow pan (x or y drift on a container)
  - Subtle rotation (0.5–2deg over several seconds)
  - Scale push or pull (zoom in OR out — both work)
  - Parallax layers (background moves slower than foreground)
  - Color/opacity shift on an accent element
  - No ambient motion at all — stillness can be powerful
- **End with intention** — don't always zoom at the end. Options: snap to black, fade to stillness, final element snaps into place, a hard cut. Vary this across compositions.

### Scene Pacing

Structure compositions in three phases — don't front-load everything:

- **Build (0–30%)** — elements enter. Stagger arrivals so there's a sequence, not a simultaneous dump.
- **Breathe (30–70%)** — content is visible. Keep it alive with subtle motion: slow camera push, gentle drift, a color shift, a pulsing accent. Static holds feel dead.
- **Resolve (70–100%)** — elements exit or the composition punctuates. Exits are faster than entrances. End with intention — a final zoom, a fade to black, a snap to stillness.

Don't crowd the build phase. If you have 6 elements, let 2-3 enter, breathe, then bring in the rest. Layers of reveals beat a single wave.

## Sizing

- **Text scale contrast** — headings at 3–5x body size, not 1.5x. Big contrast reads as cinematic.
- **Element fill** — hero elements fill 60–80% of the frame. Don't leave them floating at 30%.
- **Travel distance** — entrance moves should cover 80–200px. Under 20px looks like a glitch.
- **Overshoot** — 5–10% overshoot reads as energy. Under 2% reads as a bug.

## Visual Depth

Flat single-color backgrounds look digital. Avoid pure solid backgrounds — add some visual layer to break the flatness. Options include gradients, subtle background shapes, texture, shadows on cards, or border accents. Pick what fits the content — not every composition needs the same treatment. A luxury product wants subtle gradients. A children's show wants bold shapes. A news graphic wants clean borders.

## Typography

Beyond choosing a typeface:

- **Weight contrast** — pair a heavy weight (700-900) headline with a light weight (300-400) body. Always use at least two explicit font-weight values — even with display fonts that look bold by default, set labels or secondary text to a lighter weight.
- **Case deliberately** — ALL CAPS for labels and short text (under 5 words). Sentence case for longer text. Don't uppercase paragraphs.
- **Tracking** — tight tracking (-0.02em) on large headlines. Normal or wide tracking on small labels.
- **One typeface, two weights** — don't mix typefaces unless you have a reason. One family at two weights creates more hierarchy than two families at one weight each.

## Anti-Defaults

Things the LLM reaches for that look generic. Do the opposite.

| Default                           | Instead                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inter / Roboto / system font      | Pick a typeface with character — commit to it                                                                                                                                                                                                    |
| `#f5f5f5` / `#333` / mid-gray     | Go high contrast. Near-black or near-white, not the middle                                                                                                                                                                                       |
| Blue accent `#3b82f6`             | No blue unless the user asks for blue                                                                                                                                                                                                            |
| Everything centered, equal weight | One focal point per frame. Lead the eye somewhere                                                                                                                                                                                                |
| Uniform spacing                   | Tight clusters and open gaps. Vary deliberately                                                                                                                                                                                                  |
| Same entrance on every element    | Never repeat an entrance pattern in a composition                                                                                                                                                                                                |
| 1s duration on everything         | 0.3–0.6s. Shorter than you think                                                                                                                                                                                                                 |
| `power2.out` on everything        | Vary eases — no more than 2 independent tweens with the same ease (staggers are exempt)                                                                                                                                                          |
| Always dark background            | Match the content: food, weddings, kids, wellness, education → light palette                                                                                                                                                                     |
| Inventing colors per-element      | Declare palette up front. Every element references it                                                                                                                                                                                            |
| Content in cards/containers       | Place content directly on the canvas — separate with space and alignment, not box boundaries. Cards are a web pattern. Exception: dashboards, lower thirds, captions over footage                                                                |
| Hand-drawn SVG illustrations      | Don't attempt to draw real-world objects (faces, buildings, food, animals) with SVG paths — they look crude. Use geometric shapes, lines, and abstract forms only. If the composition needs imagery, use text and typography to evoke it instead |
| Overlapping elements              | Every element needs its own clear space. Check that positioned elements don't collide — stagger positions vertically with enough margin. Overlapping text is always ugly                                                                         |

## Palettes

Before writing any HTML, declare your palette: one background, one foreground, one accent. Pick from a category below — don't invent colors. **Match palette to content** — don't default to dark. Children's content, food, weddings, wellness, education, and lifestyle content should typically use light or warm palettes.

| Category          | Use for                                       | File                                                       |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Bold / Energetic  | Product launches, social media, announcements | [palettes/bold-energetic.md](palettes/bold-energetic.md)   |
| Warm / Editorial  | Storytelling, documentaries, case studies     | [palettes/warm-editorial.md](palettes/warm-editorial.md)   |
| Dark / Premium    | Tech, finance, luxury, cinematic              | [palettes/dark-premium.md](palettes/dark-premium.md)       |
| Clean / Corporate | Explainers, tutorials, presentations          | [palettes/clean-corporate.md](palettes/clean-corporate.md) |
| Nature / Earth    | Sustainability, outdoor, organic              | [palettes/nature-earth.md](palettes/nature-earth.md)       |
| Neon / Electric   | Gaming, tech, nightlife                       | [palettes/neon-electric.md](palettes/neon-electric.md)     |
| Pastel / Soft     | Fashion, beauty, lifestyle, wellness          | [palettes/pastel-soft.md](palettes/pastel-soft.md)         |
| Jewel / Rich      | Luxury, events, sophisticated                 | [palettes/jewel-rich.md](palettes/jewel-rich.md)           |
| Monochrome        | Dramatic, typography-focused                  | [palettes/monochrome.md](palettes/monochrome.md)           |

**Escape hatch:** If no category fits, derive from the color wheel — pick a base hue, take its complement or triadic, pull a dark from OKLCH lightness 15% and a light from 90%.
