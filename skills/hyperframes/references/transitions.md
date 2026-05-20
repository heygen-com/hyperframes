# Scene Transitions

A transition tells the viewer how two scenes relate. A crossfade says "this continues." A push slide says "next point." A blur crossfade says "drift with me." Choose transitions that match what the content is doing emotionally, not just technically.

## Animation Rules for Multi-Scene Compositions

These are non-negotiable for every multi-scene composition:

1. **Every composition uses transitions.** No exceptions. Scenes without transitions feel like jump cuts.
2. **Every scene uses entrance animations.** Elements animate IN via `gsap.from()` — opacity, position, scale, etc. No scene should pop fully-formed onto screen.
3. **Exit animations are BANNED** except on the final scene. Do NOT use `gsap.to()` to animate elements out before a transition fires. The transition IS the exit. Outgoing scene content must be fully visible when the transition starts — the transition handles the visual handoff.
4. **Final scene exception:** The last scene MAY fade elements out (e.g., fade to black at the end of the composition). This is the only scene where exit animations are allowed.

## Energy → Transition Character

The energy of a beat tells you what motion character the transition should have — not which specific transition to use. The motion character is a quality you derive from the brand and content, then find a transition that has that quality.

**Soft/organic character:** transitions that breathe, dissolve, or drift. Nothing sharp, mechanical, or percussive. Duration 0.5–0.8s, smooth easing curves.

**Directional/purposeful character:** transitions that move content decisively. Clear direction, readable momentum. Duration 0.3–0.5s, clean deceleration.

**Percussive/instant character:** transitions that hit like a cut. Immediate, almost hard-cut energy. Duration 0.15–0.3s, aggressive or near-instant easing.

These are calibration ranges, not recipes. A brand that treats its "high energy" section with restraint might use 0.4s for a moment that another brand transitions in 0.2s — both are correct for their brand. Pick ONE character that defines the video's primary transitions, then use 1–2 contrasting moments as intentional accents. See the **Mood → Motion Quality** section below to find transitions with the right character for a given mood.

## Mood → Motion Quality

Think about what the transition _communicates_, not what it looks like. The question is: **what motion quality serves this mood?** Then find transitions that have that quality in the catalog (`transitions/catalog.md`).

| Mood                     | Motion quality that fits                                                                    | Why                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Warm / inviting**      | Soft edges, dissolving, color-temperature washes — nothing sharp, mechanical, or percussive | Warmth reads as continuity and flow; hard cuts or compression feel cold             |
| **Cold / clinical**      | Mechanical transformation — compression, slicing, gridding, precision                       | The content appears to be processed or structured, reinforcing a systematic quality |
| **Editorial / magazine** | Clean directional movement — like turning a page                                            | Feels like content is being browsed or curated, not revealed                        |
| **Tech / futuristic**    | Data-like fragmentation, digital displacement, scan artifacts                               | Transition feels computational rather than physical                                 |
| **Tense / edgy**         | Instability, distortion, displacement — something slightly wrong about the image            | Introduces friction where smooth transitions would release tension                  |
| **Playful / fun**        | Overshoot, expansion, rotation — motion with personality and bounce                         | Transitions that feel like objects rather than effects                              |
| **Dramatic / cinematic** | Scale, weight, light extremes — the cut is an event, not a bridge                           | Every shader and every hard cut carries narrative gravity                           |
| **Premium / luxury**     | Restraint — transitions that are barely visible, or invisible                               | Luxury communicates through what it withholds                                       |
| **Retro / analog**       | Organic imperfection — light bleed, scan lines, color wash                                  | Physical film artifacts; imperfection as authenticity                               |

Use this table to derive what **quality** the transition should have, then look at the specific options in `transitions/catalog.md` to find one that has that quality for this brand. The transitions listed in the catalog are all available; none are reserved for a specific mood.

## Narrative Position

Each position in the video has a different job to do. What transition you pick for each should come from the brand's motion character and the storyboard's intent — not from a rule about "climax = boldest."

- **Opening** — establishes the motion language for the entire video. Make a deliberate choice; whatever you pick here sets the viewer's expectation for everything that follows.
- **Between related points** — should be almost invisible. The content is continuing; the transition shouldn't draw attention to itself. Consistency matters more than distinctiveness here.
- **Topic change** — needs enough contrast from your primary that it signals "something different is starting." The contrast is in motion character, not just duration.
- **Climax / hero reveal** — this is the moment the video has been building to. The transition should feel earned by what came before. "Use your boldest transition here" is a default, not a rule — the climax of a restrained editorial piece might be a hard cut.
- **Wind-down** — returns to a motion character that allows the viewer to exhale. Matches the opening in tone, not necessarily in technique.
- **Outro** — no new energy. Slowest and simplest in the video. Closure.

## Blur and Motion Intensity

Blur and duration should express the energy of the content, not match a lookup table. The ranges below are calibration references — starting points to adjust from based on what the brand and storyboard call for.

Higher-energy transitions: shorter duration, less blur, no hold at peak. The motion is immediate.
Lower-energy transitions: longer duration, more blur, longer hold at peak. The motion has weight.

Calibration ranges (not prescriptions):

