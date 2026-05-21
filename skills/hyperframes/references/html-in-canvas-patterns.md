# HTML-in-Canvas Patterns

HyperFrames' most powerful visual capability. Capture ANY live HTML/CSS as a GPU texture, then render it through WebGL shaders, Three.js 3D scenes, or post-processing effects — at 60fps, pixel-perfect, with every CSS feature supported.

**Read this file when a beat deserves cinematic treatment beyond flat GSAP animations.** Use for 1-3 hero beats per video, not every beat. The rest can use standard GSAP — the contrast between flat beats and HTML-in-Canvas beats IS part of the visual storytelling.

---

## Core Boilerplate (same in every HTML-in-Canvas composition)

Every HTML-in-Canvas effect shares this structure. Learn this once, adapt it for any effect.

```html
<!-- 1. Source HTML — your content goes inside a layoutsubtree canvas -->
<canvas
  id="hic-source"
  layoutsubtree
  width="1920"
  height="1080"
  style="position:absolute;inset:0;opacity:0;"
>
  <div id="hic-content" style="width:1920px;height:1080px;">
    <!-- YOUR HTML CONTENT HERE — text, images, cards, dashboards, anything -->
  </div>
</canvas>

<!-- 2. Render target — the visible canvas that shows the effect -->
<canvas id="hic-output" width="1920" height="1080" style="position:absolute;inset:0;"></canvas>
```

```js
// 3. Feature detection — always check, always provide fallback
function isHiCSupported() {
  var tc = document.createElement("canvas");
  if (!("layoutSubtree" in tc)) return false;
  tc.setAttribute("layoutsubtree", "");
  var ctx = tc.getContext("2d");
  return ctx && typeof ctx.drawElementImage === "function";
}
var apiOk = isHiCSupported();

// 4. Capture function — call this every frame in onUpdate
var capCanvas = document.getElementById("hic-source");
var capCtx = capCanvas.getContext("2d");
function captureContent() {
  if (apiOk) {
    capCtx.drawElementImage(document.getElementById("hic-content"), 0, 0, 1920, 1080);
  }
}

// 5. Drive from GSAP timeline — capture + render every frame
tl.to(
  proxy,
  {
    /* your animation properties */
    duration: BEAT_DURATION,
    ease: "sine.inOut",
    onUpdate: function () {
      captureContent();
      // render your effect here (Three.js or WebGL2)
    },
  },
  0,
);
```

**Fallback:** When `drawElementImage` is not available (preview without Chrome flag), draw a solid-color placeholder or use Canvas 2D text. The HyperFrames renderer auto-enables the flag — the effect WILL work in the final video. See the liquid-glass block for a complete fallback example.

---

## Effect Catalog

### 1. 3D Rotation with Bloom (Three.js)

**What it looks like:** Content floats in 3D space, slowly rotating with cinematic glow around bright edges. Like a product screenshot displayed in a dark theater.

**When to use:** Hero product showcase, feature reveal, CTA with premium feel.

**Key Three.js components:** `PlaneGeometry` + `CanvasTexture` + `EffectComposer` + `UnrealBloomPass`

```js
// After the boilerplate above, add:
var scene3d = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(45, 1920 / 1080, 0.1, 100);
camera.position.set(0, 0, 4);

var renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("hic-output"),
  antialias: true,
  alpha: true,
});
renderer.setSize(1920, 1080);

var texture = new THREE.CanvasTexture(capCanvas);
var mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3.6, 2.2),
  new THREE.MeshBasicMaterial({ map: texture }),
);
scene3d.add(mesh);

// Post-processing: bloom for cinematic glow.
// EffectComposer / RenderPass / UnrealBloomPass are ES-module named imports
// (see the import block below) — they're NOT properties of THREE in modern
// versions. Three.js r150+ removed the UMD `examples/js/` globals.
var composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene3d, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.3, 0.4, 0.85));

var proxy = { rotY: -0.12, zoom: 4.2 };
tl.to(
  proxy,
  {
    rotY: 0.12,
    zoom: 3.6,
    duration: BEAT_DURATION,
    ease: "sine.inOut",
    onUpdate: function () {
      captureContent();
      texture.needsUpdate = true;
      mesh.rotation.y = proxy.rotY;
      camera.position.z = proxy.zoom;
      composer.render();
    },
  },
  0,
);
```

