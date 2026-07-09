# Contribute Templates

Copy-paste starter templates for each component type. These embed the proven patterns that pass lint and validate.

## Caption Template

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link
      href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap"
      rel="stylesheet"
    />
    <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
    <style>
      *,
      *::before,
      *::after {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        background: #111;
        overflow: hidden;
      }
      #root-BLOCKNAME {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #111;
      }
      .cap-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cg {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 32px;
        max-width: 1700px;
        overflow: visible;
        opacity: 0;
        visibility: hidden;
      }
      .cw {
        font-family: "Montserrat", sans-serif;
        font-weight: 900;
        font-size: 128px;
        color: #ffffff;
        text-transform: uppercase;
        line-height: 1;
        display: inline-block;
        -webkit-text-stroke: 3px rgba(0, 0, 0, 0.8);
        paint-order: stroke fill;
        text-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      }
    </style>
  </head>
  <body>
    <div
      id="root-BLOCKNAME"
      data-composition-id="BLOCKNAME"
      data-start="0"
      data-duration="9"
      data-width="1920"
      data-height="1080"
    >
      <div class="cap-container" id="cc-BLOCKNAME"></div>
      <div
        id="drv-BLOCKNAME"
        class="clip"
        data-start="0"
        data-duration="9"
        data-track-index="0"
        style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
      ></div>
    </div>
    <script>
      (function () {
        // REPLACE with actual transcript data
        var WORDS = [
          { text: "Welcome", start: 0.3, end: 0.65 },
          { text: "to", start: 0.65, end: 0.8 },
          { text: "the", start: 0.8, end: 0.95 },
          { text: "future", start: 0.95, end: 1.4 },
          // ... add all words
        ];

        var GROUPS = [
          { start: 0.3, end: 1.3, wordStart: 0, wordEnd: 3, text: "Welcome to the future" },
          // ... add all groups
        ];

        var container = document.getElementById("cc-BLOCKNAME");

        GROUPS.forEach(function (g, gi) {
          var groupEl = document.createElement("div");
          groupEl.id = "PREFIX-cg-" + gi;
          groupEl.className = "cg";

          for (var wi = g.wordStart; wi <= g.wordEnd; wi++) {
            var wordEl = document.createElement("span");
            wordEl.id = "PREFIX-cw-" + wi;
            wordEl.className = "cw";
            wordEl.textContent = WORDS[wi].text;
            groupEl.appendChild(wordEl);
          }

          // Pretext overflow prevention
          if (window.__hyperframes && window.__hyperframes.fitTextFontSize) {
            var _fit = window.__hyperframes.fitTextFontSize(g.text.toUpperCase(), {
              fontFamily: "Montserrat",
              fontWeight: 900,
              maxWidth: 1550,
              baseFontSize: 128,
              minFontSize: 48,
            });
            if (_fit.fontSize < 128) {
              for (var _fi = 0; _fi < groupEl.children.length; _fi++) {
                groupEl.children[_fi].style.fontSize = _fit.fontSize + "px";
              }
            }
          }
          container.appendChild(groupEl);
        });

        var tl = anime.createTimeline({ autoplay: false });

        GROUPS.forEach(function (g, gi) {
          var groupEl = document.getElementById("PREFIX-cg-" + gi);

          // SHOW: set opacity to 1 at the group start.
          tl.add(groupEl, { opacity: 1, visibility: "visible", duration: 0 }, g.start * 1000);

          // ENTRANCE: customize this per style.
          tl.add(
            groupEl,
            {
              scale: [
                { to: 1.3, duration: 0, ease: "linear" },
                { to: 1, duration: 150, ease: "outBack(2)" },
              ],
            },
            g.start * 1000,
          );

          // KARAOKE: highlight each word.
          for (var wi = g.wordStart; wi <= g.wordEnd; wi++) {
            var wordEl = document.getElementById("PREFIX-cw-" + wi);
            tl.add(wordEl, { color: "#FFD700", scale: 1.1, duration: 60 }, WORDS[wi].start * 1000);
            tl.add(wordEl, { color: "#FFFFFF", scale: 1, duration: 80 }, WORDS[wi].end * 1000);
          }

          // EXIT
          tl.add(groupEl, { opacity: 0, scale: 0.9, duration: 100 }, (g.end - 0.1) * 1000);

          // HARD KILL (mandatory)
          tl.add(groupEl, { opacity: 0, visibility: "hidden", duration: 0 }, g.end * 1000);
        });

        hyperframesAnime.register("BLOCKNAME", tl, { labels: {} });
      })();
    </script>
  </body>
