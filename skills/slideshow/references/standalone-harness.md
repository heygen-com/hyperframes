# Standalone HyperFrames Slideshow Harness

## 1. Interim framing — why this exists

These patterns are a **temporary workaround** for standalone demos. The durable solution is engine-hosted: a future `hyperframes preview --slideshow` / studio present mode will host the composition over the real HyperFrames engine, which drives seek-timelines frame-by-frame, owns the gesture frame, and reads the slideshow island directly from the composition. When that path ships, most of what follows collapses.

Until then, a standalone slideshow opened via the bare player bundle must work around three facts:

1. The composition must expose a seekable `window.__timelines.root` timeline. Anything outside that seek path, such as Three.js loops or imperative entrance effects, must be self-driving.
2. `<hyperframes-slideshow>` reads the slideshow island from its **own innerHTML** (the wrapper element), not from the composition the player loads. The island must be duplicated into the wrapper.
3. The composition runs in the player's **iframe**; user keypresses and pointer events land on the **parent page**. Wrapper-owned SFX/global audio should live in the parent, where the activation token is reliable. Normal slide media stays in the composition and is stopped by the slideshow player on slide exit.

Do not treat these as the blessed authoring model. When the engine-hosted path ships, compositions authored the normal way will just work.

**Living reference implementations:**

- `registry/examples/airbnb-deck/index.html` + `demo.html` — full pattern set (Three.js, fragments, SFX, branch slide)
- `registry/examples/startup-pitch/index.html` — minimal version (no 3D), good starting point

---

## 2. The parent wrapper (demo.html)

The parent page hosts the two dist bundles, wraps the components, duplicates the island, and owns all audio.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Deck — Slideshow Demo</title>

    <!--
      Load both bundles from packages/player/dist.
      The global builds register <hyperframes-player> and <hyperframes-slideshow>
      as custom elements — no import map needed.
    -->
    <script src="../../../packages/player/dist/hyperframes-player.global.js"></script>
    <script src="../../../packages/player/dist/slideshow/hyperframes-slideshow.global.js"></script>

    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      html,
      body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #111;
      }
    </style>
  </head>
  <body>
    <!--
      tabindex="0" is critical — <hyperframes-slideshow> binds keydown
      (ArrowLeft/Right, Space, Backspace) to itself. Without tabindex the
      element cannot receive focus and arrow keys are dead.
    -->
    <hyperframes-slideshow
      tabindex="0"
      style="display: block; position: relative; width: 100vw; height: 100vh"
    >
      <hyperframes-player
        style="position: absolute; inset: 0"
        src="index.html"
      ></hyperframes-player>

      <!--
        DUPLICATED ISLAND — keep in sync with the island inside index.html.
        <hyperframes-slideshow> reads from its own innerHTML, not from the
        composition the player loads. Every time slides/fragments/hotspots/
        sequences change in index.html, update this copy too.
      -->
      <script type="application/hyperframes-slideshow+json">
        {
          "slides": [
            { "sceneId": "scene-one", "notes": "..." },
            {
              "sceneId": "scene-two",
              "notes": "...",
              "fragments": [8.3, 8.6]
            }
          ],
          "slideSequences": [
            {
              "id": "branch-one",
              "label": "Branch label",
              "slides": [{ "sceneId": "branch-scene", "notes": "..." }]
            }
          ]
        }
      </script>
    </hyperframes-slideshow>

    <!-- Audio player lives here — see Section 6 -->
  </body>
</html>
```

### Editable presenter notes

The shared `<hyperframes-slideshow>` presenter already renders speaker notes as an editable textarea and stores edits in `localStorage`. Do not add deck-specific note editors when the shared player is available.

For interim custom wrappers that cannot use the shared presenter chrome, use this deterministic storage contract exactly so notes migrate cleanly:

```js
const NOTES_STORAGE_PREFIX = "hf-slideshow:presenter-notes:v1:";

