# Transition Catalog

Hard rules, scene template, and routing to implementation code. Read the reference file for the transition type you need - don't load all of them.

## Contents

- Hard rules for CSS transitions
- Shader transitions
- Scene template
- CSS transition examples
- Shader transition routing

## Hard Rules (CSS)

These cause real bugs if violated.

**Scene visibility:** Scene 1 visible by default (no `opacity: 0`). Scenes 2+ have `opacity: 0` on the CONTAINER div. Anime.js reveals them. No visibility shim (`timedEls`).

**Fonts:** Just write the `font-family` you want - the compiler embeds supported fonts automatically via `@font-face` with inline data URIs. No need for `<link>` tags or `@import`. Works in all contexts including sandboxed iframes.

**Element structure:** No `class="clip"` on scene divs in standalone compositions. Only the root div gets `data-composition-id`/`data-start`/`data-duration`.

**Overlay elements:** Staggered blocks = full-screen 1920x1080, NOT thin strips. Glitch RGB overlays = normal blending at 35% opacity, NOT `mix-blend-mode: multiply` (invisible on dark backgrounds). Light leak overlays = larger than the frame (2400px+), never a visible shape. Overexposure = use `filter: brightness()` on the scene, not just a white overlay.

**VHS tape:** Clone actual scene content with `cloneNode(true)`, NOT colored bars. Each strip: wider than frame (2020px at left:-50px). Red+blue chromatic copies at z-index above main strip. Seeded PRNG for deterministic random offsets.

**Z-index:** Gravity drop, zoom out, diagonal split need outgoing scene ON TOP (`zIndex: 10`) so it exits while revealing the new scene behind (`zIndex: 1`).

**Page burn:** Content burns with the page, no falling debris. Hide scene1 via zero-duration `tl.add` at burn end, NEVER `onComplete` (not reversible). `onUpdate` must restore `clipPath: "none"` when `wp <= 0` for rewind support. Incoming scene fades from black at 90% through burn.

**Clock wipe:** 9-point polygon with intermediate edge positions. Step through 4 quadrants with separate tweens.

**Grid dissolve:** Cycle 5 palette colors per cell, not monochrome.

**Blinds count by energy:** Calm: 4h/6v. Medium: 6-8h/8v. High: 12-16h/16v.

**Don't use:** Star iris (polygon interpolation broken), tilt-shift (no selective CSS blur), lens flare (visible shape, not optical), hinge/door (distorts too fast).

## Shader Transitions

Shader setup, WebGL init, capture, and fragment shaders are handled by `@hyperframes/shader-transitions` (`packages/shader-transitions/`). Read the package source for API details. Compositions using shaders must follow the shader-compatible CSS rules in `overview.md` (this directory).

## Scene Template

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
    <style>
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #000;
        font-family: "YOUR FONT", sans-serif; /* compiler embeds supported fonts automatically */
      }
      .scene {
        position: absolute;
        top: 0;
        left: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      #scene1 {
        z-index: 1;
        background: #color;
      }
      #scene2 {
        z-index: 2;
        background: #color;
        opacity: 0;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="TOTAL"
    >
      <div id="scene1" class="scene"><!-- visible --></div>
      <div id="scene2" class="scene"><!-- hidden --></div>
    </div>
    <script>
      var tl = anime.createTimeline({ autoplay: false });
      // Transition code here
      hyperframesAnime.register("main", tl);
    </script>
  </body>
</html>
```

Every transition follows: position new scene → animate outgoing → swap → animate incoming → clean up overlays.

## CSS Transitions

All code examples use `old` for the outgoing scene-inner selector and `new` for the incoming, with `T` as the transition start time in milliseconds. Read the reference file for the type you need.

| Type           | Transitions                                          | Reference                        |
| -------------- | ---------------------------------------------------- | -------------------------------- |
| Push           | Push slide, vertical push, elastic push, squeeze     | `transitions/css-push.md`        |
| Radial / Shape | Circle iris, diamond iris, diagonal split            | `transitions/css-radial.md`      |
| 3D             | 3D card flip                                         | `transitions/css-3d.md`          |
| Scale / Zoom   | Zoom through, zoom out                               | `transitions/css-scale.md`       |
| Dissolve       | Crossfade, blur crossfade, focus pull, color dip     | `transitions/css-dissolve.md`    |
| Cover          | Staggered blocks, horizontal blinds, vertical blinds | `transitions/css-cover.md`       |
| Light          | Light leak, overexposure burn, film burn             | `transitions/css-light.md`       |
| Distortion     | Glitch, chromatic aberration, ripple, VHS tape       | `transitions/css-distortion.md`  |
| Mechanical     | Shutter, clock wipe                                  | `transitions/css-mechanical.md`  |
| Grid           | Grid dissolve                                        | `transitions/css-grid.md`        |
| Other          | Gravity drop, morph circle                           | `transitions/css-other.md`       |
| Blur           | Blur through, directional blur                       | `transitions/css-blur.md`        |
| Destruction    | Page burn                                            | `transitions/css-destruction.md` |

## Shader Transitions

WebGL shader transitions are provided by `@hyperframes/shader-transitions` (`packages/shader-transitions/`). The package handles setup, capture, WebGL init, render loop, and its own internal GSAP integration by design. Surrounding scene tweens in the same composition can still be authored with anime.js. Read the package source for available shaders and API, do not copy raw GLSL manually.

The built-ins are not a ceiling. For an effect no built-in covers, you can write custom GLSL from scratch, adapt shader code found online (ShaderToy, GLSL Sandbox, GitHub), or build a custom CSS transition that fits no existing category - combine clip-path, transforms, and filters in new ways. If the storyboard calls for an effect that doesn't exist yet, build it; the framework renders anything a browser can run.
