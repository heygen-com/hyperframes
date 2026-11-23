# filmed-screen

Your scene, filmed off a screen. The live DOM is captured through HTML-in-Canvas every frame and
shaded by one WebGL pass: a gently curved screen tilted in perspective, depth of field that follows
an element you name, chromatic fringing, LED sub-pixels, a vignette, a per-shot colour grade, bloom
and grain. Shots glide or orbit into each other and focus racks smoothly between elements, fast
enough to follow text as it is typed. The element in focus stays sharp: inside its box the pass
turns off blur and LED-cell snapping, keeps only a trace of fringing, and fades back in over
~160 px around it.

Ported from the virtual-camera pass in [ff-tracking](https://github.com/mrsarac/ff-tracking)
(`lens.sksl`), with one change to its maths: each colour channel is weighted by its own sample in
the bokeh average, where the original weighted all three by the green one and tinted blurred
texture green.

## Mounting

Paste `filmed-screen.html` into the composition that owns the scene and put the scene inside
`.hf-filmed-screen-scene`:

```html
<canvas
  class="hf-filmed-screen"
  layoutsubtree
  width="1920"
  height="1080"
  style="position:absolute;left:0;top:0;width:1920px;height:1080px"
>
  <div
    class="hf-filmed-screen-scene"
    style="position:absolute;left:0;top:0;width:1920px;height:1080px"
  >
    ...scene...
  </div>
</canvas>
```

Then edit the `HFFilmedScreen.mount()` call at the bottom of the snippet. It works at the root and
inside a `data-composition-src` sub-composition; shot times are read from the owning composition's
timeline.

## Shots

```js
HFFilmedScreen.mount({
  canvas: document.querySelectorAll(".hf-filmed-screen"),
  shots: [
    {
      until: 3,
      palette: ["#08060a", "#2a1405", "#8a4a10", "#ffb340", "#fff1d6"],
      tilt: [0.16, -0.22, 0.03],
      zoom: [1.0, 1.2],
      blur: 1.0,
      focus: (t) => document.getElementById(t < 1.4 ? "title" : "sub"),
    },
    {
      until: 6,
      palette: null,
      focus: (t, local) => document.querySelectorAll(".tile")[Math.min(2, local | 0)],
    },
  ],
});
```

| field      | default            | notes                                                                                              |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| until      | —                  | End of the shot, in seconds of the owning composition; the next shot starts here.                  |
| palette    | null               | Five hex colours, dark → light. `null` keeps true colour.                                          |
| invert     | false              | Flips brightness and keeps hue, so light pages read as dark screens.                               |
| tilt       | [0.1, -0.15, 0.02] | Screen plane rotation `[x, y, roll]` in radians.                                                   |
| tiltTo     | tilt               | Rotation to end the shot on; the tilt eases between the two, for an orbit.                         |
| zoom       | [1.1, 1.3]         | Eased across the shot.                                                                             |
| blur       | 0.45               | Depth-of-field strength; ~1 reads as a shallow phone camera.                                       |
| center     | canvas centre      | Where the camera points when nothing is in focus.                                                  |
| focus      | —                  | `(t, local) → Element \| {x,y,w,h} \| array`; the last entry is the focus.                         |
| transition | "glide"            | `"glide"` eases camera, grade and colour mode in from the previous shot; `"cut"` cuts with a tear. |
| glide      | 1.2                | Seconds a glide takes.                                                                             |

## Mount options

| option     | default | notes                                                                   |
| ---------- | ------- | ----------------------------------------------------------------------- |
| canvas     | —       | Element, list or selector. The first canvas not already filmed is used. |
| shots      | —       | The shot list above.                                                    |
| rack       | 0.3     | Seconds a focus change takes to settle.                                 |
| vignette   | 1.0     | Edge darkening; 0 turns it off.                                         |
| aberration | 2.2     | Chromatic fringing, as a multiple of the base amount.                   |
| led        | 0.45    | Strength of the LED sub-pixel grid.                                     |
| curve      | 0.15    | Screen curvature; 0 is flat. The frame's corners stay in place.         |
| fadeOut    | true    | Fades to black over the last 0.4 s of the owning composition.           |
| zIndex     | 10      | z-index of the lens output canvas.                                      |

**Previous look.** Before these defaults the lens used `blur: 0.9`, `rack: 0.7`, `vignette: 0.42`,
`aberration: 1`, `led: 0.9` and `curve: 0`; pass those to get close to it. Two changes have no
option and can't be restored: the LED grid now fades in only once a cell spans about 4 output
pixels, and a quarter of the fringing stays on the focused element.

`curve` is clamped at 0, and the vignette never darkens past black, so very large values are safe.

Pass `document.querySelectorAll(...)` from your own snippet rather than a selector string. The
library initialises once per page, so its own `document` belongs to whichever copy loaded first;
your query is scoped to your composition, which is what keeps two instances (or the same
sub-composition mounted twice) on their own canvases.

Focus is a weighted average, over the last `rack` seconds, of where each shot's target sits in the
DOM now, so it eases on an S-curve and any seek order renders the same frame.

`mount()` returns `{ destroy() }`, which drops the lens, frees its GL context and removes its output
canvas. A lens whose canvas leaves the page is dropped on the next frame anyway.

The lens shares the engine's composite hooks with other owners such as `data-vfx-chain`: each
wrapper keeps its own prior and a re-entered one returns at once, so the chain stays a constant
depth however both re-arm. `filmed-screen.test.mjs` runs that against core's arming pattern.

A `<canvas>` without `layoutsubtree` (p5, three.js, a 2D canvas) is sampled directly instead; give
`focus` rectangles in its pixel space.

## Requirements and costs

- **HTML-in-Canvas** (`drawElementImage`) and **WebGL2**, which the HyperFrames renderer's Chrome
  has. Without either, the snippet moves the scene back into the page and renders it unfilmed, with
  one console warning.
- **Keep the `<canvas layoutsubtree>` in the HTML.** The renderer picks screenshot capture for
  compositions that declare one. Created from script, it is never seen, the frame handshake is
  skipped and frames come out blank.
- **`.hf-filmed-screen-scene` needs a pixel size.** `inset: 0` inside a layoutsubtree canvas
  measures 0×0 and captures nothing.
- **Renders use screenshot capture on one worker**, so they are slower than drawElement capture.
- The scene is stamped with `data-layout-allow-occlusion` at mount, because `check` otherwise reports
  every filmed line of text as hidden under the output canvas. Elements added after mount are not
  stamped.
