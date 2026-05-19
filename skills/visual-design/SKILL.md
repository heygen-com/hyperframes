---
name: visual-design
description: Design a video's visual treatment and animation choreography — typography, color, composition, motion principles, and a catalog of available animation effects described in natural language. Use when designing how the video should look after the story is decided (typically following `/story-design`). Output is a `section_plan.md` of creative intent that a build agent translates into HTML composition + GSAP timeline code.
metadata:
  tags: design, typography, color, composition, motion, animation, effects, visual, aesthetic
---

# Visual Design

The visual layer of a promotional video. Given the story (typically from `/story-design`'s `narrator_scripts.json`) and extraction data, design the visual treatment and animation choreography for each scene. Output: `section_plan.md`.

This skill is about **creative intent**, not code. Describe what you want to see in natural language; a downstream build agent (using `/hyperframes-animation` + `/hyperframes-core` + `/hyperframes-gsap`) translates it into the HTML composition + GSAP timeline.

## Design principles

Load specific rules on demand for detailed guidance:

<rules>
<typography path="rules/typography.md">Font hierarchy, scale, and selection — site fonts first, curated fallbacks second. Tags: font, typography, text, hierarchy</typography>
<color-system path="rules/color-system.md">Brand color extraction from tokens.json, palette roles, 60-30-10 allocation, cross-scene consistency. Tags: color, palette, brand, tokens</color-system>
<composition path="rules/composition.md">1920x1080 canvas layout, whitespace rhythm, visual hierarchy, depth layering. Tags: layout, composition, whitespace, hierarchy</composition>
<motion-language path="rules/motion-language.md">Unified easing presets, duration norms, stagger limits, exit/entry timing. Tags: easing, spring, timing, rhythm</motion-language>
</rules>

### Key principles summary

- **Typography** — Use the brand's own fonts. 5-tier size scale (hero 100-120px down to caption 20-28px). Hierarchy through size + weight + color + spacing, not size alone.
- **Color** — Extract palette from `tokens.json`. 60-30-10 rule (neutral bg / secondary elements / brand accent). Tint neutrals toward brand hue. Never pure black or white.
- **Composition** — Squint test: primary element identifiable at a glance. Primary visual covers 40%+ of canvas. Every scene has 3+ depth layers (background, midground, foreground). Mix composition styles across scenes.
- **Motion** — Consistent spring presets and easing curves across the video. Entry animations 300–500ms. Exits 75% of entry duration. Total stagger capped at 500ms. Every element keeps moving after entry.

## Scene quality baseline

Every scene must meet these minimums:

### Three-layer motion model

1. **Macro Motion** — camera drift: slow zoom + translation across the whole frame
2. **Element Motion** — content enters, then keeps drifting / rotating / scaling (never sits still)
3. **Micro Motion** — ambient details: flowing gradients, breathing glow, looping particles

### Environment layers

Every scene has a visual foundation beyond its core content:

1. **Camera drift** — continuous subtle zoom + pan on the whole frame
2. **Ambient particles** — brand-colored floating particles as atmospheric background
3. **Emphasis moment** — at least one impact beat (ripple on landing, glow burst on keyword, impact lines on data reveal)

### Multi-phase choreography

Static = dead. Each scene should have multiple animation phases:

```
entry → rearrange/morph → camera push → emphasis/interaction → exit
```

A scene where elements spring in and then sit still is a slideshow, not a video.

### Forbidden patterns

- Continuous motion covers less than 50% of the scene duration
- Tiny 3px floating as the only "motion"
- Word-by-word text pop-up as the primary visual (text is supporting, visual choreography is the lead)
- All elements entering simultaneously (must stagger)
- Only environment layers with no main content (just particles + subtitles)
- Same composition layout for every scene (use at least 3 different compositions)
- Primary visual element covering less than 40% of canvas

---

## Animation effects catalog

These are the motion techniques the build agent can implement. Reference them **by name** in your visual plan. Combine multiple effects per scene for rich choreography.

### Camera & Viewport

| Effect                     | Description                                                                                                                                               | Best for                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **camera-cursor-tracking** | Camera locks onto a moving element and follows it across the frame, keeping it centered while background shifts                                           | UI demos where attention must follow a cursor or highlight across a product interface |
| **coordinate-target-zoom** | Camera zooms into a specific non-centered point on the canvas, with counter-translation to keep the target visible                                        | Focusing on a specific UI element, data point, or product detail                      |
| **multi-phase-camera**     | Camera moves through 2-3 sequential phases (pull back to show context → focus on subject → push in for detail) with continuous micro-drift between phases | Complex scenes that need to reveal context first, then drill into specifics           |

### Interaction & Click Simulation

| Effect                     | Description                                                                                                                 | Best for                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **press-release-spring**   | Element compresses down like a physical button press, then springs back with elastic recovery                               | CTA buttons, interactive UI elements, tactile product demos       |
| **physics-press-reaction** | Realistic click where surrounding elements physically react to the press (displacement, wobble)                             | Product interaction demos where the UI feels alive and responsive |
| **cursor-click-ripple**    | Animated cursor glides to a target, clicks with visible depression, and expanding ripple rings radiate from the click point | Step-by-step product walkthroughs, demonstrating user workflows   |

### Text & Typography

| Effect                       | Description                                                                                                                        | Best for                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **hacker-flip-3d**           | Characters rotate in 3D one by one, cycling through random glyphs before settling on the correct letter (decryption/decode effect) | Tech brand reveals, cybersecurity products, "unlocking" moments       |
| **discrete-text-sequence**   | Text changes at specific frame thresholds (not smooth typing — abrupt swaps) creating a non-linear, glitchy typing feel            | Data processing visuals, AI output simulation, rapid-fire messaging   |
| **context-sensitive-cursor** | Typing cursor changes its appearance (color, shape, blinking speed) based on the text segment being typed                          | Coding demos, multi-context workflows, text that shifts meaning       |
| **vertical-spring-ticker**   | Text slots scroll vertically with spring physics (like a slot machine) to reveal new values                                        | Changing statistics, rotating feature names, before/after value swaps |
| **asr-keyword-glow**         | Specific keywords glow and scale up at the exact moment they are spoken in the narration (synced to word timestamps)               | Emphasizing key terms during narration, linking audio to visual beats |
| **3d-text-depth-layers**     | Text rendered with multiple offset layers behind it creating a 3D extrusion/shadow depth effect                                    | Hero headlines, brand name reveals, dramatic typography moments       |
| **counting-dynamic-scale**   | Number counter animates upward while font size grows proportionally — bigger numbers feel physically larger                        | Revenue stats, user counts, performance metrics, growth stories       |

### SVG & Icons

| Effect                  | Description                                                                                                                     | Best for                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **svg-path-draw**       | SVG outlines draw themselves stroke by stroke, revealing the shape progressively                                                | Logo reveals, diagram construction, technical illustrations           |
| **svg-icon-enrichment** | Individual parts of SVG icons animate independently (clock hands rotate, signal dots pulse, checkmarks draw) — icons feel alive | Feature lists where each icon has personality, dashboard-style scenes |

### Layout & 3D

| Effect                       | Description                                                                                                | Best for                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **split-tilt-cards**         | Two cards tilt in opposite directions on the Y-axis, creating a symmetric 3D split-screen                  | Before/after comparisons, feature vs. competitor, plan tiers          |
| **3d-page-scroll**           | A webpage screenshot is displayed on a tilted 3D card that scrolls vertically to reveal different sections | Product demos, showing a full landing page or dashboard in context    |
| **orbit-3d-entry**           | Elements flip in from 3D space and then orbit on an elliptical path around a center point                  | Feature ecosystems, integration showcases, connected capabilities     |
| **center-outward-expansion** | All elements start stacked at the center of the screen, then spring outward to their final positions       | Feature reveals, capability explosions, "everything included" moments |
| **avatar-cloud-network**     | User avatars arranged on an elliptical ring with animated SVG lines connecting them to a center hub        | Social proof, community size, network effects, collaboration features |
| **ai-tracking-box**          | A bounding box with corner markers follows an oscillating path, simulating AI object detection             | AI/ML product demos, computer vision features, smart detection        |

### Transition & Motion

| Effect                         | Description                                                                                                      | Best for                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **scale-swap-transition**      | Current element shrinks away while the next element pops in at the same position — a coordinated morph-like swap | Shot transitions within a scene, swapping between related visuals             |
| **reactive-displacement**      | New elements physically push existing elements out of the way as they enter (collision physics)                  | High-energy reveals, competitive displacement, "replacing the old way"        |
| **card-morph-anchor**          | A persistent container smoothly morphs its dimensions and border-radius as content inside changes between shots  | Scenes with a persistent card that evolves (feature card → detail view → CTA) |
| **sine-wave-loop**             | Continuous breathing/floating animation using trigonometric functions for natural-feeling idle motion            | Background elements, decorative shapes, ambient visual texture                |
| **dynamic-content-sequencing** | Timeline automatically calculated from text length and reading speed — content phases itself                     | Text-heavy scenes, multi-step explanations, auto-paced reveals                |

---

## Choreography patterns

Proven multi-phase scene designs. Study them for structural inspiration, then adapt freely — do not copy verbatim. Every scene should be tailored to its content and narrative role.

### Brand & Authority

| Pattern                    | Description                                                                                                                                                              | Best for                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **anchor-chain-reveal**    | A brand element (logo, product) persists across 3-4 shots as the anchor while surrounding content swaps out (text, stats, testimonials build up around it progressively) | Brand authority scenes, social proof accumulation, trust-building   |
| **sequential-type-cursor** | Typewriter effect where a cursor types multiple text segments, changing its visual style (color, shape) for each segment to match the content's tone                     | Tagline reveals, multi-benefit introductions, narrative text scenes |

### Product Showcase

| Pattern                           | Description                                                                                                                                           | Best for                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **contextual-product-showcase**   | Product interface shown in realistic context (tilted device mockup) with supporting detail cards floating around it, progressively revealing features | Feature spotlight, product introduction, "here's what it does" scenes |
| **mockup-morph-overwhelm**        | Device mockup morphs shape while content inside scrolls and additional elements flood in from the edges                                               | Product demos that need to show both breadth and depth of features    |
| **interactive-workflow-showcase** | Step-by-step workflow demo with simulated cursor interactions — click a button, see the result, move to next step                                     | Onboarding flows, "how it works" explanations, workflow automation    |

### Data & Impact

| Pattern                 | Description                                                                                                          | Best for                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **counting-icon-burst** | A central counter animates up while icons burst outward in a radial pattern, each representing a category or feature | Statistics reveals, growth metrics, "by the numbers" scenes                 |
| **decrypt-pan-track**   | Text decodes character by character (hacker-flip) while the camera simultaneously pans and tracks across the frame   | Tech product reveals, data processing visualization, cipher/security themes |

### Reveal & Transition

| Pattern                     | Description                                                                                                                           | Best for                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **assembly-focus-reveal**   | Multiple elements fly in from various directions and assemble into a formation, then the camera narrows focus to the hero element     | Feature ecosystem → hero product, "all of this comes together" moments   |
| **content-displace-reveal** | New content physically collides with and displaces existing elements (outgoing elements shoved aside by incoming ones)                | Competitive comparisons, "out with the old, in with the new" transitions |
| **split-comparison-reveal** | Screen splits into two halves showing contrasting states (before/after, old/new, problem/solution) with simultaneous animated content | Comparison scenes, transformation stories, A/B demonstrations            |
| **orbit-collapse-action**   | Elements orbit around a center point, then collapse inward converging to a single action element (CTA button, logo)                   | Closing scenes, CTA moments, "everything leads here"                     |

### CTA & Closing

| Pattern                      | Description                                                                                                     | Best for                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **morph-press-interact**     | A hero element morphs into a CTA button shape, then a cursor enters and clicks it with physical spring response | Final CTA scenes, "try it now" moments, closing with action       |
| **video-kinetic-text-pivot** | Background video plays while kinetic text overlays pivot, rotate, and transform in sync with the narrative      | Energy-heavy scenes, music-driven moments, brand manifesto closes |

---

## How to write `section_plan.md`

One section per scene, in scene order. For each scene answer: what does the viewer see, what moves, how does it feel.

1. **Describe spatial relationships in natural language** — "product screenshot dominates the left two-thirds of the frame with a slight 3D tilt; feature bullets enter from the right with staggered timing"
2. **Reference effects by name** from the catalog above (e.g. `3d-page-scroll`, `cursor-click-ripple`)
3. **Reference choreography patterns for structural inspiration** (e.g. "follow `assembly-focus-reveal`")
4. **Specify the emotional and visual intent** — the build agent chooses the concrete layout and code
5. **Do NOT prescribe specific layout templates or pixel values** — describe what you want to see, not where things go numerically
6. **Ensure variety** — at least 3 different compositional arrangements across scenes; don't center everything

## See also

- `/story-design` — story / narrative architecture (upstream; produces `narrator_scripts.json`).
- `/hyperframes-animation` — the catalog of blueprints + atomic rules a build agent uses to realize this plan.
- `/product-launch-video` — orchestrator that consumes `section_plan.md` and drives the build phase.