function notesDeckKey(slideshowEl) {
  const explicit = slideshowEl.getAttribute("notes-storage-key");
  if (explicit && explicit.trim()) return explicit.trim();

  const playerSrc = slideshowEl.querySelector("hyperframes-player")?.getAttribute("src") || "";
  let resolvedPlayerSrc = playerSrc;
  try {
    resolvedPlayerSrc = new URL(playerSrc, location.href).href;
  } catch {}

  return `${location.origin}${location.pathname}|${document.title}|${resolvedPlayerSrc}`;
}

function notesStorageKey(slideshowEl, position, slide) {
  return `${NOTES_STORAGE_PREFIX}${JSON.stringify([
    notesDeckKey(slideshowEl),
    position.sequenceId,
    position.slideIndex,
    slide.sceneId || "",
  ])}`;
}

function readPresenterNotes(slideshowEl, position, slide) {
  const key = notesStorageKey(slideshowEl, position, slide);
  try {
    const stored = localStorage.getItem(key);
    return stored == null ? slide.notes || "" : stored;
  } catch {
    return slide.notes || "";
  }
}

function wirePresenterNotes(textarea, slideshowEl, position, slide) {
  const key = notesStorageKey(slideshowEl, position, slide);
  textarea.value = readPresenterNotes(slideshowEl, position, slide);
  textarea.addEventListener("input", function () {
    try {
      localStorage.setItem(key, textarea.value);
    } catch {}
  });
}
```

Clearing the textarea must save an empty string, not remove the local value, because a presenter may intentionally blank a manifest note for their run. Use `notes-storage-key="stable-deck-id"` on `<hyperframes-slideshow>` when a standalone demo has a stable project id; otherwise the fallback key isolates by page, title, and player `src`.

---

## 3. Playhead-driven scene visibility

Without the engine, scenes are driven by a `root` GSAP timeline that the composition manages on its own clock. The visibility controller reads `window.__timelines.root.time()` via that timeline's `onUpdate` callback and sets `opacity` accordingly. Only the active scene is visible.

The key insight: scene backgrounds must be `transparent` (not opaque) if you want a Three.js canvas behind them; the body/html background and scene inline `background` set the visual fill.

For converted source pages, port source-specific widgets exactly where practical. Custom canvas players, waveform/timeline decorations, expanding rings, playheads, hover states, and event wiring are source material, not optional polish. Also audit for atypical page movement: scroll-scrubbed cameras, parallax, pinned sections, horizontal scrollers, section snapping, translated/scaled world layers, or zoom-to-element navigation. Scroll is often the source's transition trigger, so extract the scroll-progress stops, easing, and camera/focus states, then re-host that motion on slideshow navigation through timeline positions, fragments, or reusable harness hooks. Do not recreate the browser's literal page-scroll-down motion inside a slide; translate it into camera travel/zoom from one focus area to the next. If the same mechanical behavior appears across decks, move it into the player or this harness instead of copying a fragile one-off script.

```html
<!-- In index.html (composition) -->

<!-- Shared scene CSS — all scenes start hidden -->
<style>
  .scene-frame {
    position: absolute;
    top: 0;
    left: 0;
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    opacity: 0; /* hidden at rest — visibility controller shows the active one */
    visibility: hidden; /* opacity:0 alone still lets invisible frames block clicks */
    pointer-events: none; /* inactive scenes must not swallow events */
  }
</style>

<!--
  content-visible-at-rest: mark the first scene's elements with their
  final non-hidden state so the deck is not blank before the controller
  fires. The controller calls updateVisibility(0) synchronously on load.

  If using Three.js canvas behind scenes, set background: transparent
  here and let the 3D canvas + body color supply the fill.
-->
<div
  id="scene-cover"
  class="scene-frame clip"
  data-composition-id="cover"
  data-start="0"
  data-duration="9"
  style="background: transparent"
>
  <!-- content here -->
</div>

<div
  id="scene-problem"
  class="scene-frame clip"
  data-composition-id="problem"
  data-start="9"
  data-duration="9"
  style="background: transparent"
>
  <!-- content here -->
</div>

<!-- Root timeline — spans the full composition duration -->
<script>
  (function () {
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });
    // A single to() for the full duration establishes the seekable range
    tl.to({}, { duration: 108 }); // replace 108 with your total seconds
    window.__timelines["root"] = tl;
  })();