**Load Three.js and post-processing via ESM (use a `type="module"` script):**

```html
<script type="module">
  import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/+esm";
  import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/postprocessing/EffectComposer.js";
  import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/postprocessing/RenderPass.js";
  import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/postprocessing/ShaderPass.js";
  import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/postprocessing/UnrealBloomPass.js";
  // ... rest of composition code using these imports
</script>
```

The `examples/js/` path was removed in Three.js r152. Use `examples/jsm/` (ES modules) with `three@0.181.2` — the version used by the HyperFrames Three.js adapter.

---

### 2. Magnetic Cursor Distortion (Raw WebGL2)

**What it looks like:** Content warps and bends toward a moving point, like a magnet pulling on pixels. Chromatic aberration splits RGB channels at the distortion site.

**When to use:** Interactive feel, product demo with cursor, "look at THIS feature" moment.

**Key technique:** Custom fragment shader with Gaussian warp + chromatic split. No Three.js needed — just raw WebGL2.

```js
// WebGL2 setup
var gl = document.getElementById("hic-output").getContext("webgl2", {
  alpha: false,
  preserveDrawingBuffer: true,
});

// Vertex shader — full-screen quad
var VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Fragment shader — magnetic warp + chromatic aberration
var FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_cursor;   // cursor position (0-1)
uniform float u_strength; // warp strength (0-1)

void main() {
  vec2 uv = v_uv;
  vec2 delta = uv - u_cursor;
  float dist = length(delta);
  float warp = u_strength * exp(-dist * dist * 8.0);
  vec2 warped = uv - delta * warp * 0.3;

  // Chromatic aberration at distortion site
  float aberration = warp * 0.008;
  float r = texture(u_tex, warped + vec2(aberration, 0.0)).r;
  float g = texture(u_tex, warped).g;
  float b = texture(u_tex, warped - vec2(aberration, 0.0)).b;
  fragColor = vec4(r, g, b, 1.0);
}`;

// Compile, link, setup quad geometry, upload texture...
// (See registry/blocks/vfx-magnetic/vfx-magnetic.html for complete implementation)

// Drive cursor position from GSAP
var proxy = { cx: 0.2, cy: 0.5, strength: 0.0 };
tl.to(
  proxy,
  {
    cx: 0.8,
    cy: 0.4,
    strength: 1.0,
    duration: BEAT_DURATION,
    ease: "power2.inOut",
    onUpdate: function () {
      captureContent();
      // Upload texture, set uniforms, draw
      gl.uniform2f(cursorLoc, proxy.cx, proxy.cy);
      gl.uniform1f(strengthLoc, proxy.strength);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  },
  0,
);
```

---

### 3. Shatter / Fragment Explosion (Three.js)

**What it looks like:** Content breaks into geometric fragments that fly apart, revealing what's behind.

**When to use:** Dramatic transition, "breaking free" moment, tension release.

**Key technique:** Subdivide the source texture into triangle mesh fragments using BufferGeometry, then animate each fragment's position/rotation with GSAP.

Study `registry/blocks/vfx-shatter/vfx-shatter.html` for the complete 1156-line implementation. The core idea:

```js
// 1. Capture content to texture (same boilerplate)
// Seeded PRNG for determinism — Math.random() is banned
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rng = mulberry32(42);

// 2. Create N triangle fragments from the texture
var fragments = [];
for (var i = 0; i < NUM_FRAGMENTS; i++) {
  var geom = new THREE.BufferGeometry();
  var mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: texture }));
  scene3d.add(mesh);
  fragments.push({ mesh: mesh, targetPos: randomExplosionVector(rng), delay: rng() * 0.5 });
}

