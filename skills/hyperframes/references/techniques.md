# Visual Techniques Reference

13 primitive animation techniques from production HyperFrames videos — SVG drawing, kinetic typography, variable fonts, WebGL shaders, motion-path, etc. Compose these into beats; they are the building blocks, not finished recipes. Each entry includes a minimal code pattern you can adapt.

These are NOT advanced — they're standard motion design patterns that every composition should use at least 2-3 of. For pre-built UI templates (terminal chrome, device mockups, moodboard layouts), look in the `registry/blocks/` directory instead — those are recipes, not techniques.

**These are starting points, not copy-paste templates.** Every code pattern below is a minimal working example from a real production video. Adapt them to your needs — change colors, sizes, timings, easings, element counts, layout. Combine techniques, mix parts from different patterns, invent variations. The goal is to understand the PRINCIPLE behind each technique so you can build something original, not to reproduce these examples exactly.

## Table of Contents

**Named text animation effects** (per-character, per-word, per-line, whole-element) with exact GSAP specs are in [`text-effects.md`](text-effects.md) — 24 bundled effects, no install needed. Use those for all headline and label animations instead of inventing timing from scratch.

**HTML-in-Canvas patterns** (live DOM as GPU texture: iPhone/MacBook mockups, liquid glass, magnetic, portal, shatter, text cursor — using `drawElementImage` + `layoutsubtree`) are in [`html-in-canvas-patterns.md`](html-in-canvas-patterns.md) — 504 lines, one shared boilerplate + ~6 effect recipes. Use for 1–3 hero beats per video, not every beat.

---

| #   | Technique                           | What it does                                                               | Best for                                         |
| --- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | **SVG Path Drawing**                | Logos/icons draw themselves stroke by stroke                               | Logo reveals, diagram builds, connector lines    |
| 2   | **Canvas 2D Procedural Art**        | Animated noise, particles, data viz — frame-by-frame via GSAP proxy        | Generative backgrounds, ambient texture          |
| 3   | **CSS 3D Transforms**               | Card flips, perspective grids, folding panels                              | Product reveals, comparison scenes               |
| 4   | **Per-Word Kinetic Typography**     | Text animates word-by-word with stagger timing                             | Thesis statements, key messages, quotes          |
| 5   | **Lottie Animation**                | Captured or external Lottie plays as overlay/background                    | Brand animations, micro-interactions             |
| 6   | **Video Compositing**               | Product videos play inline, masked, overlaid                               | Demo footage, screen recordings                  |
| 7   | **Character-by-Character Typing**   | Terminal-style code reveals, search bar interactions                       | Developer tools, CLI demos                       |
| 8   | **Variable Font Axis Animation**    | Weight, width, slant, optical size morph over time                         | Premium typography, brand wordmarks              |
| 9   | **GSAP MotionPathPlugin**           | Elements follow SVG curves, orbital motion, spirals                        | Dynamic entrances, connector animations          |
| 10  | **Velocity-Matched Transitions**    | Outgoing blur/translate matches incoming for seamless cuts                 | Beat transitions, scene changes                  |
| 11  | **Audio-Reactive Animation**        | Elements pulse to narration frequency bands                                | Background textures, text glow, ambient motion   |
| 12  | **Clip-Path Reveal Masks**          | Fixed window that content slides through (text/images enter from one side) | Headline intros, image reveals, wipe effects     |
| 13  | **WebGL Fragment Shader Art**       | Full GPU generative backgrounds — FBM domain warp, cosine palettes         | Hero backgrounds, atmospheric scenes             |

---

## 1. SVG Path Drawing

A path draws itself in real-time, like someone tracing with a pen. Use for revealing diagrams, arrows, connector lines, or brand marks.