- Soft/organic: blur 20–30px, duration 0.8–1.2s, hold 0.3–0.5s
- Directional/purposeful: blur 8–15px, duration 0.4–0.6s, hold 0.1–0.2s
- Percussive/instant: blur 3–6px, duration 0.2–0.3s, no hold

A brand that uses these as a formula will produce transitions that feel the same across every video. A brand-derived choice asks: what blur and duration expresses the weight this transition should have?

## Presets

| Preset     | Duration | Easing            |
| ---------- | -------- | ----------------- |
| `snappy`   | 0.2s     | `power4.inOut`    |
| `smooth`   | 0.4s     | `power2.inOut`    |
| `gentle`   | 0.6s     | `sine.inOut`      |
| `dramatic` | 0.5s     | `power3.in` → out |
| `instant`  | 0.15s    | `expo.inOut`      |
| `luxe`     | 0.7s     | `power1.inOut`    |

## Implementation

Read [transitions/catalog.md](transitions/catalog.md) for GSAP code and hard rules for every transition type.

| Category    | CSS                                                            | Shader (WebGL)                                                            |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Push/slide  | Push slide, vertical push, elastic push, squeeze               | Whip pan                                                                  |
| Scale/zoom  | Zoom through, zoom out, gravity drop, 3D flip                  | Cinematic zoom, gravitational lens                                        |
| Reveal/mask | Circle iris, diamond iris, diagonal split, clock wipe, shutter | SDF iris                                                                  |
| Dissolve    | Crossfade, blur crossfade, focus pull, color dip               | Cross-warp morph, domain warp                                             |
| Cover       | Staggered blocks, horizontal blinds, vertical blinds           | —                                                                         |
| Light       | Light leak, overexposure burn, film burn                       | Light leak (shader), thermal distortion                                   |
| Distortion  | Glitch, chromatic aberration, ripple, VHS tape                 | Glitch (shader), chromatic split, ridged burn, ripple waves, swirl vortex |
| Pattern     | Grid dissolve, morph circle                                    | —                                                                         |

## Transitions That Don't Work in CSS

Avoid: star iris, tilt-shift, lens flare, hinge/door. See catalog.md for why.

## CSS vs Shader

CSS transitions animate scene containers with opacity, transforms, clip-path, and filters. Shader transitions composite both scene textures per-pixel on a WebGL canvas — they can warp, dissolve, and morph in ways CSS cannot.

**Both are first-class options.** Shaders are provided by the `@hyperframes/shader-transitions` package — import from the package instead of writing raw GLSL. CSS transitions are simpler to set up. Choose based on the effect you want, not based on which is easier.

**Mixing is supported.** You can have some transitions use WebGL shaders and others use a CSS crossfade in the same composition. Omit the `shader` field on any `TransitionConfig` entry to get a smooth opacity crossfade instead of a WebGL effect:

```js
var tl = HyperShader.init({
  bgColor: "#000",
  accentColor: "#6366f1",
  scenes: ["s1", "s2", "s3", "s4"],
  transitions: [
    { time: 4.0, shader: "sdf-iris", duration: 0.7 }, // WebGL shader
    { time: 8.5, duration: 0.8 }, // no shader → CSS crossfade
    { time: 13.0, shader: "domain-warp", duration: 0.6 }, // WebGL shader
  ],
});
```

HyperShader manages all scene visibility regardless of transition type. Let it create the timeline (don't pass `timeline:` into `init()`) and add your beat animations to the returned `tl` after the call.

## Shader-Compatible CSS Rules

Shader transitions capture DOM scenes to WebGL textures via html2canvas. The canvas 2D rendering pipeline doesn't match CSS exactly. Follow these rules to avoid visible artifacts at transition boundaries:

1. **No `transparent` keyword in gradients.** Canvas interpolates `transparent` as `rgba(0,0,0,0)` (black at zero alpha), creating dark fringes. Always use the target color at zero alpha: `rgba(200,117,51,0)` not `transparent`.
2. **No gradient backgrounds on elements thinner than 4px.** Canvas can't match CSS gradient rendering on 1-2px elements. Use solid `background-color` on thin accent lines.
3. **No CSS variables (`var()`) on elements visible during capture.** html2canvas doesn't reliably resolve custom properties. Use literal color values in inline styles.
4. **Mark uncapturable decorative elements with `data-no-capture`.** The capture function skips these. They're present on the live DOM but absent from the shader texture. Use for elements that can't follow the rules above.
5. **No gradient opacity below 0.15.** Gradient elements below 10% opacity render differently in canvas vs CSS. Increase to 0.15+ or use a solid color at equivalent brightness.
6. **Every `.scene` div must have explicit `background-color`, AND pass the same color as `bgColor` in the `init()` config.** The package captures scene elements via html2canvas. Both the CSS `background-color` on `.scene` and the `bgColor` config must match. Without either, the texture renders as black.

These rules only apply to shader transition compositions. CSS-only compositions have no restrictions.

## Visual Pattern Warning

Avoid transitions that create visible repeating geometric patterns — grids of tiles, hexagonal cells, uniform dot arrays, evenly-spaced blob circles. These look cheap and artificial regardless of the math behind them. Organic noise (FBM, domain warping) is good because it's irregular. Geometric repetition is bad because the eye instantly sees the grid.
