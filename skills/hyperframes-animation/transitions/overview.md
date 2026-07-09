# Scene Transitions

A transition tells the viewer how two scenes relate. A crossfade says "this continues." A push slide says "next point." A blur crossfade says "drift with me." Choose transitions that match what the content is doing emotionally, not just technically.

## Contents

- Animation rules for multi-scene compositions
- Energy and mood transition selection
- Narrative position
- Blur intensity
- Presets
- Implementation
- CSS vs shader guidance
- Shader-compatible CSS rules
- Visual pattern warnings

## Animation Rules for Multi-Scene Compositions

These are non-negotiable for every multi-scene composition:

1. **Every composition uses transitions.** No exceptions. Scenes without transitions feel like jump cuts.
2. **Every scene uses entrance animations.** Elements animate IN: opacity, position, scale, etc. No scene should pop fully-formed onto screen. Anime.js has no `.from()` shorthand, so state entrance ranges explicitly in `.add()`: `opacity: [0, 1]`, `translateY: [40, 0]`. Do not rely on current computed CSS as an implicit endpoint.
3. **Exit animations are BANNED** except on the final scene. Do NOT use `tl.add()` to animate elements out before a transition fires. The transition IS the exit. Outgoing scene content must be fully visible when the transition starts, the transition handles the visual handoff.
4. **Final scene exception:** The last scene MAY fade elements out (e.g., fade to black at the end of the composition). This is the only scene where exit animations are allowed.

```js
// BANNED: fading the outgoing scene out, then the next scene just runs its entrance.
//    This is a jump cut with a dip, not a transition.
tl.add("#s1", { opacity: 0, duration: 400 }, 4000);
tl.add("#s2 .headline", { translateY: [40, 0], opacity: [0, 1], duration: 500 }, 4400);

// CORRECT: outgoing and incoming animate AT THE SAME TIME T; the motion IS the handoff.
const T = 4000;
tl.add("#s1", { translateY: "-100%", filter: "blur(8px)", duration: 500, ease: "inQuart" }, T);
tl.add("#s2", { translateY: ["100%", "0%"], duration: 500, ease: "outQuart" }, T);
```

> **You are NOT done after this file.** This overview gives you _which_ transition and _when_. Before writing any transition you MUST open **`catalog.md`** in this directory for the anime.js code and the hard rule every transition follows: _position new scene, animate outgoing, swap, animate incoming, clean up overlays_. Also open the per-category `css-*.md` files for specifics. Authoring transitions from this overview alone is how you end up shipping the banned pattern above.

## Energy → Primary Transition

| Energy                                   | CSS Primary                  | Shader Primary                       | Accent                         | Duration  | Easing                     |
| ---------------------------------------- | ---------------------------- | ------------------------------------ | ------------------------------ | --------- | -------------------------- |
| **Calm** (wellness, brand story, luxury) | Blur crossfade, focus pull   | Cross-warp morph, thermal distortion | Light leak, circle iris        | 0.5-0.8s  | `inOutSine`, `inOutQuad`   |
| **Medium** (corporate, SaaS, explainer)  | Push slide, staggered blocks | Whip pan, cinematic zoom             | Squeeze, vertical push         | 0.3-0.5s  | `inOutCubic`, `inOutQuart` |
| **High** (promos, sports, music, launch) | Zoom through, overexposure   | Ridged burn, glitch, chromatic split | Staggered blocks, gravity drop | 0.15-0.3s | `inOutQuint`, `outExpo`    |

Pick ONE primary (60-70% of scene changes) + 1-2 accents. Never use a different transition for every scene.

## Mood → Transition Type

Think about what the transition _communicates_, not just what it looks like.

| Mood                     | Transitions                                                                                                                          | Why it works                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Warm / inviting**      | Light leak, blur crossfade, focus pull, film burn · **Shader:** thermal distortion, light leak, cross-warp morph                     | Soft edges, warm color washes. Nothing sharp or mechanical.                                 |
| **Cold / clinical**      | Squeeze, zoom out, blinds, shutter, grid dissolve · **Shader:** gravitational lens                                                   | Content transforms mechanically: compressed, shrunk, sliced, gridded.                       |
| **Editorial / magazine** | Push slide, vertical push, diagonal split, shutter · **Shader:** whip pan                                                            | Like turning a page or slicing a layout. Clean directional movement.                        |
| **Tech / futuristic**    | Grid dissolve, staggered blocks, blinds, chromatic aberration · **Shader:** glitch, chromatic split                                  | Grid dissolve is the core "data" transition. Shader glitch adds posterization + scan lines. |
| **Tense / edgy**         | Glitch, VHS, chromatic aberration, ripple · **Shader:** ridged burn, glitch, domain warp                                             | Instability, distortion, digital breakdown. Ridged burn adds sharp lightning-crack edges.   |
| **Playful / fun**        | Elastic push, 3D flip, circle iris, morph circle, clock wipe · **Shader:** ripple waves, swirl vortex                                | Overshoot, bounce, rotation, expansion. Swirl vortex adds organic spiral distortion.        |
| **Dramatic / cinematic** | Zoom through, zoom out, gravity drop, overexposure, color dip to black · **Shader:** cinematic zoom, gravitational lens, domain warp | Scale, weight, light extremes. Shader transitions add per-pixel depth.                      |
| **Premium / luxury**     | Focus pull, blur crossfade, color dip to black · **Shader:** cross-warp morph, thermal distortion                                    | Restraint. Cross-warp morph flows both scenes into each other organically.                  |
| **Retro / analog**       | Film burn, light leak, VHS, clock wipe · **Shader:** light leak                                                                      | Organic imperfection. Warm color bleeds, scan line displacement.                            |