// 3. Animate: first hold still, then EXPLODE
tl.to({}, { duration: holdTime }, 0);
fragments.forEach(function (frag) {
  tl.to(
    frag.mesh.position,
    {
      x: frag.targetPos.x,
      y: frag.targetPos.y,
      z: frag.targetPos.z,
      duration: 0.8,
      ease: "power3.in",
    },
    holdTime + frag.delay,
  );
  tl.to(
    frag.mesh.rotation,
    { x: rng() * 4, y: rng() * 4, duration: 0.8, ease: "power2.in" },
    holdTime + frag.delay,
  );
});
```

---

### 4. Liquid / Fluid Surface (Three.js)

**What it looks like:** Content floats above a rippling liquid surface with real-time wave dynamics. Or content IS the surface, undulating like water.

**When to use:** Organic/premium feel, ambient background, "living" product showcase.

**Key technique:** Subdivided PlaneGeometry with vertex displacement driven by noise functions in a vertex shader.

Study `registry/blocks/vfx-liquid-background/vfx-liquid-background.html` for the 1244-line implementation. Core idea:

```js
// Custom vertex shader with wave displacement
var vertexShader = `
  varying vec2 vUv;
  uniform float u_time;
  void main() {
    vUv = uv;
    vec3 pos = position;
    // Sine wave displacement
    pos.z += sin(pos.x * 3.0 + u_time * 2.0) * 0.15;
    pos.z += cos(pos.y * 2.5 + u_time * 1.5) * 0.1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

var mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 3, 64, 64), // heavily subdivided for smooth waves
  new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: `varying vec2 vUv; uniform sampler2D u_tex;
      void main() { gl_FragColor = texture2D(u_tex, vUv); }`,
    uniforms: {
      u_tex: { value: texture },
      u_time: { value: 0 },
    },
  }),
);
```

---

### 5. Portal / Dimensional Reveal (Three.js)

**What it looks like:** A glowing circular portal opens and content emerges through it from another dimension.

**When to use:** Product reveal, "entering the app" moment, hero feature introduction.

Study `registry/blocks/vfx-portal/vfx-portal.html` for the complete 863-line implementation.

---

## When to Use HTML-in-Canvas vs Standard GSAP

| Scenario                         | Use                                  | Why                                  |
| -------------------------------- | ------------------------------------ | ------------------------------------ |
| Hero product screenshot showcase | HTML-in-Canvas (3D rotation + bloom) | Makes flat UI feel cinematic         |
| Feature list / stats             | Standard GSAP                        | Content-focused, doesn't need 3D     |
| CTA / brand reveal               | HTML-in-Canvas (portal or magnetic)  | Makes the moment memorable           |
| Social proof / logos             | Standard GSAP                        | Orderly cascade, trust is steady     |
| Transition between acts          | HTML-in-Canvas (shatter)             | Dramatic act break                   |
| Background atmosphere            | HTML-in-Canvas (liquid surface)      | Premium ambient feel                 |
| Quick feature cards              | Standard GSAP                        | Speed matters, 3D would slow it down |

---

## More Effects You Can Build

These aren't in the VFX blocks — build them yourself from the core boilerplate + a custom fragment shader. Each effect is a single GLSL function applied to the captured texture.

### 6. Noise Dissolve

Content dissolves into noise particles, revealing what's behind. Great for transitions.

```glsl
// Fragment shader — noise-based dissolve
uniform float u_progress; // 0.0 = fully visible, 1.0 = fully dissolved
uniform sampler2D u_tex;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = v_uv;
  float noise = hash(uv * 50.0);
  float threshold = u_progress;
  if (noise < threshold) {
    // Edge glow at the dissolve boundary
    float edge = smoothstep(threshold - 0.05, threshold, noise);
    fragColor = vec4(1.0, 0.6, 0.2, 1.0) * (1.0 - edge); // orange edge glow
  } else {
    fragColor = texture(u_tex, uv);
  }
}
```

### 7. Holographic / Iridescent

Content gets a rainbow-shifting holographic sheen that moves with time. Premium, futuristic feel.

```glsl
uniform float u_time;
uniform sampler2D u_tex;

void main() {
  vec4 color = texture(u_tex, v_uv);
  // Iridescent color shift based on position + time
  float angle = v_uv.x * 6.28 + v_uv.y * 3.14 + u_time * 0.5;
  vec3 holo = vec3(
    sin(angle) * 0.5 + 0.5,
    sin(angle + 2.094) * 0.5 + 0.5,
    sin(angle + 4.189) * 0.5 + 0.5
  );
  // Blend holographic over content (subtle overlay)
  fragColor = vec4(mix(color.rgb, holo, 0.15 + 0.1 * sin(u_time)), color.a);
}
```

### 8. Scan Lines + CRT