```html
<svg viewBox="0 0 400 200">
  <path
    class="draw-path"
    d="M 50 100 L 200 50 L 350 100"
    stroke="#c84f1c"
    stroke-width="4"
    fill="none"
    stroke-linecap="round"
  />
</svg>
<style>
  .draw-path {
    stroke-dasharray: 280;
    stroke-dashoffset: 280;
  }
</style>
<script>
  tl.to(".draw-path", { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, 0.5);
</script>
```

Use `path.getTotalLength()` to calculate the dasharray value dynamically.

---

## 2. Canvas 2D Procedural Art

Animated noise, particle fields, data visualizations — anything that evolves frame-by-frame. Drive it with a GSAP proxy.

```html
<canvas id="proc-canvas" width="1920" height="1080"></canvas>
<script>
  var canvas = document.getElementById("proc-canvas");
  var ctx = canvas.getContext("2d");

  function hash(x, y) {
    var n = x * 374761393 + y * 668265263;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) & 0x7fffffff) / 0x7fffffff;
  }

  function drawFrame(t) {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, 1920, 1080);
    for (var i = 0; i < 200; i++) {
      var x = hash(i, 0) * 1920;
      var y = hash(i, 1) * 1080;
      var brightness = hash(i, Math.floor(t * 10)) * 255;
      ctx.fillStyle = "rgba(255, 255, 255, " + brightness / 255 + ")";
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var proxy = { time: 0 };
  tl.to(
    proxy,
    {
      time: 5,
      duration: 5,
      ease: "none",
      onUpdate: function () {
        drawFrame(proxy.time);
      },
    },
    0,
  );
</script>
```

The `hash()` function is deterministic — same frame renders identically every time.

---

## 3. CSS 3D Transforms

Perspective rotations create depth. Use for product showcases, card flips, architectural reveals.

```html
<div class="stage" style="perspective: 900px;">
  <div class="card-3d" style="transform-style: preserve-3d;">
    <div class="face front">Product</div>
    <div class="face back" style="transform: rotateY(180deg);">Details</div>
  </div>
</div>
<script>
  tl.to(".card-3d", { rotationY: 360, rotationX: 15, duration: 1.2, ease: "sine.inOut" }, 0);
</script>
```

Always set `perspective` on the parent, `transform-style: preserve-3d` on the animated element.

---

## 4. Per-Word Kinetic Typography

Words appear one-by-one, synced to transcript.json timestamps. The core technique for narration-driven videos.

```html
<div class="headline">
  <span class="word w-0">Anything</span>
  <span class="word w-1">a</span>
  <span class="word w-2">browser</span>
  <span class="word w-3">can</span>
  <span class="word w-4">render</span>
</div>
<style>
  .word {
    display: inline-block;
    opacity: 0;
    margin: 0 0.12em;
  }
</style>
<script>
  // Word onset times from transcript.json (seconds relative to beat start)
  var timings = [0.0, 0.23, 0.28, 0.63, 0.78];
  var slides = [80, 60, 50, 25, 12]; // horizontal slide decay (px)

  document.querySelectorAll(".word").forEach(function (word, i) {
    tl.from(
      word,
      {
        x: slides[i],
        y: 14,
        opacity: 0,
        duration: 0.35,
        ease: "power2.out",
      },
      timings[i],
    );
  });
</script>
```

The slide distance DECAYS per word (80→12px) — mimics a camera settling.

---

## 5. Lottie Animation

Vector animations that play inside a composition. Use for logos, character animations, icons.

```html
<!-- The web-component package is `@lottiefiles/dotlottie-wc` (the SDK
     `@lottiefiles/dotlottie-web` does NOT expose a custom element).
     The element tag is <dotlottie-wc>. -->
<script
  src="https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-wc/dist/dotlottie-wc.js"
  type="module"
></script>
<dotlottie-wc
  class="lottie"
  src="capture/assets/lottie/animation-0.json"
  autoplay
  loop
  speed="1.5"
  style="width:500px;height:500px;"
>
</dotlottie-wc>
<script>
  gsap.set(".lottie", { scale: 0.3, opacity: 0 });
  tl.to(".lottie", { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(1.6)" }, 0.2);
</script>
```

