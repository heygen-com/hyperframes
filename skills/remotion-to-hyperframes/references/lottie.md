# Lottie translation: @remotion/lottie → HF lottie adapter

Lottie animations are a clean translation case — HF has a built-in
[Lottie adapter](https://github.com/heygen-com/hyperframes/blob/main/packages/core/src/runtime/adapters/lottie.ts)
that supports both `lottie-web` and `@lottiefiles/dotlottie-web`. The
adapter auto-discovers animations registered on `window.__hfLottie`
and seeks lottie-web via `goToAndStop` and current dotLottie players via `setFrame`.

## Pattern

```tsx
import { Lottie } from "@remotion/lottie";
import animationData from "./hello.json";

export const MyComp = () => (
  <AbsoluteFill>
    <Lottie animationData={animationData} loop={false} />
  </AbsoluteFill>
);
```

Translates to:

```html
<div id="stage" ...>
  <div id="lottie-anim" style="width:100%;height:100%"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
  <script>
    const anim = lottie.loadAnimation({
      container: document.getElementById("lottie-anim"),
      renderer: "svg",
      loop: false,
      autoplay: false,
      path: "assets/hello.json",
    });
    window.__hfLottie = window.__hfLottie || [];
    window.__hfLottie.push(anim);
  </script>
</div>
```

Key differences from a typical Lottie embed:

- `autoplay: false` — HF drives playback by seeking
- `loop: false` typically (unless Remotion's `loop={true}`)
- `window.__hfLottie.push(anim)` is what hooks the animation into HF's
  per-frame seek

## Asset handling

Remotion bundles the animation JSON via webpack import. HF needs the JSON
on disk under `assets/` and references it via path:

1. Copy the animation JSON from the Remotion project into the HyperFrames project’s assets folder.
2. Pass that local path to `loadAnimation`, as shown in the example above.

For dotlottie (binary) format, use the ESM build of `@lottiefiles/dotlottie-web`.
Before rendering, copy `dist/index.js` and `dist/dotlottie-player.wasm` from the
same pinned release into `hf-src/lib/dotlottie-web/`. Version 0.81.0 provides:

- https://unpkg.com/@lottiefiles/dotlottie-web@0.81.0/dist/index.js
- https://unpkg.com/@lottiefiles/dotlottie-web@0.81.0/dist/dotlottie-player.wasm

The package's CommonJS entry cannot run as a classic browser script. Set the
local WASM URL before constructing the player; the render then loads the SDK,
WASM and animation from project files.

```html
<canvas id="anim" style="width:100%;height:100%"></canvas>
<script type="module">
  import { DotLottie } from "./lib/dotlottie-web/index.js";

  DotLottie.setWasmUrl(new URL("./lib/dotlottie-web/dotlottie-player.wasm", import.meta.url).href);
  const player = new DotLottie({
    canvas: document.getElementById("anim"),
    src: "assets/hello.lottie",
    autoplay: false,
    loop: false,
    renderConfig: { autoResize: false, freezeOnOffscreen: false },
  });
  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(player);
</script>
```

The HF adapter supports `goToAndStop` for lottie-web, `setFrame` for current
dotLottie players, and `setCurrentRawFrameValue` / `seek` for older player shapes.

## Multiple Lottie animations

Multiple `<Lottie>` instances in one composition work — push each one
onto `window.__hfLottie` and the adapter will seek all of them in sync:

```js
window.__hfLottie.push(anim1);
window.__hfLottie.push(anim2);
window.__hfLottie.push(anim3);
```

## Lottie source isn't actually translation-blocking

Lottie animations encode their own deterministic timeline. They're the
_easiest_ part of a Remotion composition to translate because the
animation logic is already self-contained — neither Remotion nor HF
"animate" them, both just seek them. Translation cost is near-zero.

## After Effects → Lottie limitations

Lottie supports a subset of After Effects features. Expressions, most
Effects (drop shadow, color overlay), all blend modes beyond Normal/Add/
Multiply, luma mattes, and most 3D parameters are not supported. If the
Remotion composition uses a Lottie file that depends on these, the
animation will break in BOTH Remotion and HF — this isn't a translation
problem, it's a Lottie limitation. See
[airbnb/lottie/after-effects.md](https://github.com/airbnb/lottie/blob/master/after-effects.md)
for the full supported feature list.

## Loop behavior

Remotion's `loop={true}` plays the animation continuously. Translate it
to `loop: true` on the player: the HF adapter wraps composition time into
the animation's own length, so the cycle repeats for the whole scene. It
does not add playback-rate scaling; bake a non-default rate into the
Lottie asset and verify the rendered output.

## Performance note

Per the [Lottie adapter](https://github.com/heygen-com/hyperframes/blob/main/packages/core/src/runtime/adapters/lottie.ts)
docs: lottie-web's `goToAndStop(time, isFrame=false)` takes time in ms;
the adapter passes `time * 1000` for precision. This is more accurate
than passing frame numbers (especially for animations whose internal
fps doesn't match the HF render fps).
