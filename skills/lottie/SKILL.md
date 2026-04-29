---
name: lottie
description: Lottie and dotLottie adapter patterns for HyperFrames. Use when embedding lottie-web JSON animations, .lottie files, @lottiefiles/dotlottie-web players, registering instances on window.__hfLottie, or making After Effects exports deterministic in HyperFrames.
---

# Lottie for HyperFrames

HyperFrames can seek both `lottie-web` and dotLottie players through its `lottie` runtime adapter. Lottie is a strong fit because the animation timeline is already encoded in the asset; HyperFrames only needs a player object it can seek.

## Contract

- Load assets from local project files, usually under `assets/`.
- Set `autoplay: false`.
- Prefer `loop: false` unless the user explicitly wants a loop.
- Register every returned animation or player on `window.__hfLottie`.
- Keep the Lottie container dimensions stable with CSS.

The adapter seeks `lottie-web` with `goToAndStop(timeMs, false)` and dotLottie with frame or percentage APIs depending on player shape.

## lottie-web Pattern

```html
<div id="logo-lottie" class="lottie-layer"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
<script>
  const anim = lottie.loadAnimation({
    container: document.getElementById("logo-lottie"),
    renderer: "svg",
    loop: false,
    autoplay: false,
    path: "assets/logo-reveal.json",
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(anim);
</script>
```

```css
.lottie-layer {
  width: 100%;
  height: 100%;
}
```

## dotLottie Pattern

```html
<canvas id="product-lottie" class="lottie-canvas"></canvas>
<script src="https://unpkg.com/@lottiefiles/dotlottie-web"></script>
<script>
  const player = new DotLottie({
    canvas: document.getElementById("product-lottie"),
    src: "assets/product-flow.lottie",
    autoplay: false,
    loop: false,
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(player);
</script>
```

```css
.lottie-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
```

## Multiple Animations

Push each player into the same registry:

```js
window.__hfLottie = window.__hfLottie || [];
window.__hfLottie.push(backgroundAnim);
window.__hfLottie.push(iconAnim);
window.__hfLottie.push(confettiAnim);
```

HyperFrames seeks them all to the same composition time.

## Good Uses

- After Effects exports that are already known to render correctly in lottie-web.
- Logo reveals, icon loops, decorative accents, and product UI motion.
- Translating Remotion Lottie usage into plain HyperFrames HTML.

## Avoid

- Relying on remote `path` URLs at render time.
- Starting playback with `play()`.
- Assuming unsupported After Effects effects will survive export. Test the JSON or `.lottie` file in a browser first.
- Loading a player asynchronously and registering it after HyperFrames validation has already inspected the page.

## Validation

After editing a Lottie composition:

```bash
npx hyperframes lint
npx hyperframes validate
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/lottie.ts`.
- lottie-web by Airbnb: https://github.com/airbnb/lottie-web
- lottie-web `loadAnimation` options: https://github.com/airbnb/lottie-web/wiki/loadAnimation-options
- dotLottie web player methods by LottieFiles: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/methods