</script>

<!-- Visibility controller -->
<script>
  (function () {
    var scenes = [
      { id: "scene-cover", start: 0, end: 9 },
      { id: "scene-problem", start: 9, end: 18 },
      // ... all scenes including branch scenes
    ];

    var lastActiveId = null;

    function updateVisibility(t) {
      for (var i = 0; i < scenes.length; i++) {
        var s = scenes[i];
        var el = document.getElementById(s.id);
        if (!el) continue;
        var active = t >= s.start && t < s.end;
        el.style.opacity = active ? "1" : "0";
        el.style.visibility = active ? "visible" : "hidden";
        el.style.pointerEvents = active ? "auto" : "none";

        if (active && lastActiveId !== s.id) {
          lastActiveId = s.id;
          fireEntrance(el); // see Section 4
        }
      }
      // fragment reveals here — see Section 4
    }

    window.__hfSetTime = updateVisibility;

    // Show first slide immediately — avoids blank on load
    updateVisibility(0);

    // Hook the root timeline so every seek drives visibility
    var root = window.__timelines && window.__timelines["root"];
    if (root) {
      root.eventCallback("onUpdate", function () {
        updateVisibility(root.time());
      });
    }
  })();
</script>
```

---

## 4. Imperative entrances on slide-activate

The engine-hosted path drives GSAP seek-timelines frame by frame. Without it, seek-timeline tweens never fire. Instead, fire imperative `gsap.from()` calls each time a scene becomes active — these run on GSAP's own ticker and are independent of any playhead.

Fragment reveals use playhead-crossing: the visibility controller checks whether the playhead has passed each fragment's hold-time and fires an animation on the first crossing. Bunch fragment hold-times near the scene start (within the first 300–500 ms of the scene) so successive ArrowRight presses feel like snappy sequential reveals rather than long waits.

```js
// --- Entrance animations ---

function fireEntrance(sceneEl) {
  // [data-anim] marks elements that should entrance on slide-activate.
  // Add data-anim to eyebrows, headlines, subheads, and card grids.
  var animEls = sceneEl.querySelectorAll("[data-anim]");
  if (!animEls.length) return;
  gsap.from(animEls, {
    opacity: 0,
    y: 28,
    duration: 0.4,
    stagger: 0.07,
    ease: "power2.out",
    overwrite: true, // cancel any in-flight animation on rapid slide changes
  });
}

// --- Fragment reveals ---

// Fragment config: times in absolute composition timeline seconds,
// bunched near the scene start for snappy successive reveals.
var fragments = [
  { time: 9.3, id: "prob-item1", revealed: false },
  { time: 9.6, id: "prob-item2", revealed: false },
];

function revealFragment(id) {
  var el = document.getElementById(id);
  if (!el) return;
  gsap.fromTo(
    el,
    { opacity: 0, x: -24 },
    { opacity: 1, x: 0, duration: 0.35, ease: "power2.out", overwrite: true },
  );
}

// Inside updateVisibility(t):
for (var f = 0; f < fragments.length; f++) {
  if (!fragments[f].revealed && t >= fragments[f].time) {
    fragments[f].revealed = true;
    revealFragment(fragments[f].id);
  }
}