Retro CRT monitor look — scan lines, slight curvature, phosphor glow. Great for "code" or "terminal" beats.

```glsl
uniform sampler2D u_tex;
uniform float u_time;

void main() {
  vec2 uv = v_uv;
  // Barrel distortion (CRT curvature)
  vec2 centered = uv - 0.5;
  float dist = dot(centered, centered);
  uv = uv + centered * dist * 0.15;

  vec4 color = texture(u_tex, uv);
  // Scan lines
  float scanline = sin(uv.y * 800.0) * 0.04;
  color.rgb -= scanline;
  // Slight RGB offset (phosphor)
  color.r = texture(u_tex, uv + vec2(0.001, 0.0)).r;
  color.b = texture(u_tex, uv - vec2(0.001, 0.0)).b;
  // Vignette
  float vignette = 1.0 - dist * 2.0;
  fragColor = vec4(color.rgb * vignette, 1.0);
}
```

### 9. Frosted Glass Blur

Content behind frosted glass — visible but softened, with subtle light refraction. Good for "behind the scenes" or "coming soon" moments.

```glsl
uniform sampler2D u_tex;
uniform float u_blur; // 0.0 = clear, 1.0 = full frost

void main() {
  vec2 uv = v_uv;
  vec4 color = vec4(0.0);
  // Box blur with offset
  float radius = u_blur * 0.015;
  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      color += texture(u_tex, uv + vec2(x, y) * radius);
    }
  }
  color /= 25.0;
  // Add frost noise texture
  float frost = fract(sin(dot(uv * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
  color.rgb += frost * 0.03 * u_blur;
  fragColor = color;
}
```

### 10. Pixel Sort / Glitch Art

Pixels rearrange themselves in vertical or horizontal strips — digital art aesthetic. Great for tech/creative brands.

```glsl
uniform sampler2D u_tex;
uniform float u_intensity; // 0-1

void main() {
  vec2 uv = v_uv;
  // Random horizontal displacement per row
  float row = floor(uv.y * 80.0);
  float noise = fract(sin(row * 127.1) * 43758.5);
  float displace = step(0.7, noise) * u_intensity * 0.1;
  // Shift UV with RGB split
  float r = texture(u_tex, uv + vec2(displace, 0.0)).r;
  float g = texture(u_tex, uv).g;
  float b = texture(u_tex, uv - vec2(displace * 0.5, 0.0)).b;
  fragColor = vec4(r, g, b, 1.0);
}
```

---

## Creating ANY Custom Effect

The fragment shaders above are templates. The pattern is always:

1. **Capture your HTML content** with `drawElementImage` (the boilerplate at the top)
2. **Upload the captured canvas as a WebGL texture**
3. **Write a fragment shader** that reads from the texture and outputs modified colors
4. **Drive shader uniforms from GSAP** via `onUpdate`

Any GLSL effect from ShaderToy, The Book of Shaders, CodePen, or anywhere else can be adapted:

1. Find an effect you like (search "GLSL [effect name]" or browse shadertoy.com)
2. Copy the fragment shader
3. Replace `iResolution` with `vec2(1920.0, 1080.0)`, `iTime` with your `u_time` uniform
4. Add `uniform sampler2D u_tex;` for the captured content texture
5. Wire the uniforms to GSAP proxy values

**Geometry ideas beyond flat planes:**

- `SphereGeometry` — content mapped onto a globe (world map, global reach)
- `CylinderGeometry` — content on a rotating cylinder (carousel/scroll feel)
- `TorusGeometry` — content wrapped around a ring (infinity, cycle)
- `BoxGeometry` — content on a 3D box (product packaging, dice)
- GLTF models — content mapped as screen texture on phone, laptop, monitor (see `vfx-iphone-device`)

**Post-processing stacking** (Three.js EffectComposer):

- Bloom + film grain = cinematic
- Bloom + chromatic aberration = lens effect
- Depth of field + vignette = focused attention
- Film grain + scan lines = retro
- Multiple passes stack — add as many as you want

**You are not limited to the effects listed here.** If you can imagine a visual treatment, you can build it. The HTML-in-Canvas API gives you the source material (any HTML rendered as a texture), and WebGL/Three.js gives you unlimited creative control over how that material is presented.