Or use lottie-web for more control:

```javascript
var anim = lottie.loadAnimation({
  container: document.getElementById("anim"),
  renderer: "svg",
  loop: false,
  autoplay: false,
  path: "capture/assets/lottie/animation-0.json",
});
```

---

## 6. Video Compositing

Embed real video footage inside compositions. Videos must be `muted` with `playsinline`.

```html
<div class="video-frame" style="width:680px;height:840px;border-radius:16px;overflow:hidden;">
  <video
    id="footage"
    src="capture/assets/videos/clip.mp4"
    muted
    playsinline
    style="width:100%;height:100%;object-fit:cover;"
  ></video>
</div>
<script>
  // Video playback is controlled by the framework — don't call play() manually
  tl.from(".video-frame", { scale: 0.9, opacity: 0, duration: 0.3, ease: "power2.out" }, 0);
</script>
```

The HyperFrames runtime handles video seeking and playback.

---

## 7. Character-by-Character Typing

Terminal typing effect using `tl.call()` to update text content character by character.

```html
<div class="terminal-line">
  <span class="prompt">❯</span>
  <span class="typed" id="typed-text"></span>
  <span class="cursor" style="width:11px;height:22px;background:#333;display:inline-block;"></span>
</div>
<script>
  var CMD = "npx hyperframes init";
  var typed = document.getElementById("typed-text");

  // Cursor blinks
  tl.to(".cursor", { opacity: 0, duration: 0.12, yoyo: true, repeat: 20, ease: "steps(1)" }, 0);

  // Type each character
  for (var i = 0; i < CMD.length; i++) {
    (function (idx) {
      tl.call(
        function () {
          typed.textContent = CMD.substring(0, idx + 1);
        },
        null,
        (idx / CMD.length) * 0.9,
      );
    })(i);
  }
</script>
```

Use `ease: "steps(1)"` for cursor blink — creates discrete on/off.

---

## 8. Variable Font Axis Animation

Animate font-variation-settings to reshape glyphs in real-time. Works with variable fonts that have axes like optical size (opsz), weight (wght), softness (SOFT).

```html
<style>
  /* Load the captured local variable font — do NOT use Google Fonts @import.
     Replace this placeholder with an @font-face pointing to capture/assets/fonts/. */
  @font-face {
    font-family: "Fraunces";
    src: url("capture/assets/fonts/Fraunces-Variable.woff2") format("woff2");
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  .wordmark {
    --opsz: 144;
    --wght: 440;
    font-family: "Fraunces", serif;
    font-variation-settings:
      "opsz" var(--opsz),
      "wght" var(--wght);
    font-size: 200px;
  }
</style>
<script>
  tl.to(".wordmark", { "--opsz": 72, "--wght": 300, duration: 0.45, ease: "power2.out" }, 0);
</script>
```

The glyph subtly reshapes as axes animate — optical size adjusts detail, weight changes thickness.

---

## 9. GSAP MotionPathPlugin

Animate an element along an arbitrary SVG path. Use for sliders following curves, particles along trajectories, guided reveals.

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/MotionPathPlugin.min.js"></script>
<div class="dot" style="width:20px;height:20px;background:#2a8a7c;border-radius:50%;"></div>
<script>
  gsap.registerPlugin(MotionPathPlugin);
  tl.to(
    ".dot",
    {
      motionPath: { path: "M 12 300 C 280 280 520 80 820 50 S 1200 48 1308 38" },
      duration: 1.5,
      ease: "power2.out",
    },
    0,
  );
</script>
```

---

## 10. Velocity-Matched Transitions

Exit one beat and enter the next with matched velocities — creates perceived continuous motion.

```javascript
// EXIT (in outgoing composition): accelerating with blur
tl.to(
  ".content",
  {
    y: -150,
    filter: "blur(30px)",
    opacity: 0,
    duration: 0.33,
    ease: "power2.in", // accelerates
  },
  parseFloat(root.dataset.duration) - 0.33, // start exit 0.33s before beat ends
);