// On problem scene re-entry, reset all fragment states:
if (active && lastActiveId !== s.id && s.id === "scene-problem") {
  for (var f = 0; f < fragments.length; f++) {
    fragments[f].revealed = false;
    var pEl = document.getElementById(fragments[f].id);
    if (pEl) gsap.set(pEl, { opacity: 0, clearProps: "transform" });
  }
}
```

Fragment items start with `opacity: 0` in CSS. The visibility controller reveals them; the entrance driver does not touch them until crossing.

---

## 5. The scenes bootstrap postMessage

`<hyperframes-slideshow>` must know each scene's time range to map a `sceneId` to a playhead position. Without the engine injecting this at runtime, the composition must post it manually after load.

Post the manifest from the composition (index.html), not the parent wrapper:

```js
// In index.html — post after a brief delay so the parent frame has settled
(function () {
  var FPS = 30;
  var totalSeconds = 108; // match your composition's data-duration
  var totalFrames = totalSeconds * FPS;

  var scenes = [
    // EVERY scene — including branch scenes — must appear here.
    // id must match data-composition-id; start/duration in seconds.
    { id: "cover", start: 0, duration: 9 },
    { id: "problem", start: 9, duration: 9 },
    { id: "solution", start: 18, duration: 9 },
    // ... all main-line scenes ...
    // branch scene — listed last, NOT in main slides array in the island
    { id: "market-sizing", start: 99, duration: 9 },
  ];

  function postTimeline() {
    parent.postMessage(
      {
        source: "hf-preview",
        type: "timeline",
        durationInFrames: totalFrames,
        scenes: scenes,
      },
      "*",
    );
  }

  // ~300ms delay after load to let the parent settle
  if (document.readyState === "complete") {
    setTimeout(postTimeline, 300);
  } else {
    window.addEventListener("load", function () {
      setTimeout(postTimeline, 300);
    });
  }
})();
```

Omitting any scene (including branch scenes) from this manifest means the slideshow component cannot seek to it. Include every scene declared in the HTML, even scenes only reachable via a hotspot.

---

## 6. Audio/SFX — built-in mute control via `<hyperframes-slideshow sound>`

Wrapper-owned SFX should live in the parent page. Browsers enforce user-activation for AudioContext and HTMLAudioElement.play() — an iframe without its own activation (i.e., the user never clicked inside it) is often autoplay-blocked. The user's keypress lands on the parent, so the parent is the reliable frame for click/transition sound effects.

Normal slide media should stay in the composition. The slideshow player now stops slide media automatically on slide/sequence changes by calling `hyperframes-player.stopMedia()`, which pauses iframe `<video>` / `<audio>`, runtime WebAudio, and parent proxies adopted from iframe media. Same-slide fragment reveals do not stop media, and global/deck-level parent audio such as `audio-src` is left alone. Do not hand-roll per-slide cleanup scripts for regular video/audio players.

Implementation detail: iframe media elements belong to the iframe's DOM realm. Fallback code in the parent page/player must not use the parent page's `el instanceof HTMLMediaElement` check for iframe nodes; in real browsers that fails and leaves videos audible. Use `el.ownerDocument.defaultView.HTMLMediaElement` or a tag/duck-type guard before setting `muted` or calling `pause()`.

### Mute toggle — built-in chrome control

Add the `sound` boolean attribute to `<hyperframes-slideshow>` in demo.html. The component renders a speaker/speaker-muted SVG button as the **leftmost item in the nav capsule**, styled identically to the prev/next ghost buttons. No separate mute button in the composition.

```html
<hyperframes-slideshow tabindex="0" sound style="..."> ... </hyperframes-slideshow>
```

The component:

- Tracks `muted` state (default `false`); exposes a `muted` getter
- Reflects to a `data-hf-muted` attribute on the host when muted
- Applies mute globally to child `<hyperframes-player>` media and top-level page `<audio>` / `<video>` elements
- Dispatches `CustomEvent("hf-sound", { detail: { muted }, bubbles: true, composed: true })` on every toggle
- Browser-checks the actual iframe media state after changes; every composition `<video>` / `<audio>` should report `muted: true` after clicking the nav mute button

Wrapper-owned `new Audio(...)` objects are not attached to the DOM, so the parent audio player must mirror the `hf-sound` event onto each clip:

```js
var muted = false;
var slideshow = document.querySelector("hyperframes-slideshow");
if (slideshow) {
  slideshow.addEventListener("hf-sound", function (e) {
    muted = e.detail && e.detail.muted === true;
    Object.keys(clips).forEach(function (name) {
      clips[name].muted = muted;
    });
  });
}
// In message handler:
if (muted) return; // skip play
```

If `sound` is **not** present on `<hyperframes-slideshow>` (decks without audio), the mute control is hidden — the capsule shows only nav.

### Composition: post cues unconditionally

The composition posts sfx cues **unconditionally** — it does not track mute state. The parent gates on `muted`:

**In the composition (index.html):**

```js
// Post an sfx cue at transition points — unconditionally.
// The parent audio player gates on the slideshow component's mute state.
function playSfx(name) {
  try {
    parent.postMessage({ type: "hf-sfx", name: name }, "*");
  } catch (e) {}
}