</html>
```

**Replace checklist:**

- `BLOCKNAME` -> your block name (e.g., `cap-swoosh`)
- `PREFIX` -> short unique prefix for IDs (e.g., `sw`)
- Font family, weight, size -> your style's typography
- Entrance animation -> your style's entrance
- Karaoke highlight -> your style's active word treatment
- Colors -> your style's palette

> **Non-default GSAP adapter path.** Existing GSAP caption blocks can keep the GSAP CDN and paused GSAP timeline. New templates default to anime.js. When porting GSAP timings, multiply durations, delays, staggers, and positions by 1000 for anime.js, while label values stay in seconds.

---

## VFX Template

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>
    <style>
      *,
      *::before,
      *::after {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        background: #030308;
        overflow: hidden;
      }
      #root-BLOCKNAME {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #030308;
      }
      #canvas-BLOCKNAME {
        position: absolute;
        top: 0;
        left: 0;
        width: 1920px;
        height: 1080px;
      }
    </style>
  </head>
  <body>
    <div
      id="root-BLOCKNAME"
      data-composition-id="BLOCKNAME"
      data-start="0"
      data-duration="10"
      data-width="1920"
      data-height="1080"
    >
      <canvas id="canvas-BLOCKNAME" width="1920" height="1080"></canvas>
      <div
        id="drv-BLOCKNAME"
        class="clip"
        data-start="0"
        data-duration="10"
        data-track-index="0"
        style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
      ></div>
    </div>
    <script>
      (function () {
        // Seeded PRNG: NEVER use Math.random()
        function mulberry32(a) {
          return function () {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }
        var rng = mulberry32(42);

        var W = 1920,
          H = 1080;
        var canvas = document.getElementById("canvas-BLOCKNAME");
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setSize(W, H);
        renderer.setPixelRatio(1);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x030308);
        var camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
        camera.position.set(0, 0, 8);

        // YOUR SCENE SETUP HERE
        // - lights
        // - geometry
        // - materials

        // State proxy: anime.js animates this, render reads it.
        var st = {
          rotY: 0,
          camZ: 8,
          // add your animated properties
        };

        var tl = anime.createTimeline({ autoplay: false, onUpdate: renderScene });

        // YOUR TWEENS HERE
        tl.add(st, { rotY: Math.PI * 2, duration: 10000, ease: "linear" }, 0);

        hyperframesAnime.register("BLOCKNAME", tl, { labels: { end: 10 } });

        function renderScene() {
          // Apply state to Three.js objects
          camera.position.z = st.camZ;
          // mesh.rotation.y = st.rotY;

          renderer.render(scene, camera);
        }

        // Render via onUpdate and one initial paint. NO requestAnimationFrame.
        renderScene();
      })();
    </script>
  </body>
</html>
```

**Replace checklist:**

- `BLOCKNAME` -> your block name (e.g., `vfx-chrome-blob`)
- Scene setup -> your geometry, lights, materials
- State proxy -> your animated properties
- Tweens -> your animation timeline
- renderScene -> apply state to your Three.js objects

> **Non-default GSAP adapter path.** Existing GSAP VFX blocks can keep a paused GSAP timeline and `eventCallback("onUpdate", renderScene)`. New VFX templates default to anime.js with `onUpdate: renderScene`.

---

## registry-item.json Templates

**For blocks:**

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/registry-item.json",
  "name": "BLOCKNAME",
  "type": "hyperframes:block",
  "runtime": "animejs",
  "title": "Human-Readable Title",
  "description": "One sentence: what it does and who uses it",
  "dimensions": { "width": 1920, "height": 1080 },
  "duration": 10,
  "tags": ["category", "subcategory"],
  "files": [
    {
      "path": "BLOCKNAME.html",
      "target": "compositions/BLOCKNAME.html",
      "type": "hyperframes:composition"
    }
  ]
}
```

**For components** (no `dimensions` or `duration`):

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/registry-item.json",
  "name": "COMPONENTNAME",
  "type": "hyperframes:component",
  "runtime": "animejs",
  "title": "Human-Readable Title",
  "description": "One sentence: what it does",
  "tags": ["category"],
  "files": [
    {
      "path": "COMPONENTNAME.html",
      "target": "compositions/components/COMPONENTNAME.html",
      "type": "hyperframes:snippet"
    }
  ]
}
```

Tags by category:

- Captions: `captions`, `viral`, `professional`, `karaoke`, `minimal`
- VFX: `three-js`, `particles`, `shader`, `gpu`
- Transitions: `transition`, `shader`, `wipe`, `dissolve`
- Blocks: `lower-third`, `social`, `title-card`, `data-viz`
- Components: `effect`, `overlay`, `text-treatment`

---

## Component Template

Components do not own a runtime. They are engine-agnostic snippets that inherit the host composition's timeline, whether the host uses anime.js or the non-default GSAP adapter. Only include a runtime CDN in a component snippet if the component itself creates and registers a standalone runtime instance, which is unusual for components.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      *,
      *::before,
      *::after {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        background: transparent;
        overflow: hidden;
      }
      .COMPNAME-wrap {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="COMPNAME-wrap">
      <!-- Your reusable effect/overlay here -->
    </div>
    <script>
      (function () {
        // Component snippet: no data-composition-id and no registered timeline.
        // The parent composition controls timing.
        // Keep all class names and IDs prefixed with COMPNAME.
      })();
    </script>
  </body>
</html>
```

**Replace checklist:**

- `COMPNAME` -> your component name (e.g., `shimmer-sweep`)
- Background should be `transparent` so it overlays cleanly
- No `data-composition-id` and no standalone runtime registration; the parent owns timing