// ENTRY (in incoming composition): decelerating from blur
gsap.set(".content", { y: 150, filter: "blur(30px)" });
tl.to(
  ".content",
  {
    y: 0,
    filter: "blur(0px)",
    duration: 1.0,
    ease: "power2.out", // decelerates
  },
  0,
);
```

The fastest point of both curves meets at the cut — the viewer perceives smooth camera motion. Match ease families: `.in` for exits, `.out` for entries.

---

## 11. Audio-Reactive Animation

Drive any GSAP-tweenable property from the playing audio. Bass pulses a logo on kick drums. Treble glows a CTA on cymbals. Amplitude breathes a background during quiet phrases. The result: motion that feels locked to the track in a way pre-authored tweens never can.

**When to use:** Any video with music or dramatic narration — brand reels, product launches, hype edits. Skip for calm/tutorial pacing.

**How it works:** Pre-extract audio frequency bands into a JSON file, then sample per-frame via `tl.call()`:

```js
// audio-data.json: { fps: 30, totalFrames: 900, frames: [{ bands: [0.82, 0.45, 0.31, ...] }, ...] }
for (var f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    (function (frame) {
      return function () {
        var bass = frame.bands[0]; // 0–1
        var treble = frame.bands[13];
        gsap.set(".logo", { scale: 1 + bass * 0.04 }); // 3–4% pulse on bass
        gsap.set(".cta", { filter: `drop-shadow(0 0 ${treble * 24}px #00C3FF)` });
      };
    })(AUDIO_DATA.frames[f]),
    [],
    f / AUDIO_DATA.fps,
  );
}
```

Per-frame sampling is required — a single tween will not react. Use the extract script:

```bash
python3 skills/gsap/scripts/extract-audio-data.py narration.wav --fps 30 --bands 16 -o audio-data.json
```

Keep text/logo intensity subtle (≤5% scale, ≤30% glow) — audio-reactive motion on tiny elements reads as jitter. Bigger backgrounds can push to 10–30%.

**Never do:** equalizer bars, spectrum analyzers, waveform displays, strobing, rainbow color cycling. The audio provides _timing and intensity_; the visual vocabulary still comes from the brand. See `skills/hyperframes/references/audio-reactive.md` for the full API and anti-patterns.

---

## 12. Clip-Path Reveal Masks

A fixed window that content slides through — text or images enter from one side and are clipped by an invisible boundary. Different from SVG path drawing: the mask is static, the content moves.

```html
<div id="reveal-mask">
  <div id="reveal-content">Your headline text here</div>
</div>
<style>
  #reveal-mask {
    position: absolute;
    inset: 0;
    clip-path: inset(0 200px 0 0); /* clips 200px from right */
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #reveal-content {
    font-size: 108px;
    white-space: nowrap;
  }
</style>
<script>
  // Content starts offscreen right, slides left through the mask window
  gsap.set("#reveal-content", { x: 400, opacity: 0 });
  tl.to("#reveal-content", { x: 0, opacity: 1, duration: 1, ease: "power2.out" }, 0);