// Fire at scene transitions:
//   playSfx("advance")      — moving to the next main-line slide
//   playSfx("back")         — returning from a branch
//   playSfx("branch-enter") — entering a branch
//   playSfx("fragment")     — a fragment item is revealed
```

Do NOT add a mute button inside the composition. The `#sfx-mute` coral button pattern is removed; the nav capsule in the parent chrome owns mute.

**In the parent (demo.html):**

```html
<script>
  (function () {
    // Audio elements are preloaded here, in the frame that receives user gestures.
    var clips = {
      advance: new Audio("sfx/advance.mp3"),
      fragment: new Audio("sfx/fragment.mp3"),
      "branch-enter": new Audio("sfx/branch-enter.mp3"),
      back: new Audio("sfx/back.mp3"),
    };
    clips.advance.volume = 0.45;
    clips.fragment.volume = 0.4;
    clips["branch-enter"].volume = 0.4;
    clips.back.volume = 0.4;
    Object.keys(clips).forEach(function (k) {
      clips[k].preload = "auto";
    });

    // Track mute state from the slideshow component's hf-sound event.
    var muted = false;
    var slideshow = document.querySelector("hyperframes-slideshow");
    if (slideshow) {
      slideshow.addEventListener("hf-sound", function (e) {
        muted = e.detail && e.detail.muted === true;
      });
    }

    var unlocked = false;

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      // Prime wrapper-owned SFX clips: play muted then immediately pause/reset.
      // This moves the clip into the "allowed" state so later plays are instant.
      Object.keys(clips).forEach(function (name) {
        var el = clips[name];
        var v = el.volume;
        el.volume = 0;
        el.play()
          .then(function () {
            el.pause();
            el.currentTime = 0;
            el.volume = v;
          })
          .catch(function () {
            el.volume = v;
          });
      });
    }

    // Unlock on the first user gesture in the parent frame.
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("click", unlock, true);

    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "hf-sfx") return;
      // Gate on mute state — the component owns this.
      if (muted) return;
      var el = clips[d.name];
      if (!el || !unlocked) return;
      try {
        el.currentTime = 0;
        el.play().catch(function () {});
      } catch (err) {}
    });
  })();
</script>
```

**Sourcing SFX files:** use the HeyGen MCP `search_audio_sounds` tool with `type=sound_effects` and keywords like "whoosh", "click", "transition". Download the results to a local `sfx/` directory next to `demo.html` and reference them by relative path. Do not fetch SFX at render time — the HyperFrames determinism rule forbids runtime network requests; pre-download and commit them.

---

## 7. Three.js (optional)

Add a Three.js scene behind the slides for ambient motion. The key rules:

- **Own rAF loop** — do not integrate with the HF seek timeline. Three.js runs its own `requestAnimationFrame` loop independent of playhead position.
- **One persistent canvas** — create the canvas once; update geometry/materials in-place per scene.
- **Guard renderer creation** — WebGL may be unavailable (software-GL environments, some CI contexts). Create the renderer inside try/catch once; if it fails, hide the canvas and expose no-op stubs. Do not spam `console.error` — silence it during creation and restore it in `finally`.
- **Full-bleed, behind content** — fix the canvas at `z-index: 0`, `pointer-events: none`, behind scene frames at `z-index: 1`.
- **Transparent scene frames** — set scene backgrounds to `transparent` so the 3D canvas shows through. Use a radial-gradient scrim on the text container (not the scene frame itself) to keep type legible while letting 3D show in the margins.
- **Expose a mood hook** — export `window.__threeApplyMood(sceneKey)` so the visibility controller can switch particle colors, toggle sub-objects, or change the clear color when the active scene changes.

