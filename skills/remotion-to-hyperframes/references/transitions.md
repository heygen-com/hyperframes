# Transitions translation: @remotion/transitions → HF crossfades / shader-transitions

The `@remotion/transitions` package is Remotion's library of pre-built
scene-to-scene transitions. HF has two paths to translate them:

1. **Manual anime.js crossfade** - for simple opacity/transform transitions. Free, no extra package.
2. **HF shader-transitions package** - for visually-rich transitions that match the @remotion/transitions presets.

## Pattern: `<TransitionSeries>` is `<Series>` with overlap

```tsx
<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

Translates to scenes that overlap by the transition duration:

- SceneA: [0, 60] = `data-start="0" data-duration="2"`
- SceneB: [60-15, 60-15+60] = `data-start="1.5" data-duration="2"` (the transition window overlaps the end of A and start of B)

Then drive the transition with anime.js:

```js
// Manual fade (presentation={fade()})
tl.add(sceneA, { opacity: 0, duration: 500, ease: "linear" }, 1500);
tl.add(sceneB, { opacity: [0, 1], duration: 500, ease: "linear" }, 1500);
```

## Presentation table

| Remotion `presentation`            | HF translation                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `fade()`                           | manual `tl.add(opacity)` crossfade                                                |
| `slide({direction: "from-right"})` | `tl.add(translateX: ["100%", 0])` on incoming + `translateX: "-100%"` on outgoing |
| `wipe({direction: "from-left"})`   | `tl.add(clipPath: ["inset(0 100% 0 0)", "inset(0 0 0 0)"])` on incoming           |
| `clockWipe()`                      | use HF's `sdf-iris` shader-transition (`npx hyperframes add sdf-iris`)            |
| `flip()`                           | `tl.add(rotateY)` 180° split between scenes                                       |
| `cube()`                           | use HF's `cinematic-zoom` or build manually with `rotateY` + `transform-origin`   |
| `iris()`                           | use HF's `sdf-iris` shader-transition                                             |
| `none()`                           | no transition; hard cut at the boundary                                           |

## Timing translations

```tsx
linearTiming({durationInFrames: 15})              → ease: "linear"
linearTiming({durationInFrames: 15, easing: ...}) → ease per the easing table in timing.md
springTiming({config: {damping: 12}})             → ease: "outBack(1.4)" (~700 ms)
```

Convert `durationInFrames` to seconds (`/fps`).

## When to use HF shader-transitions

For transitions Remotion presets that have visually-rich GLSL equivalents
(iris, ripple, zoom, glitch), use HF's [shader-transitions](https://hyperframes.heygen.com/catalog/blocks)
package. They produce richer output than manual transform tweens.

```bash
npx hyperframes add sdf-iris
```

Then in the composition:

```html
<div id="iris-transition" class="hf-shader-transition" data-start="1.5" data-duration="0.5">
  <!-- bound scenes via the shader-transition's data-from / data-to -->
</div>
```

Each shader-transition has its own data attributes; see the catalog page
for the specific block.

## When the source uses a custom Presentation

Remotion supports custom `presentation` implementations:

```tsx
const customPresentation: PresentationComponent = ({
  children,
  presentationProgress,
  presentationDirection,
}) => {
  return (
    <div
      style={
        {
          /* compute transform from progress */
        }
      }
    >
      {children}
    </div>
  );
};
```

Translation: extract the math from the `style={...}` block and emit
equivalent anime.js tweens. Specifically the transform formula maps directly
to a `tl.add(target, { transform: ... })` parameterized by `progress`.

If the custom presentation uses `useCurrentFrame()` internally to
animate something _outside_ the simple progress curve, treat the source
as untranslatable and bow out to the runtime interop pattern (see
[escape-hatch.md](escape-hatch.md)).
