# Visual Techniques Reference

10 proven techniques from production HyperFrames videos. Use these in your storyboard and compositions to create visually rich, professional output. Each technique includes a minimal code pattern you can adapt.

These are NOT advanced — they're standard motion design patterns that every composition should use at least 2-3 of.

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
<script src="https://cdn.jsdelivr.net/npm/@dotlottie/player-component@2.7.12/dist/dotlottie-player.js"></script>
<dotlottie-player
  class="lottie"
  src="../capture/assets/lottie/animation-0.json"
  autoplay
  loop
  speed="1.5"
  style="width:500px;height:500px;"
>
</dotlottie-player>
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
  path: "../capture/assets/lottie/animation-0.json",
});
```

---

## 6. Video Compositing

Embed real video footage inside compositions. Videos must be `muted` with `playsinline`.

```html
<div class="video-frame" style="width:680px;height:840px;border-radius:16px;overflow:hidden;">
  <video
    id="footage"
    src="../capture/assets/videos/clip.mp4"
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
     Replace this placeholder with an @font-face pointing to ../capture/assets/fonts/. */
  @font-face {
    font-family: "Fraunces";
    src: url("../capture/assets/fonts/Fraunces-Variable.woff2") format("woff2");
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
  beatDuration - 0.33,
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

## When to Use What

| Video energy                   | Techniques to combine                                           |
| ------------------------------ | --------------------------------------------------------------- |
| High impact (launches, promos) | Per-word typography + velocity transitions + counter animations |
| Cinematic (tours, stories)     | SVG path drawing + video compositing + 3D transforms            |
| Technical (dev tools, APIs)    | Character typing + Canvas 2D procedural + MotionPath            |
| Premium (luxury, enterprise)   | Variable font animation + Lottie + slow velocity transitions    |
| Data-driven (stats, metrics)   | Canvas 2D procedural + counter animations + SVG path drawing    |