```js
// In index.html — Three.js setup (module script)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

var canvas = document.getElementById("three-canvas");
var renderer = null;
var _err = console.error;
console.error = function () {}; // silence THREE's multi-line GPU error during init
try {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
} catch (e) {
  // renderer stays null
} finally {
  console.error = _err;
}

if (!renderer) {
  // Graceful degradation — branded layout is the fallback.
  canvas.style.display = "none";
  window.__threeApplyMood = function () {};
  // Do NOT start the rAF loop.
} else {
  renderer.setSize(1920, 1080);
  renderer.setPixelRatio(1);
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:1920px;height:1080px;z-index:0;pointer-events:none";

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.1, 1000);
  camera.position.set(0, 0, 5);

  // --- build your particle system, meshes, etc. here ---

  // Mood config: map sceneId → visual state (colors, sub-object visibility, bg color)
  var MOODS = {
    cover: {
      /* particle color, opacity, bg ... */
    },
    problem: {
      /* ... */
    },
    // one entry per scene key
  };

  window.__threeApplyMood = function (sceneKey) {
    var m = MOODS[sceneKey] || MOODS["cover"];
    // update geometry attributes, material opacity, sub-group visibility, etc.
  };
  window.__threeApplyMood("cover"); // apply initial state

  // --- own rAF loop ---
  var lastTime = null;
  function animate(ts) {
    requestAnimationFrame(animate);
    if (lastTime === null) lastTime = ts;
    var dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    // update particles, rotate objects, etc.
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}
```

**CSS for transparent scene frames + scrim:**

```css
/* Three.js canvas — always behind everything */
#three-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  z-index: 0;
  pointer-events: none;
}

/* Scene frames are transparent so the 3D canvas shows through */
.scene-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  background: transparent; /* NOT opaque — 3D would be occluded */
  z-index: 1;
}

/* Scrim on the TEXT container — not the scene frame.
   Radial gradient: opaque in the center where text is, transparent at edges
   so 3D shows in the whitespace margins. */
.slide-inner.scrim-light {
  background: radial-gradient(
    ellipse 75% 80% at 50% 50%,
    rgba(255, 255, 255, 0.88) 30%,
    rgba(255, 255, 255, 0.6) 65%,
    rgba(255, 255, 255, 0) 100%
  );
}
```

---

## 8. Foot-gun checklist

| Failure                                               | Symptom                                                        | One-line fix                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Island not duplicated in wrapper                      | Slideshow chrome never renders; no slide counter, no prev/next | Copy the `<script type="application/hyperframes-slideshow+json">` block verbatim into the `<hyperframes-slideshow>` element in demo.html      |
| Wrapper SFX in the iframe                             | Click/transition sounds silent                                 | Move SFX Audio elements and unlock logic to demo.html; post `{type:'hf-sfx',name}` from index.html                                            |
| No self-clock in composition                          | All scene frames stacked / wrong slide visible at load         | Add the root GSAP timeline (`window.__timelines["root"]`) and the `onUpdate` visibility controller as shown in Section 3                      |
| Content opacity:0 with no engine                      | Blank slides — `[data-anim]` elements invisible at rest        | Call `updateVisibility(0)` synchronously after defining the controller so the first slide is shown immediately                                |
| Keydown bound to the element without focus            | ArrowLeft/Right dead                                           | Add `tabindex="0"` to `<hyperframes-slideshow>` so it can receive keyboard focus                                                              |
| Opaque scene background occluding Three.js canvas     | 3D never visible                                               | Set `background: transparent` on `.scene-frame`; put the visual fill on the text scrim container instead                                      |
| WebGL renderer creation spams errors in headless envs | Console noise, rAF loop starts anyway                          | Silence `console.error` during `new THREE.WebGLRenderer(...)`, restore in `finally`, guard the rAF start on `renderer !== null`               |
| Branch scene missing from postMessage manifest        | Hotspot navigates but slide is blank                           | Include every scene — main line and branch — in the `scenes` array of the `postTimeline()` message                                            |
| Prominent 3D/content in nav-capsule zone              | Bright element bleeds behind/beside the nav pill               | Keep the bottom-right ~360×140px region clear; add a background-matching gradient overlay on any slide whose 3D mood is bright in that corner |
