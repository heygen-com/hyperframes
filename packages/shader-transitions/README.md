# @hyperframes/shader-transitions

WebGL shader transitions for HyperFrames compositions. Renders GPU-accelerated scene-to-scene transitions using fragment shaders, driven by GSAP timelines.

## Install

```bash
npm install @hyperframes/shader-transitions
```

Or load directly via CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
```

## Usage

```typescript
import { init } from "@hyperframes/shader-transitions";

const tl = init({
  bgColor: "#0a0a0a",
  accentColor: "#ff6b2b",
  scenes: ["scene-1", "scene-2", "scene-3"],
  transitions: [
    { time: 3, shader: "domain-warp", duration: 0.8 },
    { time: 8, shader: "light-leak", duration: 0.7 },
  ],
});
```

The `init()` function captures each scene to a WebGL texture at transition time, crossfades between them using the selected shader, and returns a GSAP timeline. If WebGL is unavailable, it falls back to hard cuts.

### With an existing timeline

Pass your own GSAP timeline to layer transitions onto it:

```typescript
const tl = gsap.timeline({ paused: true });
// ... add your scene animations ...

init({
  bgColor: "#000",
  scenes: ["intro", "demo", "outro"],
  transitions: [
    { time: 5, shader: "cinematic-zoom" },
    { time: 12, shader: "glitch", duration: 0.5 },
  ],
  timeline: tl,
});
```

## Available shaders

| Shader                | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `domain-warp`         | Organic noise-based warp with glowing edge           |
| `ridged-burn`         | Ridged noise burn with sparks and heat glow          |
| `whip-pan`            | Horizontal motion blur simulating a fast camera pan  |
| `sdf-iris`            | Circular iris wipe with glowing ring edge            |
| `ripple-waves`        | Concentric ripple distortion radiating from center   |
| `gravitational-lens`  | Warping gravity well with chromatic aberration       |
| `cinematic-zoom`      | Radial zoom blur with chromatic fringing             |
| `chromatic-split`     | RGB channel separation expanding from center         |
| `glitch`              | Digital glitch with block displacement and scanlines |
| `swirl-vortex`        | Spiral rotation with noise-based warping             |
| `thermal-distortion`  | Heat shimmer rising from the bottom                  |
| `flash-through-white` | Flash to white then reveal the next scene            |
| `cross-warp-morph`    | Noise-driven morph blending both scenes              |
| `light-leak`          | Warm cinematic light leak with lens flare            |

## API

### `init(config): GsapTimeline`

| Option          | Type                 | Required | Description                                                  |
| --------------- | -------------------- | -------- | ------------------------------------------------------------ |
| `bgColor`       | `string`             | yes      | Background color (hex) for scene capture                     |
| `accentColor`   | `string`             | no       | Accent color (hex) for shader glow effects                   |
| `scenes`        | `string[]`           | yes      | Element IDs of each scene, in order                          |
| `transitions`   | `TransitionConfig[]` | yes      | Transition definitions (see below)                           |
| `timeline`      | `GsapTimeline`       | no       | Existing timeline to attach transitions to                   |
| `compositionId` | `string`             | no       | Override the `data-composition-id` for timeline registration |

### `TransitionConfig`

| Option     | Type         | Default          | Description                      |
| ---------- | ------------ | ---------------- | -------------------------------- |
| `time`     | `number`     | —                | Start time in seconds            |
| `shader`   | `ShaderName` | —                | Shader name from the table above |
| `duration` | `number`     | `0.7`            | Transition duration in seconds   |
| `ease`     | `string`     | `"power2.inOut"` | GSAP easing function             |

### `SHADER_NAMES`

Array of all available shader name strings, useful for validation or building UIs.

```typescript
import { SHADER_NAMES } from "@hyperframes/shader-transitions";
// ["domain-warp", "ridged-burn", "whip-pan", ...]
```

## Distribution

| Format | File                   | Use case                       |
| ------ | ---------------------- | ------------------------------ |
| ESM    | `dist/index.js`        | Bundlers (Vite, webpack, etc.) |
| CJS    | `dist/index.cjs`       | Node.js / require()            |
| IIFE   | `dist/index.global.js` | `<script>` tag, CDN            |

All formats include source maps. TypeScript definitions included.

## Related packages

- [`@hyperframes/core`](../core) -- types, parsers, runtime
- [`@hyperframes/engine`](../engine) -- rendering engine
- [`hyperframes`](../cli) -- CLI

## License

MIT