</script>
```

Variations: `clip-path: circle(0% at 50% 50%)` → `circle(100%)` for iris reveals. `clip-path: polygon(...)` for custom shapes.

---

## 13. WebGL Fragment Shader Art

Full GPU generative backgrounds — domain-warped FBM noise, cosine palette coloring, iridescent organic patterns. Far richer than Canvas 2D.

```html
<canvas id="shader-bg" width="1920" height="1080"></canvas>
<script>
  var canvas = document.getElementById("shader-bg");
  var gl = canvas.getContext("webgl");
  if (!gl) {
    /* fallback to gradient */
  }

  var fsrc = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_res;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                 mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 5; i++) { v += a*noise(p); p = R*p*2.02; a *= 0.5; }
      return v;
    }
    vec3 palette(float t) {
      return vec3(0.5)+vec3(0.5)*cos(6.28318*(vec3(1)*t+vec3(0.0,0.33,0.67)));
    }
    void main() {
      vec2 uv = v_uv; uv.x *= u_res.x/u_res.y;
      float t = u_time * 0.4;
      vec2 q = vec2(fbm(uv*3.0+t*0.3), fbm(uv*3.0+vec2(5.2,1.3)+t*0.2));
      vec2 r = vec2(fbm(uv*3.0+q*4.0+vec2(1.7,9.2)+t*0.15), fbm(uv*3.0+q*4.0+vec2(8.3,2.8)+t*0.1));
      float n = fbm(uv*3.0+r*2.0);
      vec3 col = palette(n*2.0+t*0.2);
      col = mix(col, palette(length(q)*3.0+t*0.1), 0.4);
      col *= 0.7+0.3*n;
      float vig = 1.0-0.4*length(v_uv-0.5);
      gl_FragColor = vec4(col*vig, 1.0);
    }
  `;

  // Compile, link, set up fullscreen quad, then render via GSAP proxy:
  var proxy = { time: 0.5 };
  tl.to(
    proxy,
    {
      time: 5,
      duration: BEAT_DUR,
      ease: "none",
      onUpdate: function () {
        gl.uniform1f(uTime, proxy.time);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    },
    0,
  );
</script>
```

Always include a Canvas 2D gradient fallback for environments without WebGL.

---

## Easing Vocabulary

GSAP offers a deep easing library. Every composition should use at least 3 different easings — using `power2.out` for everything produces flat, monotonous motion. Think of easings as tone of voice: a video that only whispers is boring; one that varies between whisper, normal, and punch is engaging.

**The full palette** (each family has `.in`, `.out`, `.inOut` variants):

| Family               | Character                                                                    | Typical use                                                                                        |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `power1`–`power4`    | Gentle (1) to aggressive (4) acceleration curves                             | General purpose. power2 is the workhorse, power4 for dramatic snaps                                |
| `back(N)`            | Overshoot then settle. N controls how far past the target (1=subtle, 4=wild) | Logo reveals, badge pops, card entrances. `back.out(2.5)` for playful, `back.out(1.2)` for elegant |
| `elastic(amp, freq)` | Spring bounce. amp=magnitude, freq=oscillation speed                         | Panel scatter, energetic drops, fun reveals                                                        |
| `bounce`             | Ball-drop bouncing                                                           | Physical interactions, icons landing, score counters                                               |
| `expo`               | Extreme acceleration curve (much steeper than power4)                        | Premium/luxury reveals, dramatic entrances                                                         |
| `sine`               | Smooth, organic, no hard edges                                               | Ambient float, breathing, Ken Burns, anything that loops. `.inOut` for yoyo motion                 |
| `circ`               | Circular acceleration (starts very fast, ends very gentle or vice versa)     | Camera moves, scene transitions, orbital motion                                                    |
| `steps(N)`           | Discrete N-step jumps, no interpolation                                      | Typing effects, cursor blink, counter ticks, retro/digital aesthetics                              |

**Mood mapping:** Match easing character to the beat's emotional content. Smooth/organic easings (`sine`, `power1`) feel contemplative and drifting. Aggressive deceleration (`power4.out`, `expo.out`) feels snappy and confident. Spring overshoot (`back.out`) feels bouncy and physical. The storyboard's mood description should guide which character fits — not a formula.

---

## Choosing techniques

Don't match techniques to video type on autopilot — match them to the **concept of the specific beat**. Ask: what visual treatment makes this exact idea land? A beat about speed needs motion that communicates speed; a beat about precision needs geometry and structure; a beat about warmth needs texture and organic drift.

Read the storyboard beat's concept and mood, then scan this list for techniques whose _visual character_ serves that concept. Any technique can appear in any video type — the question is whether it earns its place in this beat.
