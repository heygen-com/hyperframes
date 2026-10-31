# Animation runtimes

HyperFrames seeks each frame on its own, so motion must be a function of time, never of the previous frame. Full GSAP reference: `npx hyperframes docs gsap`.

## GSAP facts that bite

- Register the timeline last. Building inside `document.fonts.ready.then(…)` or another async callback is fine if you register at the end of it; registering first renders blank (`gsap_timeline_registered_before_async_build`).
- Place tweens at absolute seconds (`tl.to(el, {…}, 2.4)`). Set start states in the tween (`fromTo`), not in CSS.
- Measure layout once before building tweens, never inside `onUpdate`.
- Finite repeats only: `repeat: Math.max(0, Math.floor(duration / cycle) - 1)`.
- Seed randomness with a small PRNG (mulberry32).
- A scene's timeline can't reach elements outside its file, and two timelines must not animate the same property of one element.
- Transforms on a `<span>` need `display: inline-block` or `block`.
- Text that must fit a width: `window.__hyperframes.fitTextFontSize(text, { fontFamily, fontWeight, maxWidth })` returns `{ fontSize }`; `window.__hyperframes.pretext` measures text without a reflow.

## Other runtimes

| Runtime                      | Use for                           | How HyperFrames drives it                                                                        |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| CSS `@keyframes`             | Simple loops and decoration       | Found automatically; finite iterations, `animation-fill-mode: both`, `data-start` on the element |
| WAAPI                        | Native keyframes                  | `element.animate(…, { fill: "both" })` then `pause()`; times are document time, so use `delay`   |
| Lottie / dotLottie           | After Effects exports, characters | `autoplay: false`, always set `loop`, push the instance to `window.__hfLottie`                   |
| anime.js v4                  | Existing anime code               | `autoplay: false`, push to `window.__hfAnime`, `anime.createSeededRandom`                        |
| Three.js, WebGPU, p5, canvas | 3D and generative                 | Draw from `e.detail.time` in an `hf-seek` listener; set `data-duration` on the root              |

Charts and map overlays: drive them from a GSAP tween's `onUpdate`, not the library's own transitions. A real place is shown on baked imagery, not drawn (`film.md` "Maps and real places"). Heavy setup (big meshes, shader compiles) registers a `window.__hf.buildReady["<key>"]` promise.

## dotLottie browser setup

Copy `dist/index.js` and `dist/dotlottie-player.wasm` from the same pinned
`@lottiefiles/dotlottie-web` release (for example, 0.81.0) into the project's
`lib/dotlottie-web/` directory. Its CommonJS entry cannot run as a classic
browser script. Import the ESM entry and set the local WASM URL before creating
the player, so rendering loads the SDK, WASM and animation from project files.

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

## The seek protocol

```html
<script>
  function renderAt(t) {
    /* draw the frame for t seconds from state derived from t alone */
  }
  window.addEventListener("hf-seek", (e) => {
    renderAt(e.detail.time);
    // async work (GPU submit, image decode): e.detail.waitUntil(promise), called synchronously
  });
  renderAt(0);
</script>
```

No `requestAnimationFrame` loop or timer as the clock.