## Narrative Position

| Position                   | Use                                                                        | Why                                                  |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Opening**                | Your most distinctive transition. Match the mood. 0.4-0.6s                 | Sets the visual language for the entire piece.       |
| **Between related points** | Your primary transition. Consistent. 0.3s                                  | Don't distract: the content is continuing.           |
| **Topic change**           | Something different from your primary. Staggered blocks, shutter, squeeze. | Signals "new section": the viewer's brain resets.    |
| **Climax / hero reveal**   | Your boldest accent. Fastest or most dramatic.                             | This is the payoff: spend your best transition here. |
| **Wind-down**              | Return to gentle. Blur crossfade, crossfade. 0.5-0.7s                      | Let the viewer exhale after the climax.              |
| **Outro**                  | Slowest, simplest. Crossfade, color dip to black. 0.6-1.0s                 | Closure. Don't introduce new energy at the end.      |

## Blur Intensity by Energy

| Energy     | Blur    | Duration | Hold at peak |
| ---------- | ------- | -------- | ------------ |
| **Calm**   | 20-30px | 0.8-1.2s | 0.3-0.5s     |
| **Medium** | 8-15px  | 0.4-0.6s | 0.1-0.2s     |
| **High**   | 3-6px   | 0.2-0.3s | 0s           |

## Presets

| Preset     | Duration | Easing                  |
| ---------- | -------- | ----------------------- |
| `snappy`   | 0.2s     | `inOutQuint`            |
| `smooth`   | 0.4s     | `inOutCubic`            |
| `gentle`   | 0.6s     | `inOutSine`             |
| `dramatic` | 0.5s     | `inQuart` to `outQuart` |
| `instant`  | 0.15s    | `inOutExpo`             |
| `luxe`     | 0.7s     | `inOutQuad`             |

## Implementation

Read `catalog.md` in this directory for anime.js code and hard rules for every transition type, and the `css-*.md` files for per-category implementation details.

| Category    | CSS                                                            | Shader (WebGL)                                                            |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Push/slide  | Push slide, vertical push, elastic push, squeeze               | Whip pan                                                                  |
| Scale/zoom  | Zoom through, zoom out, gravity drop, 3D flip                  | Cinematic zoom, gravitational lens                                        |
| Reveal/mask | Circle iris, diamond iris, diagonal split, clock wipe, shutter | SDF iris                                                                  |
| Dissolve    | Crossfade, blur crossfade, focus pull, color dip               | Cross-warp morph, domain warp                                             |
| Cover       | Staggered blocks, horizontal blinds, vertical blinds           | :                                                                         |
| Light       | Light leak, overexposure burn, film burn                       | Light leak (shader), thermal distortion                                   |
| Distortion  | Glitch, chromatic aberration, ripple, VHS tape                 | Glitch (shader), chromatic split, ridged burn, ripple waves, swirl vortex |
| Pattern     | Grid dissolve, morph circle                                    | :                                                                         |

## Transitions That Don't Work in CSS

Avoid: star iris, tilt-shift, lens flare, hinge/door. See catalog.md for why.

## CSS vs Shader

CSS transitions animate scene containers with opacity, transforms, clip-path, and filters. Shader transitions composite both scene textures per-pixel on a WebGL canvas, they can warp, dissolve, and morph in ways CSS cannot.

**Both are first-class options.** Shaders are provided by the `@hyperframes/shader-transitions` package, import from the package instead of writing raw GLSL. CSS transitions are simpler to set up. Choose based on the effect you want, not based on which is easier.

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

Avoid transitions that create visible repeating geometric patterns: grids of tiles, hexagonal cells, uniform dot arrays, evenly-spaced blob circles. These look cheap and artificial regardless of the math behind them. Organic noise (FBM, domain warping) is good because it's irregular. Geometric repetition is bad because the eye instantly sees the grid.
